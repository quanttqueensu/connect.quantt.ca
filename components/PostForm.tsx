"use client";

import { useState } from "react";
import { Field, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import { createPost } from "@/lib/actions/posts";
import type { PostKind } from "@/lib/types";

export default function PostForm({
  kinds,
  companies,
  allowInAppJob = true,
}: {
  kinds: PostKind[];
  companies?: { id: string; name: string }[];
  /**
   * Unused: createPost hard-codes its own destination and never reads a
   * "redirect" field, so the hidden input that carried this was dead. The
   * prop stays accepted for now so existing call sites keep compiling; it can
   * be dropped once they stop passing it.
   */
  redirectTo?: string;
  /** False when the firm cannot take hub applications (capability or quota). */
  allowInAppJob?: boolean;
}) {
  const [kind, setKind] = useState<PostKind>(kinds[0] ?? "announcement");
  const [externalUrl, setExternalUrl] = useState("");
  const isInAppJob = kind === "job" && externalUrl.trim() === "" && allowInAppJob;
  const isEvent = kind === "event";
  // job_link_has_url (0001_init.sql:133) rejects a job_link with no URL.
  // A job without in-app access is the same shape: it must link out.
  const urlRequired = kind === "job_link" || (kind === "job" && !allowInAppJob);
  // createPost writes external_url only for these kinds; showing the field on
  // an event or announcement would silently discard whatever was typed.
  const showUrl = kind === "job" || kind === "job_link";

  function changeKind(next: PostKind) {
    setKind(next);
    // Belt and braces: the field unmounts for other kinds, so nothing is
    // submitted, but clearing the state keeps isInAppJob honest and stops a
    // stale value reappearing if the user switches back.
    if (next !== "job" && next !== "job_link") setExternalUrl("");
  }

  return (
    <form action={createPost} className="max-w-lg space-y-4">
      <Field label="Type">
        <select
          name="kind"
          required
          value={kind}
          onChange={(e) => changeKind(e.target.value as PostKind)}
          className="w-full rounded px-3 py-2 text-sm"
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k.replace("_", " ")}
            </option>
          ))}
        </select>
      </Field>
      {companies && (
        <Field label="Company (optional, for admin posts)">
          <select name="company_id" className="w-full rounded px-3 py-2 text-sm">
            <option value="">None</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Title">
        <TextInput name="title" required maxLength={200} />
      </Field>
      <Field label="Body">
        <TextArea name="body" rows={6} required maxLength={8000} />
      </Field>
      <Field label="Location">
        <TextInput name="location" maxLength={120} />
      </Field>
      {isEvent && (
        <Field label="Starts at (optional)">
          <TextInput name="starts_at" type="datetime-local" />
          <p className="mt-1 text-xs text-white/60">
            Leave blank if the date is still to be announced.
          </p>
        </Field>
      )}
      {isInAppJob && (
        <>
          <Field label="Role type">
            <select name="role_type" required className="w-full rounded px-3 py-2 text-sm">
              <option value="">Choose one</option>
              <option value="full_time">Full-time</option>
              <option value="internship">Internship</option>
              <option value="coop">Co-op</option>
            </select>
          </Field>
          <Field label="Term season">
            <select name="term_season" required className="w-full rounded px-3 py-2 text-sm">
              <option value="">Choose one</option>
              <option value="fall">Fall</option>
              <option value="winter">Winter</option>
              <option value="summer">Summer</option>
            </select>
          </Field>
          <Field label="Term year">
            <TextInput
              name="term_year"
              type="number"
              required
              placeholder="2027"
              min={2000}
              max={2100}
              step={1}
            />
          </Field>
        </>
      )}
      {showUrl && (
        <Field
          label={urlRequired ? "External listing URL" : "External listing URL (optional)"}
        >
          <TextInput
            name="external_url"
            type="url"
            required={urlRequired}
            maxLength={500}
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-white/60">
            {kind === "job" && !allowInAppJob
              ? "In-app applications are not available for this post. Add a full http:// or https:// listing URL."
              : urlRequired
                ? "A job link points members at a listing elsewhere, so it needs a full http:// or https:// address."
                : "Leave blank to accept applications in the hub. Add a URL to send members to your own careers page instead."}
          </p>
        </Field>
      )}
      <PrimaryButton type="submit">Publish post</PrimaryButton>
    </form>
  );
}
