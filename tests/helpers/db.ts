import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function asAnon(): SupabaseClient {
  return createClient(url, anonKey);
}

export function asService(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const PASSWORD = "test-password-123";

/**
 * Create (or reuse) a confirmed auth user and return a client authenticated
 * as them. `handle_new_user` requires a matching unaccepted invite row, so
 * seedMember/seedCompanyUser insert one before creating the user.
 */
export async function asUser(email: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

export async function seedMember(
  email: string,
  opts: { isAdmin?: boolean; fullName?: string } = {},
): Promise<string> {
  const svc = asService();
  await svc.from("invites").insert({
    email,
    full_name: opts.fullName ?? email,
    role: "member",
    is_admin: opts.isAdmin ?? false,
  });
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

export async function seedCompany(
  name: string,
  opts: { isSponsor?: boolean; tierKey?: string } = {},
): Promise<string> {
  const svc = asService();
  const key = opts.tierKey ?? (opts.isSponsor ? "partner" : "none");
  const { data: tier, error: tierErr } = await svc
    .from("sponsor_tiers")
    .select("id")
    .eq("key", key)
    .single();
  if (tierErr || !tier) {
    throw new Error(`seedCompany ${name}: missing tier ${key}`);
  }
  const { data, error } = await svc
    .from("companies")
    .insert({
      name,
      slug:
        name.toLowerCase().replace(/\s+/g, "-") +
        "-" +
        Math.random().toString(36).slice(2, 6),
      sponsor_tier_id: tier.id,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedCompany ${name}: ${error.message}`);
  return data.id as string;
}

export async function seedDefaultPackage(email: string, memberId: string): Promise<void> {
  const member = await asUser(email);
  const { error } = await member.from("hiring_packages").insert({
    member_id: memberId,
    name: "Default",
    linkedin_url: "https://linkedin.com/in/test",
    resume_path: `${memberId}/packages/x/resume.pdf`,
    is_default: true,
  });
  if (error) throw new Error(`seedDefaultPackage: ${error.message}`);
}

export async function seedProfileDocuments(email: string, memberId: string): Promise<void> {
  const member = await asUser(email);
  const { error } = await member.from("member_documents").insert({
    member_id: memberId,
    resume_path: `${memberId}/packages/x/resume.pdf`,
  });
  if (error) throw new Error(`seedProfileDocuments: ${error.message}`);
}

export async function seedInAppJob(
  authorId: string,
  companyId: string,
  opts: {
    title?: string;
    published?: boolean;
    status?: "open" | "closed";
    externalUrl?: string | null;
    kind?: "job" | "job_link" | "event" | "announcement";
  } = {},
): Promise<string> {
  const kind = opts.kind ?? "job";
  const externalUrl =
    opts.externalUrl !== undefined
      ? opts.externalUrl
      : kind === "job_link"
        ? "https://acme.example/careers"
        : null;
  const { data, error } = await asService()
    .from("posts")
    .insert({
      author_id: authorId,
      company_id: companyId,
      kind,
      title: opts.title ?? "Quant Intern",
      external_url: externalUrl,
      role_type: kind === "job" && !externalUrl ? "internship" : null,
      term_season: kind === "job" && !externalUrl ? "summer" : null,
      term_year: kind === "job" && !externalUrl ? 2027 : null,
      published: opts.published ?? true,
      status: opts.status ?? "open",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedInAppJob: ${error.message}`);
  return data.id as string;
}

export async function seedCompanyUser(
  email: string,
  companyId: string,
): Promise<string> {
  const svc = asService();
  await svc.from("invites").insert({
    email,
    full_name: email,
    role: "company_user",
    company_id: companyId,
  });
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

/**
 * Truncate every application table. Order respects FKs via CASCADE.
 *
 * NOTE: this calls the `test_reset` RPC, which is Task 1's
 * `supabase/migrations/0003_test_reset.sql`. That migration cannot be written
 * or applied until a local database exists (Docker), so `resetDb` fails with
 * "function does not exist" until then. That is expected.
 */
export async function resetDb(): Promise<void> {
  const svc = asService();
  const { error } = await svc.rpc("test_reset");
  if (error) throw new Error(`resetDb: ${error.message}`);
}
