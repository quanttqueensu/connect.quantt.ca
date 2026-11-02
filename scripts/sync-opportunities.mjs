// Fetches the public job lists, keeps the quant roles, and sends them to
// connect.quantt.ca, which stores them for the Opportunities page.
//
// Run by .github/workflows/opportunities.yml once a day. Locally:
//   node --experimental-strip-types scripts/sync-opportunities.mjs --dry-run
// prints what it would send. Without --dry-run it needs OPPORTUNITIES_SYNC_TOKEN
// (the same value as the quant-connect Worker secret) and, optionally,
// CONNECT_URL (default https://connect.quantt.ca).
//
// The parsing lives in lib/jobs/sources.ts so the tests cover it.
import { dedupe, dropPastTerms, parseNwft, parseSimplify, SOURCES } from "../lib/jobs/sources.ts";

const dryRun = process.argv.includes("--dry-run");

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "quantt-connect-opportunities" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
}

/** A source that fails is sent as null, so the site keeps its listings open. */
async function source(name, load) {
  try {
    const list = await load();
    console.log(`${name}: ${list.length} listings`);
    return list;
  } catch (err) {
    console.error(`${name}: failed, keeping yesterday's listings (${err.message})`);
    return null;
  }
}

const simplify = await source("simplify", async () => {
  const [interns, newGrad] = await Promise.all([get(SOURCES.simplifyInternships), get(SOURCES.simplifyNewGrad)]);
  return dropPastTerms(dedupe([...parseSimplify(interns, "internship"), ...parseSimplify(newGrad, "full_time")]));
});
const nwft = await source("nwft", async () => dropPastTerms(parseNwft(await get(SOURCES.nwftInternships))));

// A link on both lists is stored once, under Simplify (it has the posting date).
const simplifyUrls = new Set((simplify ?? []).map((l) => l.url));
const payload = {
  sources: {
    simplify,
    nwft: nwft && nwft.filter((l) => !simplifyUrls.has(l.url)),
  },
};

if (dryRun) {
  for (const l of [...(simplify ?? []).slice(0, 5), ...(nwft ?? []).slice(0, 5)]) {
    console.log(`  ${l.company} | ${l.title} | ${l.locations.join("; ")} | ${l.term ?? "-"}`);
  }
  console.log(`dry run: would send ${JSON.stringify(payload).length} bytes`);
  process.exit(0);
}

if (!simplify && !nwft) {
  console.error("Every source failed; nothing sent.");
  process.exit(1);
}

const token = process.env.OPPORTUNITIES_SYNC_TOKEN;
if (!token) {
  console.error("OPPORTUNITIES_SYNC_TOKEN is not set (GitHub repo secret; same value as the Worker secret).");
  process.exit(1);
}
const base = (process.env.CONNECT_URL || "https://connect.quantt.ca").replace(/\/$/, "");
const res = await fetch(`${base}/api/opportunities/sync`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log(`connect: ${res.status} ${body}`);
if (!res.ok) process.exit(1);
