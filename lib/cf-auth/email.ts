/**
 * Every Connect email goes out from quantt@clubs.queensu.ca, the only address any QUANTT site
 * sends from (Ethan's rule). It is sent by calendar.quantt.ca's Mailer (Worker quantt-calendar,
 * src/mailer.js), which holds the club's Gmail connection; the service binding MAILER in
 * wrangler.jsonc reaches it. Connect itself has no email credentials.
 */

/** The display name; the address is always quantt@clubs.queensu.ca (Gmail sets it). */
export const FROM_NAME = "QUANTT Connect";

export type MailMessage = { to: string[]; subject: string; text: string; html: string; fromName?: string };
/** The quantt-calendar Mailer entrypoint. */
export type Mailer = { send(msgs: MailMessage[]): Promise<number> };
export type EmailEnv = { MAILER?: Mailer };

/** Sends through the club's Gmail. Throws when the binding is missing or Gmail didn't take every email. */
export async function sendMail(env: EmailEnv, msgs: Omit<MailMessage, "fromName">[]) {
  if (!msgs.length) return;
  if (!env.MAILER) throw new Error("The MAILER binding (quantt-calendar) is missing");
  await env.MAILER.send(msgs.map((m) => ({ fromName: FROM_NAME, ...m })));
}

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

export async function sendLoginCodeEmail(env: EmailEnv, to: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("bad code");
  await sendMail(env, [{ to: [to], ...loginCodeEmail(code) }]);
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

export function inviteEmail(name: string, loginUrl: string, audience: InviteAudience = "sponsor", reminder = false) {
  const subject = reminder ? "Reminder: you're invited to QUANTT Connect" : "You're invited to QUANTT Connect";
  const intro = reminder
    ? "A reminder that you've been invited to QUANTT Connect and haven't signed in yet."
    : "You've been invited to QUANTT Connect.";
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";
  const how = howToSignIn(audience);
  // Alumni also get the Discord join link (the Alumni role, #alumni-lounge, #alumni-jobs).
  const discordUrl = audience === "alumni" ? new URL("/alumni/discord", loginUrl).toString() : null;
  const discordLine = "Then join the QUANTT Discord to get the Alumni role and the alumni channels:";
  const text = [
    greeting,
    "",
    intro,
    `To sign in, go to ${loginUrl} and ${how}`,
    ...(discordUrl ? ["", `${discordLine} ${discordUrl}`] : []),
  ].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
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
  reminder = false,
) {
  await sendMail(env, [{ to: [to], ...inviteEmail(name, loginUrl, audience, reminder) }]);
}

/** Any one-off email. */
export async function sendEmail(env: EmailEnv, to: string, msg: { subject: string; text: string; html: string }) {
  await sendMail(env, [{ to: [to], ...msg }]);
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
