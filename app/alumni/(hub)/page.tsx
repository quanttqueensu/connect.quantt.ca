import AlumniPostList from "@/components/AlumniPostList";
import { Field, PrimaryButton, QuietButton, TextArea, TextInput } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { closeAlumniOpportunity, postAlumniOpportunity } from "@/lib/actions/alumni";
import { requireAlumnus } from "@/lib/alumni/current";
import { listAlumniPosts } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniHome({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; posted?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  const [mine, all] = await Promise.all([
    listAlumniPosts(DB, { authorId: me.id, includeClosed: true }),
    listAlumniPosts(DB),
  ]);
  const others = all.filter((p) => p.alumni_id !== me.id);
  return (
    <>
      <PageHeader title="Opportunities">
        Post a job or a mentorship offer. Current QUANTT members see it under Alumni in their hub.
      </PageHeader>
      <Notice message={sp.denied} />
      {sp.posted && <p className="mb-6 text-sm text-copy">Posted. Members can see it now.</p>}

      <section className="max-w-xl">
        <h2 className="font-heading text-lg font-bold text-ink">New post</h2>
        <form action={postAlumniOpportunity} className="mt-4 grid gap-4">
          <Field label="Type">
            <select name="kind" className="w-full border border-line bg-transparent px-3 py-2 text-sm text-ink">
              <option value="job">Job</option>
              <option value="mentorship">Mentorship / coffee chat</option>
            </select>
          </Field>
          <Field label="Title">
            <TextInput name="title" required maxLength={200} placeholder="Summer 2027 Quant Trading Intern" />
          </Field>
          <Field label="Firm">
            <TextInput name="firm" maxLength={120} />
          </Field>
          <Field label="Location">
            <TextInput name="location" maxLength={120} />
          </Field>
          <Field label="Link (optional)">
            <TextInput name="external_url" type="url" maxLength={500} placeholder="https://" />
          </Field>
          <Field label="Details">
            <TextArea name="body" rows={4} maxLength={4000} />
          </Field>
          <PrimaryButton type="submit">Post</PrimaryButton>
        </form>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Your posts</h2>
        <AlumniPostList
          posts={mine}
          empty="You haven't posted anything yet."
          action={(p) =>
            p.status === "open" ? (
              <form action={closeAlumniOpportunity}>
                <input type="hidden" name="id" value={p.id} />
                <QuietButton type="submit">Close</QuietButton>
              </form>
            ) : null
          }
        />
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">From other alumni</h2>
        <AlumniPostList posts={others} empty="No other alumni posts yet." />
      </section>
    </>
  );
}
