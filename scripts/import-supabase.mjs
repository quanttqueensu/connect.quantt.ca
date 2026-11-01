#!/usr/bin/env node
// Copies connect.quantt.ca's data from Supabase into files ready for
// Cloudflare: a SQL script for D1 and a folder of files plus an upload
// script for R2. It only reads from Supabase and writes to a local folder;
// the two wrangler commands it prints do the Cloudflare side.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-supabase.mjs ./supabase-export
//
// The output holds member data and resumes. Keep it out of git (the
// default folder is gitignored) and delete it after the import.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { buildImportSql, findProblems, PAGE_KEY, r2UploadScript, TABLE_ORDER } from "./import-core.mjs";

const R2_BUCKET = "connect-files";
const BUCKETS = ["resumes", "photos"];

const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = resolve(process.argv[2] ?? "supabase-export");

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API).");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function fetchTable(table) {
  const rows = [];
  const order = PAGE_KEY[table] ?? "id";
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&order=${order}&limit=1000&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function listObjects(bucket, prefix = "") {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) found.push(...(await listObjects(bucket, path)));
      else found.push({ path, contentType: item.metadata?.mimetype ?? "" });
    }
    if (page.length < 1000) return found;
  }
}

async function downloadObject(bucket, path) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers });
  if (!res.ok) throw new Error(`download ${bucket}/${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const data = {};
for (const table of TABLE_ORDER) {
  data[table] = await fetchTable(table);
  console.log(`${table}: ${data[table].length} rows`);
}

const problems = findProblems(data);
if (problems.length) {
  console.error("Fix these in Supabase first, then run again:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(2);
}

await mkdir(out, { recursive: true });
await writeFile(join(out, "d1-import.sql"), buildImportSql(data));

const files = [];
for (const bucket of BUCKETS) {
  const objects = await listObjects(bucket);
  console.log(`${bucket}: ${objects.length} files`);
  for (const o of objects) {
    const local = join(out, "files", bucket, o.path);
    await mkdir(dirname(local), { recursive: true });
    await writeFile(local, await downloadObject(bucket, o.path));
    files.push({ key: `${bucket}/${o.path}`, local, contentType: o.contentType });
  }
}
await writeFile(join(out, "r2-upload.sh"), r2UploadScript(R2_BUCKET, files), { mode: 0o755 });

console.log(`
Done. Written to ${out}
Next, logged in to the quanttgroup Cloudflare account (npx wrangler whoami):
  npx wrangler d1 execute connect-db --remote --file ${join(out, "d1-import.sql")}
  sh ${join(out, "r2-upload.sh")}
Then delete ${out}.`);
