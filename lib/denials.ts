/**
 * Refusal messages, keyed by an opaque code.
 *
 * The banner in components/Notice.tsx is part of the hub's own trusted
 * chrome, so it must never render text an attacker can put in the URL. A
 * crafted link such as /profile?denied=Email+your+resume+to+attacker@x would
 * otherwise render as a hub instruction on an authenticated page. Actions
 * therefore pass a code and the copy lives here; an unrecognised code
 * renders nothing at all.
 *
 * Kept as a plain .ts module (no JSX) so it can be imported from
 * node-environment code -- lib/actions/deny.ts and the vitest suite in
 * tests/rls -- without dragging in a React component module.
 */
const MESSAGES = {
  // lib/actions/posts.ts
  post_url_invalid:
    "That external listing URL isn't valid. Use a full http:// or https:// web address, or leave it blank.",
  post_term_fields_required:
    "In-app jobs need a role type, term season, and term year. Add an external listing URL instead if you want to link out.",
  post_job_link_url_required:
    "A job link needs an external listing URL. Add one, or post it as a job to take applications in the hub.",
  post_close_not_yours:
    "That post could not be closed. It belongs to another firm, or it has been removed.",
  post_close_missing:
    "That post could not be closed. It no longer exists.",
  post_close_forbidden:
    "You do not have permission to close posts.",
  comment_invalid:
    "That comment was not posted. Write something first, and keep it under 4,000 characters.",
  post_invalid:
    "That post was not published. Give it a title and a body, and keep them to a reasonable length.",
  post_kind_forbidden:
    "Your current sponsorship does not include that kind of posting. Choose another type, or ask a QUANTT exec.",
  post_quota_reached:
    "You already have the maximum number of open in-app jobs for your tier. Close one first, or ask a QUANTT exec about upgrading.",
  post_save_failed:
    "That post could not be published. Check the details and try again, or ask a QUANTT exec.",

  // lib/actions/applications.ts
  application_duplicate: "You've already applied to that job.",
  application_log_duplicate:
    "You've already logged an application to that posting.",
  application_log_post_missing:
    "That posting no longer exists, so the application was not logged. Log it without a posting instead.",
  stage_invalid: "That is not a valid application stage.",
  application_update_failed: "That application could not be updated.",
  application_package_path_invalid:
    "That hiring package could not be used. Recreate it from Hiring packages, then apply again.",
  application_cover_invalid:
    "That application was not submitted. Keep the cover letter under 4,000 characters, or upload a PDF instead.",
  application_firm_not_accepting:
    "You cannot apply to this listing in the hub.",
  application_not_open:
    "That posting is not taking hub applications.",
  application_package_missing:
    "Choose a hiring package, then apply again.",
  application_log_invalid:
    "That off-platform application was not logged. Add a company name and try again.",
  application_submit_failed:
    "That application could not be submitted. Try again in a moment.",

  // lib/actions/auth.ts
  login_failed: "Could not log in. Check your email and password and try again.",
  login_misconfigured:
    "This copy of the hub is not connected to the database. Copy .env.example to .env.local and add the Supabase keys, or set them on the host.",
  login_account_missing:
    "You're signed in, but this account is not set up in the hub yet. Ask a QUANTT exec to check your invite.",
  login_reset_email_required:
    "Enter your email address, then choose “Forgot your password?”.",
  login_link_expired: "That sign-in link expired. Ask for a new invite, or use “Forgot your password?”.",

  // app/auth/quantt/callback/route.ts
  quantt_signin_failed: "QUANTT sign-in didn't go through. Try again, or ask a QUANTT exec.",
  quantt_signin_unconfigured: "QUANTT sign-in only works on connect.quantt.ca. Use your email and password here.",
  quantt_signin_company: "That email belongs to a company account. Log in with your email and password instead.",
  password_too_short: "Password must be at least 8 characters.",
  password_mismatch: "Passwords do not match.",
  password_save_failed: "That password could not be saved. Try again, or ask for a new invite.",

  // lib/actions/admin.ts
  join_request_reject_failed:
    "That request was not rejected. It may have been deleted, or your account may no longer have admin rights.",
  join_request_review_race:
    "Another admin reviewed that request first. The firm and its invite were created anyway — check Companies before approving again.",
  join_request_contact_already_registered:
    "The firm was created and the request approved, but that contact address already has a Hub account, so no invite was sent and their account was not touched. They are not attached to the new firm yet — invite a different contact for the firm, or have them tell an exec which account to link.",
  join_request_review_failed:
    "That request could not be reviewed. Refresh and try again, or contact another exec if it keeps failing.",
  invite_email_already_registered:
    "That address already has a Hub account, so no invite was sent and nothing about the account was changed. Ask them to log in — if they cannot get in, they can use “Forgot your password?” on the login page. Re-inviting never changes an existing account's role.",
  invite_failed:
    "That invite could not be sent. Check the details and try again, or contact another exec if it keeps failing.",
  invite_name_email_required: "Name and email are required.",
  invite_company_required: "Choose an existing firm or enter a new company name.",
  invite_kind_invalid: "Choose member, admin, or company.",
  invite_tier_required: "Choose a sponsorship tier for this firm.",
  join_request_failed:
    "We could not submit that request right now. Check your details and try again, or email the QUANTT team directly.",
  company_tier_assign_failed:
    "That firm's tier could not be changed. The firm may have been removed, or your account may no longer have admin rights.",
  company_status_invalid: "Choose whether this firm is active or inactive.",
  company_access_save_failed:
    "That firm's hub access could not be saved. The firm may have been removed, or your account may no longer have admin rights.",
  company_capability_value_invalid:
    "That job limit isn't a valid whole number. Leave it blank for unlimited, or enter a whole number of slots.",
  admins_only: "You need exec access to do that.",

  // lib/actions/tiers.ts
  tier_name_required: "A tier needs a name.",
  tier_rank_invalid:
    "Rank must be a whole number of 1 or more. Rank 0 is reserved for firms with no sponsorship.",
  tier_rank_taken: "Another active tier already uses that rank. Pick a different number.",
  tier_key_duplicate: "A tier with that name already exists. Choose a different name.",
  tier_price_invalid: "Price must be a number, or left blank.",
  tier_embargo_invalid: "Applicant delay must be a whole number of hours between 0 and 8760.",
  tier_save_failed:
    "That tier could not be saved. It may have been removed, or your account may no longer have admin rights.",
  tier_deactivate_system: "That system tier cannot be deactivated.",
  tier_confirm_required:
    "That change removes capability from firms already on this tier. Check the confirmation box and try again.",
  tier_capability_invalid: "That is not a capability this platform enforces.",
  tier_capability_value_invalid:
    "That value isn't a valid whole number. Leave it blank for unlimited, or enter a whole number of slots.",

  // lib/actions/packages.ts
  package_default_missing:
    "That package no longer exists, so it was not made your default.",
  package_missing: "That package no longer exists.",
  package_create_duplicate:
    "That package was not created — you already have a default package. Uncheck \u201cmake this my default\u201d and try again.",
  package_invalid:
    "That package was not saved. Give it a name and a LinkedIn URL, and keep the cover letter under 4,000 characters.",
  package_url_invalid:
    "That LinkedIn URL isn't valid. Use a full http:// or https:// web address.",
  package_file_invalid:
    "That resume or cover letter was not saved. Upload a PDF under 5MB.",

  // lib/actions/messages.ts
  message_invalid:
    "That message was not sent. Write something first, and keep it under 4,000 characters.",
  message_send_failed:
    "That message was not sent. Try again in a moment.",
  conversation_start_forbidden:
    "You do not have permission to start that conversation.",

  // lib/actions/company.ts
  company_url_invalid:
    "That website or logo address isn't valid. Use a full http:// or https:// web address, or leave it blank.",
  company_profile_invalid:
    "That firm profile was not saved. Keep the description short and try again.",

  // lib/actions/profile.ts
  profile_save_failed:
    "Your profile was not saved. Sign out and back in, then try again.",
  profile_section_missing: "That section no longer exists.",
  profile_photo_attach_failed:
    "The photo uploaded but could not be attached to your profile. Sign out and back in, then try again.",
  profile_photo_invalid:
    "That photo was not saved. Use a JPEG, PNG, or WebP under 2MB.",
  resume_book_opt_in_failed:
    "Your resume book opt-in was not saved. You are still opted out.",
  profile_invalid:
    "Your profile was not saved. Check that your name is filled in, that your graduation year is a real year, and that no field is unreasonably long.",
  profile_section_invalid:
    "That section was not added. Give it a short label and a body, keep the body under 4,000 characters, and use a whole number for the order.",
  profile_section_limit:
    "That section was not added — you already have the maximum number of profile sections. Delete one first.",
  resume_book_opt_out_failed:
    "Your resume book consent was NOT withdrawn. Nothing changed — try again, and tell a QUANTT exec if it keeps failing.",
} as const;

/** Every code an action may pass to denyRedirect. */
export type DenialCode = keyof typeof MESSAGES;

const DENIAL_MESSAGES_BY_CODE: Record<DenialCode, string> = MESSAGES;

/**
 * The copy for a code, for the handful of screens that render a refusal
 * through their own `?error=` banner instead of Notice's `?denied=` lookup.
 * The argument is a DenialCode, never URL text, so the result is still copy
 * this repo wrote -- the property Notice exists to guarantee.
 */
export function denialMessage(code: DenialCode): string {
  return DENIAL_MESSAGES_BY_CODE[code];
}

/**
 * Looks up a denial code that may not be a real DenialCode at all -- the
 * whole point is that ?denied= comes from the URL, so an unrecognised (or
 * attacker-supplied) key must resolve to undefined rather than `string`.
 */
export const DENIAL_MESSAGES: Record<string, string | undefined> =
  DENIAL_MESSAGES_BY_CODE;
