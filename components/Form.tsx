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
      <span className="text-sm font-medium text-copy">{label}</span>
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
      className={`block min-h-11 w-full min-w-0 max-w-full rounded p-1 text-sm text-copy file:mr-3 file:min-h-8 file:cursor-pointer file:rounded file:border file:border-line file:bg-surface file:px-3 file:py-1 file:text-sm file:font-medium file:text-copy hover:file:bg-line ${props.className ?? ""}`}
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
    "min-h-11 border-primary bg-primary px-5 py-2.5 text-sm text-white hover:border-primary-hover hover:bg-primary-hover",
  ghost:
    "min-h-11 border-line-strong bg-white px-4 py-2.5 text-sm text-copy hover:border-primary hover:bg-surface hover:text-primary",
  danger:
    "min-h-11 border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 hover:border-red-300 hover:bg-red-100",
  quiet:
    "min-h-10 border-line bg-white px-3 py-1.5 text-sm text-copy hover:border-primary hover:bg-surface hover:text-primary",
  quietDanger:
    "min-h-10 border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:border-red-300 hover:bg-red-100",
  nav:
    "min-h-9 border-line bg-white px-3 py-1.5 text-xs text-copy hover:border-primary hover:bg-surface hover:text-primary",
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
