import SponsorModeToggle from "@/components/SponsorModeToggle";

export default function SponsorModeBanner({ companyName }: { companyName: string }) {
  return (
    <aside aria-label="Sponsor mode" className="border-b border-primary/20 bg-primary/5 px-6 py-3">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink"><strong>Sponsor mode: {companyName}</strong><span className="ml-2 text-copy">Fictional data · Changes are not saved</span></p>
        <SponsorModeToggle active />
      </div>
    </aside>
  );
}
