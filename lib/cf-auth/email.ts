/**
 * Sign-in emails through Resend (the same provider the calendar uses).
 * Needs the Worker secret RESEND_API_KEY. LOGIN_EMAIL_FROM sets the sender;
 * its domain must be verified in Resend.
 */

export const DEFAULT_FROM = "QUANTT Connect <connect@quantt.ca>";

export type EmailEnv = { RESEND_API_KEY?: string; LOGIN_EMAIL_FROM?: string };

export function loginCodeEmail(code: string) {
  const subject = `${code} is your QUANTT Connect sign-in code`;
  const text = [
    `Your QUANTT Connect sign-in code is ${code}.`,
    "",
    "It works once, for the next 10 minutes.",
    "If you didn't ask for it, you can ignore this email.",
  ].join("\n");
  const html = `<p>Your QUANTT Connect sign-in code is</p>
<p style="font-size:28px;font-weight:600;letter-spacing:4px;font-family:monospace">${code}</p>
<p>It works once, for the next 10 minutes. If you didn't ask for it, you can ignore this email.</p>`;
  return { subject, text, html };
}

export async function sendLoginCodeEmail(env: EmailEnv, to: string, code: string, fetchImpl: typeof fetch = fetch) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  if (!/^\d{6}$/.test(code)) throw new Error("bad code");
  const { subject, text, html } = loginCodeEmail(code);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.LOGIN_EMAIL_FROM?.trim() || DEFAULT_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status})`);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type InviteAudience = "member" | "sponsor" | "alumni";

function howToSignIn(audience: InviteAudience) {
  if (audience === "member") {
    return `choose "Sign in with your Queen's email", the same sign-in as the other QUANTT sites. There's no password to set.`;
  }
  if (audience === "alumni") {
    return "enter this email address. We'll email you a one-time code; there's no password to set.";
  }
  return "choose Sponsor and enter this email address. We'll email you a one-time code; there's no password to set.";
}

export function inviteEmail(name: string, loginUrl: string, audience: InviteAudience = "sponsor") {
  const subject = "You're invited to QUANTT Connect";
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";
  const how = howToSignIn(audience);
  // Alumni also get the Discord join link (the Alumni role, #alumni-lounge, #alumni-jobs).
  const discordUrl = audience === "alumni" ? new URL("/alumni/discord", loginUrl).toString() : null;
  const discordLine = "Then join the QUANTT Discord to get the Alumni role and the alumni channels:";
  const text = [
    greeting,
    "",
    "You've been invited to QUANTT Connect.",
    `To sign in, go to ${loginUrl} and ${how}`,
    ...(discordUrl ? ["", `${discordLine} ${discordUrl}`] : []),
  ].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p>
<p>You've been invited to QUANTT Connect.</p>
<p>To sign in, go to <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a> and ${escapeHtml(how)}</p>${
    discordUrl
      ? `
<p>${escapeHtml(discordLine)} <a href="${escapeHtml(discordUrl)}">${escapeHtml(discordUrl)}</a></p>`
      : ""
  }`;
  return { subject, text, html };
}

/** The invite notice. The invite itself is the invites row; this only tells them. */
export async function sendInviteEmail(
  env: EmailEnv,
  to: string,
  name: string,
  loginUrl: string,
  audience: InviteAudience = "sponsor",
  fetchImpl: typeof fetch = fetch,
) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const { subject, text, html } = inviteEmail(name, loginUrl, audience);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.LOGIN_EMAIL_FROM?.trim() || DEFAULT_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status})`);
}

/** Any one-off email through Resend. */
export async function sendEmail(
  env: EmailEnv,
  to: string,
  msg: { subject: string; text: string; html: string },
  fetchImpl: typeof fetch = fetch,
) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.LOGIN_EMAIL_FROM?.trim() || DEFAULT_FROM, to: [to], ...msg }),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status})`);
}

/** To a member who just graduated (lib/alumni/graduates.ts), at their personal email. */
export function graduationEmail(name: string, loginUrl: string) {
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";
  const subject = "Congratulations, you're now a QUANTT alum";
  const lines = [
    "Congratulations on graduating. You're now part of the QUANTT alumni network.",
    "Your Connect profile, headshot and resume moved to an alumni account at this email address. You can post jobs and mentorship, and message current members.",
    "In the QUANTT Discord, your member roles have been swapped for the Alumni role.",
  ];
  const text = [greeting, "", ...lines, "", `Sign in at ${loginUrl} with this email address. We'll email you a one-time code; there's no password.`].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
<p>Sign in at <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a> with this email address. We'll email you a one-time code; there's no password.</p>`;
  return { subject, text, html };
}

/** April reminder to a member graduating this spring who hasn't given a personal email on auth.quantt.ca. */
export function personalEmailReminder(name: string, year: number) {
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";
  const subject = "Add a personal email before you graduate";
  const url = "https://auth.quantt.ca";
  const text = [
    greeting,
    "",
    `You're graduating in ${year}. On May 1 you become a QUANTT alum, and your Connect profile, headshot and resume move to an alumni account.`,
    "Your Queen's email stops working after you graduate, so the alumni account needs a personal one.",
    `Add it under "After you graduate" at ${url}.`,
  ].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p>
<p>You're graduating in ${year}. On May 1 you become a QUANTT alum, and your Connect profile, headshot and resume move to an alumni account.</p>
<p>Your Queen's email stops working after you graduate, so the alumni account needs a personal one.</p>
<p>Add it under "After you graduate" at <a href="${url}">${url}</a>.</p>`;
  return { subject, text, html };
}
