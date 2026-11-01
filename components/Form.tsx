import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-[11px] uppercase tracking-wider text-white/60">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full min-w-0 rounded px-3 py-2 text-sm ${props.className ?? ""}`}
    />
  );
}

export function FileInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      {...props}
      type="file"
      className={`block min-h-11 w-full min-w-0 max-w-full rounded p-1 text-sm text-white/70 file:mr-3 file:min-h-8 file:cursor-pointer file:rounded file:border file:border-white/30 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:font-medium file:text-white hover:file:bg-white/15 ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded px-3 py-2 text-sm ${props.className ?? ""}`}
    />
  );
}

export type ButtonVariant = "primary" | "ghost" | "danger" | "quiet" | "quietDanger" | "nav";

const BASE =
  "inline-flex max-w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded border text-center align-middle font-medium leading-5 transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "min-h-11 border-blue-light/60 bg-primary px-5 py-2 text-sm text-white shadow-sm shadow-black/20 hover:border-blue-light hover:bg-primary/80",
  ghost:
    "min-h-11 border-white/35 bg-white/[0.06] px-4 py-2 text-sm text-white/90 hover:border-white/55 hover:bg-white/10 hover:text-white",
  danger:
    "min-h-11 border-red-400/50 bg-red-950/45 px-4 py-2 text-sm text-red-100 hover:border-red-300/70 hover:bg-red-900/50 hover:text-white",
  quiet:
    "min-h-10 border-white/30 bg-white/[0.06] px-3 py-1.5 text-sm text-white/90 hover:border-white/50 hover:bg-white/10 hover:text-white",
  quietDanger:
    "min-h-10 border-red-400/45 bg-red-950/35 px-3 py-1.5 text-sm text-red-100 hover:border-red-300/65 hover:bg-red-900/45 hover:text-white",
  nav: "min-h-9 border-white/30 bg-white/[0.06] px-3 py-1 text-xs text-white/90 hover:border-white/50 hover:bg-white/10 hover:text-white",
};

export function buttonClass(variant: ButtonVariant = "primary", className?: string) {
  return [BASE, VARIANTS[variant], className].filter(Boolean).join(" ");
}

function HubButton({
  variant,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: ButtonVariant }) {
  return (
    <button {...props} className={buttonClass(variant, className)}>
      {children}
    </button>
  );
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HubButton variant="primary" {...props} />;
}

export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HubButton variant="ghost" {...props} />;
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HubButton variant="danger" {...props} />;
}

export function QuietButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HubButton variant="quiet" {...props} />;
}

export function QuietDangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HubButton variant="quietDanger" {...props} />;
}
