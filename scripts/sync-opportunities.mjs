// Fetches the public job lists, keeps the quant roles, and sends them to
// connect.quantt.ca, which stores them for the Opportunities page.
//
// Run by .github/workflows/opportunities.yml once a day. Locally:
//   node --experimental-strip-types scripts/sync-opportunities.mjs --dry-run
// prints what it would send. Without --dry-run it needs OPPORTUNITIES_SYNC_TOKEN
// (the same value as the quantt-connect Worker secret) and CONNECT_URL, the
// Worker's workers.dev address. connect.quantt.ca also works from places
// Cloudflare's bot challenge lets through, but not from GitHub's runners.
//
// The parsing lives in lib/jobs/sources.ts so the tests cover it.
import { dedupe, dropPastTerms, parseNwft, parseSimplify, RoleIndex, SOURCES } from "../lib/jobs/sources.ts";

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

// A role on both lists is stored once, under Simplify (it has the posting date):
// same link, or same firm + title + term (see roleKey in lib/jobs/sources.ts).
const onSimplify = new RoleIndex();
for (const l of simplify ?? []) onSimplify.add(l);
const payload = {
  sources: {
    simplify,
    nwft: nwft && dedupe(nwft).filter((l) => !onSimplify.find(l)),
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
if (/<html/i.test(body) && /challenge|Just a moment/i.test(body)) {
  console.error(
    `connect: ${res.status} from Cloudflare's bot challenge at ${base}. Set the repo variable CONNECT_URL ` +
      "to the quantt-connect workers.dev address (Cloudflare → Workers → quantt-connect → Settings → Domains & Routes).",
  );
  process.exit(1);
}
console.log(`connect: ${res.status} ${body.slice(0, 300)}`);
if (!res.ok) process.exit(1);

// New listings go to the QUANTT Discord's #opportunities as one short digest.
// Skipped when DISCORD_BOT_TOKEN isn't set; a Discord failure never fails the sync.
// POST_ALL=1 (the "Post all open roles" box on Run workflow) posts every open role instead.
const postAll = process.env.POST_ALL === "true" || process.env.POST_ALL === "1";
const added = postAll
  ? [...(payload.sources.simplify ?? []), ...(payload.sources.nwft ?? [])].sort((a, b) =>
      String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")),
    )
  : (JSON.parse(body).added ?? []);
const discordToken = process.env.DISCORD_BOT_TOKEN;
const channel = process.env.DISCORD_OPPORTUNITIES_CHANNEL;
if (added.length && discordToken && channel) {
  try {
    await postDigest(added, discordToken, channel, postAll ? "open" : "new");
    console.log(`discord: posted ${added.length} ${postAll ? "open" : "new"} listings`);
  } catch (err) {
    console.error(`discord: post failed (${err.message})`);
  }
} else {
  console.log(`discord: ${added.length ? "no DISCORD_BOT_TOKEN, not posting" : "nothing new"}`);
}

function line(l) {
  const where = (l.locations ?? []).slice(0, 2).join("; ");
  const bits = [l.role_type === "full_time" ? "New grad" : l.term || "Internship", where].filter(Boolean).join(" · ");
  const title = l.title.replace(/[[\]]/g, "");
  return `• **${l.company}**: [${title}](<${l.url}>)${bits ? ` (${bits})` : ""}`;
}

/** At most 40 lines, split into messages under Discord's 2000-character limit. */
async function postDigest(list, token, channelId, kind) {
  const shown = list.slice(0, 40);
  const head = `**${list.length} ${kind} quant role${list.length === 1 ? "" : "s"}** · all open roles: <https://connect.quantt.ca/opportunities>`;
  const tail = list.length > shown.length ? `…and ${list.length - shown.length} more on Connect.` : "";
  const messages = [];
  let cur = head;
  for (const l of [...shown.map(line), tail].filter(Boolean)) {
    if (cur.length + l.length + 1 > 1900) {
      messages.push(cur);
      cur = l;
    } else {
      cur += `\n${l}`;
    }
  }
  messages.push(cur);
  for (const content of messages) {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  }
}
