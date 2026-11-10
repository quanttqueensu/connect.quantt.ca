// Prints what the daily Opportunities run would store, without sending anything:
//   node --experimental-strip-types scripts/sync-opportunities.mjs --dry-run
//
// The real run happens in the quantt-connect Worker (lib/jobs/daily.ts, cron at
// 11:00 UTC, or "Run workflow" on GitHub). Both use collectListings in
// lib/jobs/sources.ts, so this shows exactly what the Worker would fetch.
import { collectListings } from "../lib/jobs/sources.ts";

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "quantt-connect-opportunities" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

const { simplify, nwft } = await collectListings(get, (line) => console.log(line));
for (const l of [...(simplify ?? []).slice(0, 5), ...(nwft ?? []).slice(0, 5)]) {
  console.log(`  ${l.company} | ${l.title} | ${l.locations.join("; ")} | ${l.term ?? "-"}`);
}
console.log(`would store ${(simplify?.length ?? 0) + (nwft?.length ?? 0)} listings`);
