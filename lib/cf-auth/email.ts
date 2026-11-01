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
