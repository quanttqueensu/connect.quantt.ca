import SponsorModeToggle from "@/components/SponsorModeToggle";

export default function SponsorModeBanner({ companyName }: { companyName: string }) {
  return (
    <aside aria-label="Sponsor mode" className="border-b border-primary/20 bg-primary/5 px-4 py-2 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink"><strong>Viewing as {companyName}</strong><span className="ml-2 text-copy">Read-only</span></p>
        <SponsorModeToggle active />
      </div>
    </aside>
  );
}
