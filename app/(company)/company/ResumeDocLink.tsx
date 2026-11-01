import { buttonClass } from "@/components/Form";

/**
 * Links to one applicant document, without signing anything up front.
 *
 * The only acceptable path is the snapshot copied for THIS application.
 * Anything else renders an explicit unavailable state, so a malformed row
 * looks broken to the recruiter instead of looking like a student who
 * attached nothing.
 *
 * The href points at a route handler that re-checks company ownership and
 * signs a short-lived URL per click.
 */
export default function ResumeDocLink({
  applicationId,
  path,
  doc,
}: {
  applicationId: string;
  path: string | null;
  doc: "resume" | "cover";
}) {
  const label = doc === "cover" ? "cover letter" : "resume";
  // A missing cover letter is ordinary -- most applicants write one inline or
  // skip it. A missing resume is not: applications_guard requires one.
  if (!path) {
    if (doc === "cover") return null;
    return <UnavailableDoc label={label} />;
  }
  if (!path.startsWith(`snapshots/${applicationId}/`)) {
    return <UnavailableDoc label={label} />;
  }
  return (
    <a
      href={`/company/applications/${applicationId}/resume?doc=${doc}`}
      className={buttonClass("quiet")}
      target="_blank"
      rel="noopener noreferrer"
    >
      Download {label}
    </a>
  );
}

function UnavailableDoc({ label }: { label: string }) {
  return (
    <span className="mt-1 mr-3 inline-block text-xs text-muted">
      This applicant&rsquo;s {label} is unavailable.
    </span>
  );
}
