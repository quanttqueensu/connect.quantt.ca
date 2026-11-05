import type { ReactNode } from "react";

export default function PageHeader({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[28px]">{title}</h1>
        {children && <div className="mt-1 max-w-3xl text-sm leading-6 text-copy">{children}</div>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}
