/**
 * Supabase-Storage-shaped file access over one R2 bucket.
 *
 * Objects live at `<bucket>/<path>` in R2 (bucket is "resumes" or "photos"),
 * so the app's paths don't change. The storage.objects policies come from
 * lib/db/policies.ts (canReadFile, canWriteFile); the service principal
 * skips them, as the service-role key did.
 *
 * R2 has no signed URLs of its own here, so createSignedUrl returns a link
 * to the Worker's /files route carrying an HMAC over the bucket, path,
 * expiry and disposition. verifyFileLink checks it before streaming.
 */

import { canReadFile, canWriteFile, type Bucket } from "@/lib/db/policies";
import type { Principal } from "@/lib/db/rest";

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream | Blob, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

type StorageError = { message: string; statusCode?: string };
type StorageResult<T> = { data: T | null; error: StorageError | null };

const BUCKETS: Bucket[] = ["resumes", "photos"];
const LIMITS: Record<Bucket, { bytes: number; types: string[] }> = {
  resumes: { bytes: 5 * 1024 * 1024, types: ["application/pdf"] },
  photos: { bytes: 2 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },
};

export type FileLinkKey = { secret: string; siteUrl: string };

function objectKey(bucket: Bucket, path: string) {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\") || /[^\x21-\x7e]/.test(path)) {
    throw new Error("Invalid object path");
  }
  return `${bucket}/${path}`;
}

async function hmacHex(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function linkPayload(bucket: string, path: string, exp: number, download: boolean) {
  return `${bucket}\n${path}\n${exp}\n${download ? 1 : 0}`;
}

export async function signFileLink(
  key: FileLinkKey,
  bucket: Bucket,
  path: string,
  ttlSeconds: number,
  opts: { download?: boolean | string } = {},
  now = new Date(),
) {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const download = Boolean(opts.download);
  const sig = await hmacHex(key.secret, linkPayload(bucket, path, exp, download));
  const url = new URL(`${key.siteUrl.replace(/\/$/, "")}/files/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("exp", String(exp));
  if (download) url.searchParams.set("download", "1");
  url.searchParams.set("sig", sig);
  return url.toString();
}

/** For the /files route: the object to stream, or null if the link is bad or expired. */
export async function verifyFileLink(secret: string, url: URL, now = new Date()) {
  const m = /^\/files\/(resumes|photos)\/(.+)$/.exec(url.pathname);
  if (!m) return null;
  const bucket = m[1] as Bucket;
  const path = m[2].split("/").map(decodeURIComponent).join("/");
  const exp = Number(url.searchParams.get("exp"));
  const download = url.searchParams.get("download") === "1";
  const sig = url.searchParams.get("sig") ?? "";
  if (!Number.isInteger(exp) || exp < Math.floor(now.getTime() / 1000)) return null;
  const want = await hmacHex(secret, linkPayload(bucket, path, exp, download));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  return { bucket, path, key: objectKey(bucket, path), download };
}

async function bytesOf(body: ArrayBuffer | Uint8Array | Blob | File): Promise<ArrayBuffer> {
  if (body instanceof ArrayBuffer) return body;
  if (body instanceof Uint8Array) return body.slice().buffer;
  return await body.arrayBuffer();
}

export function createStorage(r2: R2BucketLike, principal: Principal, link: FileLinkKey | null) {
  const viewer = principal.kind === "user" ? principal.viewer : null;
  const service = principal.kind === "service";
  return {
    from(name: string) {
      if (!BUCKETS.includes(name as Bucket)) throw new Error(`Unknown bucket ${name}`);
      const bucket = name as Bucket;
      return {
        async upload(
          path: string,
          body: ArrayBuffer | Uint8Array | Blob | File,
          opts: { contentType?: string; upsert?: boolean } = {},
        ): Promise<StorageResult<{ path: string }>> {
          try {
            if (!service && !canWriteFile(viewer, bucket, path)) {
              return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
            }
            const key = objectKey(bucket, path);
            const bytes = await bytesOf(body);
            const type = opts.contentType ?? (body instanceof Blob ? body.type : "");
            const limit = LIMITS[bucket];
            if (bytes.byteLength > limit.bytes) return { data: null, error: { message: "The object exceeded the maximum allowed size", statusCode: "413" } };
            if (!limit.types.includes(type)) return { data: null, error: { message: `mime type ${type || "unknown"} is not supported`, statusCode: "415" } };
            if (!opts.upsert && (await r2.head(key))) {
              return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
            }
            await r2.put(key, bytes, { httpMetadata: { contentType: type } });
            return { data: { path }, error: null };
          } catch (e) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },

        async download(path: string): Promise<StorageResult<Blob>> {
          try {
            if (!service && !canReadFile(viewer, bucket, path)) return { data: null, error: { message: "Object not found", statusCode: "404" } };
            const obj = await r2.get(objectKey(bucket, path));
            if (!obj) return { data: null, error: { message: "Object not found", statusCode: "404" } };
            return { data: new Blob([await obj.arrayBuffer()], { type: obj.httpMetadata?.contentType ?? "" }), error: null };
          } catch (e) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },

        async remove(paths: string[]): Promise<StorageResult<{ name: string }[]>> {
          try {
            const allowed = service ? paths : paths.filter((p) => canWriteFile(viewer, bucket, p));
            if (allowed.length) await r2.delete(allowed.map((p) => objectKey(bucket, p)));
            return { data: allowed.map((name) => ({ name })), error: null };
          } catch (e) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },

        async createSignedUrl(
          path: string,
          expiresIn: number,
          opts: { download?: boolean | string } = {},
        ): Promise<StorageResult<{ signedUrl: string }>> {
          try {
            // Callers decide who may see a file before asking for a link,
            // and only the service principal ever asked on Supabase.
            if (!service && !canReadFile(viewer, bucket, path)) return { data: null, error: { message: "Object not found", statusCode: "404" } };
            if (!link) return { data: null, error: { message: "FILES_SIGNING_KEY is not set" } };
            objectKey(bucket, path);
            return { data: { signedUrl: await signFileLink(link, bucket, path, expiresIn, opts) }, error: null };
          } catch (e) {
            return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
          }
        },
      };
    },
  };
}
