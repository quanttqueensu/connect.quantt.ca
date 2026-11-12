/** A current member's headshot in the alumni area, or a blank square. */
export default function AlumniMemberPhoto({ id, hasPhoto }: { id: string; hasPhoto: boolean }) {
  if (!hasPhoto) return <div className="h-14 w-14 shrink-0 bg-surface" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/alumni/talent/${id}/photo`}
      alt=""
      width={56}
      height={56}
      loading="lazy"
      decoding="async"
      className="h-14 w-14 shrink-0 bg-surface object-cover"
    />
  );
}
