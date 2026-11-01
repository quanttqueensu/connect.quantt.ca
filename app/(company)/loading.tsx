/**
 * Shown straight away on navigation while the page's Supabase reads finish,
 * instead of leaving the old page on screen with no sign anything happened.
 * It also gives link prefetching a boundary, so the nav prefetch stops there.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <p className="text-sm text-white/55">Loading…</p>
    </div>
  );
}
