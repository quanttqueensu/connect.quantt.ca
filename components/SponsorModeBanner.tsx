import ViewAsSwitch, { type ViewAs } from "@/components/ViewAsSwitch";

/** The bar under the nav while an admin previews a sponsor or an alum. Read-only. */
export default function SponsorModeBanner({ companyName, view = "sponsor" }: { companyName: string; view?: ViewAs }) {
  return (
    <aside aria-label={view === "alum" ? "Alum view" : "Sponsor view"} className="border-b border-primary/20 bg-primary/5 px-4 py-2 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink"><strong>Viewing as {companyName}</strong><span className="ml-2 text-copy">Read-only</span></p>
        <ViewAsSwitch current={view} />
      </div>
    </aside>
  );
}
