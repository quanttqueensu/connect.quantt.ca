"use client";

import { useEffect, useRef, useState } from "react";
import { QuietButton } from "@/components/Form";

export default function CopyLink({
  value,
  label = "Copy link",
}: {
  value: string;
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="break-all text-sm text-copy">{value}</code>
      <QuietButton
        type="button"
        onClick={async () => {
          if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
          try {
            await navigator.clipboard.writeText(value);
            setStatus("copied");
            timeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
          } catch {
            setStatus("failed");
          }
        }}
      >
        {status === "copied" ? "Copied" : label}
      </QuietButton>
      <span role="status" className="text-xs text-copy">
        {status === "failed"
          ? "Could not copy. Select and copy the text above."
          : status === "copied"
            ? "Copied to clipboard."
            : ""}
      </span>
    </div>
  );
}
