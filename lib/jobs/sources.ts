/**
 * Where the Opportunities page gets its listings, and how each source is read.
 *
 * Both sources are public lists that other people keep up to date, so the hub
 * piggybacks on them instead of scraping company career sites itself:
 *
 * - Simplify's internship and new-grad lists (github.com/SimplifyJobs), which
 *   tag each posting with a category. Only the "Quant" category is kept.
 * - Northwestern Fintech's quant internship list
 *   (github.com/northwesternfintech), a hand-kept table of quant firms.
 *
 * This file is pure (no fetch, no database) so the tests can feed it fixtures.
 * Relative imports only: worker.js bundles it through wrangler, outside Next.
 */

export type ListingSource = "simplify" | "nwft";
export type ListingRole = "internship" | "full_time";

export type Listing = {
  source: ListingSource;
  company: string;
  title: string;
  url: string;
  locations: string[];
  role_type: ListingRole;
  /** e.g. "Summer 2027", or null when the source doesn't say. */
  term: string | null;
  /** ISO time the source says it was posted, or null when it doesn't say. */
  posted_at: string | null;
};

export const SOURCES = {
  simplifyInternships:
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
  simplifyNewGrad:
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
  nwftInternships:
    "https://raw.githubusercontent.com/northwesternfintech/2027QuantInternships/main/README.md",
} as const;

/** Simplify's category names for quant roles (it renamed them once). */
const QUANT_CATEGORIES = ["Quant", "Quantitative Finance"];

const MAX_TEXT = 300;

function clean(s: unknown, max = MAX_TEXT): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Only http(s) links go on the page; anything else is dropped. */
export function normalizeUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  // Simplify appends its own referral tags; they make the same job look new.
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === "ref" || key === "source" && /simplify/i.test(u.searchParams.get(key) ?? "")) {
      u.searchParams.delete(key);
    }
  }
  return u.toString().slice(0, 2000);
}

type SimplifyRow = {
  category?: string;
  company_name?: string;
  title?: string;
  active?: boolean;
  is_visible?: boolean;
  terms?: string[];
  date_posted?: number;
  url?: string;
  locations?: string[];
};

/**
 * Pulls the quant postings out of a Simplify listings.json.
 *
 * The file is about 13 MB and nearly all of it is software and hardware roles.
 * Parsing all of it would cost a Worker more CPU than the cron allows, so this
 * finds each quant row's category tag with indexOf and parses only those rows.
 * Each row is a flat object (no nested objects), so its braces are the nearest
 * `{` before the tag and the nearest `}` after it.
 */
export function parseSimplify(text: string, role: ListingRole): Listing[] {
  const out: Listing[] = [];
  for (const category of QUANT_CATEGORIES) {
    for (const needle of [`"category": "${category}"`, `"category":"${category}"`]) {
      let at = text.indexOf(needle);
      while (at !== -1) {
        const start = text.lastIndexOf("{", at);
        const end = text.indexOf("}", at);
        if (start === -1 || end === -1) break;
        let row: SimplifyRow | null = null;
        try {
          row = JSON.parse(text.slice(start, end + 1)) as SimplifyRow;
        } catch {
          row = null;
        }
        if (row) {
          const listing = fromSimplify(row, role);
          if (listing) out.push(listing);
        }
        at = text.indexOf(needle, end);
      }
    }
  }
  return out;
}

function fromSimplify(row: SimplifyRow, role: ListingRole): Listing | null {
  if (!row.active || row.is_visible === false) return null;
  if (!QUANT_CATEGORIES.includes(String(row.category))) return null;
  const url = normalizeUrl(row.url);
  const company = clean(row.company_name, 120);
  const title = clean(row.title);
  if (!url || !company || !title) return null;
  const term = (row.terms ?? []).map((t) => clean(t, 40)).find((t) => /^(Spring|Summer|Fall|Winter) \d{4}$/.test(t));
  const posted =
    typeof row.date_posted === "number" && row.date_posted > 0
      ? new Date(row.date_posted * 1000).toISOString()
      : null;
  return {
    source: "simplify",
    company,
    title,
    url,
    locations: (row.locations ?? []).map((l) => clean(l, 80)).filter(Boolean).slice(0, 12),
    role_type: role,
    term: term ?? null,
    posted_at: posted,
  };
}

const NWFT_ROLES: Record<string, string> = {
  QR: "Quantitative Researcher",
  QT: "Quantitative Trader",
  QD: "Quantitative Developer",
  SWE: "Software Engineer",
  HW: "Hardware Engineer",
  FPGA: "FPGA Engineer",
  ML: "Machine Learning",
};

/**
 * Reads the Northwestern Fintech README: one `## Firm` section per firm, a
 * `**Locations**:` line, then a table of `|Role|Links|` rows where each link
 * is `[✅ label](url)` for an open posting.
 */
export function parseNwft(markdown: string): Listing[] {
  const out: Listing[] = [];
  const heading = /^#\s+((?:Spring|Summer|Fall|Winter) \d{4})/m.exec(markdown);
  const term = heading ? heading[1] : null;
  const sections = markdown.split(/^## /m).slice(1);
  for (const section of sections) {
    const firm = clean(section.split("\n", 1)[0], 120);
    if (!firm || /^(Contributing|Using This Repository)/i.test(firm)) continue;
    const locLine = /^\*\*Locations\*\*:\s*(.*)$/m.exec(section);
    const locations = locLine
      ? locLine[1].split(/[,;/]| and /).map((l) => clean(l, 80)).filter(Boolean).slice(0, 12)
      : [];
    for (const line of section.split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      // "|QR|[✅ ](url)|" splits to ["", "QR", "[✅ ](url)", ""].
      if (cells.length < 4 || cells[1] === "Role" || /^-+$/.test(cells[1])) continue;
      const role = cells[1];
      const links = cells.slice(2).join("|");
      for (const m of links.matchAll(/\[✅\s*([^\]]*)\]\(([^)\s]+)\)/g)) {
        const url = normalizeUrl(m[2]);
        if (!url) continue;
        const base = NWFT_ROLES[role] ?? clean(role, 80);
        const label = clean(m[1], 80);
        out.push({
          source: "nwft",
          company: firm,
          title: clean(`${base} Intern${label ? ` (${label})` : ""}`),
          url,
          locations,
          role_type: "internship",
          term,
          posted_at: null,
        });
      }
    }
  }
  return out;
}

type RoleLike = Pick<Listing, "company" | "title" | "term">;

/** Words that don't change which firm it is ("Akuna Capital University" is Akuna Capital). */
const COMPANY_NOISE = new Set([
  "the", "inc", "llc", "llp", "ltd", "lp", "plc", "co", "corp", "corporation", "company",
  "university", "campus", "careers", "recruiting", "group", "holdings",
]);

/** Spellings of the same word in job titles. */
const TITLE_SYNONYMS: Record<string, string> = {
  quantitative: "quant", quants: "quant",
  researcher: "research", researchers: "research",
  trader: "trading", traders: "trading",
  developer: "development", developers: "development", dev: "development",
  engineer: "engineering", engineers: "engineering",
  internship: "intern", internships: "intern", interns: "intern", co: "intern", coop: "intern",
  masters: "master", ms: "master", msc: "master",
  analysts: "analyst", scientist: "science", scientists: "science",
};

/** Words that don't change the role: the season and year live in `term`. */
const TITLE_NOISE = new Set([
  "summer", "winter", "spring", "fall", "autumn", "program", "programme", "position", "role",
  "the", "a", "an", "and", "of", "for", "in", "to", "s", "op",
]);

function words(s: string | null): string[] {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/summer analyst/g, "intern")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !/^\d{4}$/.test(w));
}

/**
 * Firm + title, spelled one way: "Quantitative Researcher Internship" and
 * "Quant Research Intern" at the same firm give the same key. Word order and
 * the season/year don't count; the term is compared separately (sameTerm).
 */
export function roleKey(l: RoleLike): string {
  const company = words(l.company).filter((w) => !COMPANY_NOISE.has(w)).join(" ");
  const title = [...new Set(words(l.title).map((w) => TITLE_SYNONYMS[w] ?? w).filter((w) => !TITLE_NOISE.has(w)))]
    .sort()
    .join(" ");
  return `${company}|${title}`;
}

/** Same term, or one source didn't name it. */
export function sameTerm(a: string | null, b: string | null): boolean {
  return !a || !b || a.toLowerCase() === b.toLowerCase();
}

/** Finds a role already seen, by link or by firm + title + term. */
export class RoleIndex<T extends RoleLike & { url: string }> {
  private byKey = new Map<string, T[]>();
  private byUrl = new Map<string, T>();

  find(l: RoleLike & { url: string }): T | undefined {
    return this.byUrl.get(l.url) ?? this.byKey.get(roleKey(l))?.find((k) => sameTerm(k.term, l.term));
  }

  add(l: T): void {
    this.byUrl.set(l.url, l);
    const key = roleKey(l);
    const list = this.byKey.get(key);
    if (list) list.push(l);
    else this.byKey.set(key, [l]);
  }
}

/**
 * Keeps the first listing for each link and each role (Simplify comes first,
 * it has dates). A role posted once per city keeps every city.
 */
export function dedupe(listings: Listing[]): Listing[] {
  const index = new RoleIndex<Listing>();
  const out: Listing[] = [];
  for (const l of listings) {
    const kept = index.find(l);
    if (kept) {
      for (const loc of l.locations) {
        if (!kept.locations.includes(loc) && kept.locations.length < 12) kept.locations.push(loc);
      }
      if (!kept.term && l.term) kept.term = l.term;
      continue;
    }
    const copy = { ...l, locations: [...l.locations] };
    index.add(copy);
    out.push(copy);
  }
  return out;
}

/** True when a listing names a place in Canada, for the "Canada" filter. */
export function inCanada(locations: string[]): boolean {
  return locations.some((l) =>
    /canada|toronto|montr[eé]al|vancouver|calgary|ottawa|waterloo|kingston|edmonton|\b(ON|QC|BC|AB|MB|NS)\b/i.test(l),
  );
}

const TERM_START_MONTH: Record<string, number> = { Winter: 0, Spring: 4, Summer: 4, Fall: 8 };

/**
 * Drops listings whose term has already started (Simplify keeps some old
 * "Summer 2026" postings marked active). Listings with no term are kept.
 */
export function dropPastTerms(listings: Listing[], now = new Date()): Listing[] {
  return listings.filter((l) => {
    const m = l.term ? /^(\w+) (\d{4})$/.exec(l.term) : null;
    if (!m || !(m[1] in TERM_START_MONTH)) return true;
    return Date.UTC(Number(m[2]), TERM_START_MONTH[m[1]], 1) > now.getTime();
  });
}
