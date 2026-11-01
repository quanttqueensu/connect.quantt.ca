"use client";

import { useState } from "react";
import { Field, PrimaryButton, TextInput } from "@/components/Form";
import { invitePerson } from "@/lib/actions/admin";

const KINDS = [
  {
    id: "member",
    title: "Club member",
    hint: "Sees the feed, applies to roles, and shows up in the directory.",
  },
  {
    id: "admin",
    title: "Exec admin",
    hint: "A member who can also invite people, approve firms, and post for the club.",
  },
  {
    id: "company",
    title: "Company contact",
    hint: "Posts jobs for their firm only. They do not get the member feed.",
  },
] as const;

type Kind = (typeof KINDS)[number]["id"];

export default function InviteForm({
  companies,
  tiers,
  initialKind = "member",
  sent,
}: {
  companies: { id: string; name: string }[];
  tiers: { id: string; name: string }[];
  initialKind?: Kind;
  sent?: boolean;
}) {
  const [kind, setKind] = useState<Kind>(
    KINDS.some((k) => k.id === initialKind) ? initialKind : "member",
  );
  const [existingId, setExistingId] = useState("");

  return (
    <form action={invitePerson} className="space-y-6">
      <input type="hidden" name="kind" value={kind} />
      <fieldset>
        <legend className="text-[11px] uppercase tracking-wider text-copy">Who is this?</legend>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {KINDS.map((option) => {
            const selected = kind === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setKind(option.id)}
                aria-pressed={selected}
                className={`flex h-full cursor-pointer flex-col items-start gap-2 rounded border p-4 text-left transition-colors ${
                  selected
                    ? "border-primary bg-surface"
                    : "border-line-strong hover:border-line-strong hover:bg-surface"
                }`}
              >
                <span className="font-heading text-base font-bold text-ink">{option.title}</span>
                <span className="text-xs leading-relaxed text-copy">{option.hint}</span>
                <span className={`mt-auto pt-2 text-xs font-medium ${selected ? "text-primary" : "text-muted"}`}>
                  {selected ? "Selected" : "Choose this role"}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {sent && (
        <p className="text-sm text-primary">
          Invite email sent. They sign in at connect.quantt.ca with that address.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Full name">
          <TextInput name="full_name" required autoComplete="name" />
        </Field>
        <Field label="Email">
          <TextInput name="email" type="email" required autoComplete="email" />
        </Field>
      </div>

      {kind === "company" && (
        <div className="space-y-4 border border-line p-4">
          <p className="text-sm text-muted">Which firm are they joining?</p>
          <Field label="Existing company">
            <select
              name="company_id"
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              className="w-full rounded px-3 py-2 text-sm"
            >
              <option value="">Create a new company below</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {!existingId && (
            <>
              <Field label="New company name">
                <TextInput name="new_company_name" required />
              </Field>
              <Field label="Sponsorship package">
                <select name="sponsor_tier_id" required className="w-full rounded px-3 py-2 text-sm">
                  <option value="">Choose a package</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>
      )}

      <PrimaryButton type="submit">
        {kind === "admin"
          ? "Invite exec admin"
          : kind === "company"
            ? "Invite company contact"
            : "Invite club member"}
      </PrimaryButton>
    </form>
  );
}
