import type { ReactNode } from "react";

export default function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-10 border-b border-line pb-8">
      {kicker && (
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{kicker}</p>
      )}
      <h1 className="mt-3 font-heading text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[40px]">{title}</h1>
      {children && <div className="mt-4 max-w-3xl text-base leading-7 text-copy">{children}</div>}
    </header>
  );
}
