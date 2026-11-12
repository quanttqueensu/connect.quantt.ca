"use client";

import { useState } from "react";
import { Field, FileInput, PrimaryButton, QuietButton } from "@/components/Form";
import { cropHeadshot } from "@/lib/headshot-crop";

/**
 * The profile photo form. The photo is cropped in the browser exactly like on auth.quantt.ca (lib/headshot-crop.ts)
 * before it goes to the server, so both sites save the same 600px square.
 */
export function HeadshotUpload({
  action,
  compact,
}: {
  action: (formData: FormData) => Promise<void>;
  /** No label and a quiet button (Profile page). */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) { setError("Choose a photo first."); return; }
    setBusy(true); setError(null);
    try {
      const cropped = await cropHeadshot(file);
      const out = new FormData();
      out.set("photo", new File([cropped], (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
      await action(out);
    } catch (e) {
      // A redirect (success or a denial message) is how the server action finishes: let Next handle it.
      if (e && typeof e === "object" && "digest" in e) throw e;
      setError(e instanceof Error ? e.message : "That photo was not saved.");
    } finally {
      setBusy(false);
    }
  }
  if (compact) {
    return (
      <form action={submit} className="flex flex-wrap items-center gap-2">
        <FileInput name="photo" accept="image/jpeg,image/png,image/webp" aria-label="Photo" className="min-w-0 flex-1" />
        <QuietButton type="submit" disabled={busy}>{busy ? "Cropping…" : "Upload"}</QuietButton>
        {error && <p role="alert" className="w-full text-sm text-copy">{error}</p>}
      </form>
    );
  }
  return (
    <form action={submit} className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 max-w-full">
        <Field label="Photo">
          <FileInput name="photo" accept="image/jpeg,image/png,image/webp" />
        </Field>
      </div>
      <PrimaryButton type="submit" disabled={busy}>{busy ? "Cropping…" : "Upload photo"}</PrimaryButton>
      {error && <p role="alert" className="w-full text-sm text-copy">{error}</p>}
    </form>
  );
}
