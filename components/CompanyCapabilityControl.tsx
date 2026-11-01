"use client";

import { useId, useState } from "react";
import { Field, TextInput } from "@/components/Form";
import type { SponsorCapability, CompanyCapabilityOverride } from "@/lib/types";

type AccessMode = "inherit" | "grant" | "revoke";

export default function CompanyCapabilityControl({
  capability,
  companyName,
  inherited,
  inheritedValue,
  override,
}: {
  capability: SponsorCapability;
  companyName: string;
  inherited: boolean;
  inheritedValue: number | null;
  override: Pick<CompanyCapabilityOverride, "granted" | "value"> | null;
}) {
  const id = useId();
  const [mode, setMode] = useState<AccessMode>(
    override ? (override.granted ? "grant" : "revoke") : "inherit",
  );
  const enabled = mode === "inherit" ? inherited : mode === "grant";
  const quota = capability.kind === "quota";
  const tierSummary = inherited
    ? `Enabled${quota ? ` · ${inheritedValue == null ? "unlimited" : inheritedValue} open jobs` : ""}`
    : "Disabled";

  return (
    <li className="border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {capability.label}
        </label>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {enabled ? "Enabled" : "Disabled"} · {mode === "inherit" ? "from tier" : "company override"}
        </span>
      </div>
      <p id={`${id}-description`} className="mt-1 text-xs text-muted">
        {capability.description}
      </p>
      <select
        id={id}
        name={`access_${capability.key}`}
        value={mode}
        onChange={(event) => setMode(event.target.value as AccessMode)}
        aria-label={`${capability.label} for ${companyName}`}
        aria-describedby={`${id}-description ${id}-tier`}
        className="mt-3 min-h-11 w-full rounded px-3 py-2 text-sm"
      >
        <option value="inherit">Follow tier</option>
        <option value="grant">Enable for this company</option>
        <option value="revoke">Disable for this company</option>
      </select>
      <p id={`${id}-tier`} className="mt-2 text-xs text-muted">
        Tier default (including current grandfathered access): {tierSummary}.
      </p>
      {quota && (
        <div className="mt-3">
          <Field label="Company job limit (blank = unlimited)">
            <TextInput
              name={`value_${capability.key}`}
              type="number"
              min={0}
              max={2147483647}
              step={1}
              disabled={mode !== "grant"}
              defaultValue={(override?.granted ? override.value : inheritedValue) ?? ""}
              aria-label={`Open in-app job limit for ${companyName}`}
              placeholder="unlimited"
            />
          </Field>
          <p className="mt-1 text-xs text-muted">
            Choose Enable for this company to set its own limit.
          </p>
        </div>
      )}
    </li>
  );
}
