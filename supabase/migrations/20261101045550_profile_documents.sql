-- Profile documents are private, separate from the member-visible directory.
-- Preserve legacy packages and application snapshots for historical records.
begin;
create table public.member_documents (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  resume_path text,
  cover_letter_path text,
  cover_letter text check (char_length(cover_letter) <= 4000),
  updated_at timestamptz not null default now(),
  constraint member_documents_resume_path check (
    resume_path is null or (resume_path ~ ('^' || member_id::text || '/packages/[A-Za-z0-9_-]+/(resume|cover)\.pdf$'))
  ),
  constraint member_documents_cover_path check (
    cover_letter_path is null or (cover_letter_path ~ ('^' || member_id::text || '/packages/[A-Za-z0-9_-]+/(resume|cover)\.pdf$'))
  )
);
alter table public.member_documents enable row level security;
revoke all on public.member_documents from public, anon, authenticated;
grant select, insert, update, delete on public.member_documents to authenticated;
grant all on public.member_documents to service_role;
create policy documents_own on public.member_documents for all to authenticated
  using (member_id = (select auth.uid()) and public.is_member())
  with check (member_id = (select auth.uid()) and public.is_member());

-- Prefer the member's old default, otherwise use their newest package.
-- Unsafe legacy paths are omitted and must be re-uploaded by the owner.
insert into public.member_documents(member_id, resume_path, cover_letter_path, cover_letter)
select distinct on (hp.member_id) hp.member_id,
  case when (hp.resume_path ~ ('^' || hp.member_id::text || '/packages/[A-Za-z0-9_-]+/(resume|cover)\.pdf$')) then hp.resume_path end,
  case when (hp.cover_letter_path ~ ('^' || hp.member_id::text || '/packages/[A-Za-z0-9_-]+/(resume|cover)\.pdf$')) then hp.cover_letter_path end,
  left(hp.cover_letter, 4000)
from public.hiring_packages hp
join public.profiles pr on pr.id = hp.member_id and pr.role = 'member'
order by hp.member_id, hp.is_default desc, hp.created_at desc, hp.id;

-- Retain RPC result shapes for existing consumers; package_name is now empty.
create or replace function public.resume_book_list(
  p_program text default null,
  p_grad_year int default null
)
returns table (
  id uuid,
  full_name text,
  program text,
  grad_year int,
  bio text,
  interests text,
  linkedin_url text,
  github_url text,
  website_url text,
  photo_path text,
  package_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pr.id,
    pr.full_name,
    pr.program,
    pr.grad_year,
    pr.bio,
    pr.interests,
    pr.linkedin_url,
    pr.github_url,
    pr.website_url,
    pr.photo_path,
    null::text
  from public.profiles pr
  join public.member_documents hp
    on hp.member_id = pr.id and hp.resume_path is not null
  where public.my_live_capability('resume_book')
    and public.my_opted_in_member(pr.id)
    and (p_program is null or pr.program ilike '%' || p_program || '%')
    and (p_grad_year is null or pr.grad_year = p_grad_year)
  order by pr.full_name
$$;

create or replace function public.candidate_search_list(
  p_q text default null,
  p_program text default null,
  p_grad_year int default null
)
returns table (
  id uuid,
  full_name text,
  program text,
  grad_year int,
  bio text,
  interests text,
  linkedin_url text,
  github_url text,
  website_url text,
  photo_path text,
  package_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pr.id,
    pr.full_name,
    pr.program,
    pr.grad_year,
    pr.bio,
    pr.interests,
    pr.linkedin_url,
    pr.github_url,
    pr.website_url,
    pr.photo_path,
    null::text
  from public.profiles pr
  join public.member_documents hp
    on hp.member_id = pr.id and hp.resume_path is not null
  where public.my_live_capability('candidate_search')
    and public.my_opted_in_member(pr.id)
    and (p_program is null or pr.program ilike '%' || p_program || '%')
    and (p_grad_year is null or pr.grad_year = p_grad_year)
    and (
      p_q is null
      or pr.full_name ilike '%' || p_q || '%'
      or coalesce(pr.program, '') ilike '%' || p_q || '%'
      or coalesce(pr.interests, '') ilike '%' || p_q || '%'
      or coalesce(pr.bio, '') ilike '%' || p_q || '%'
    )
  order by pr.full_name
$$;

-- Profile resume path for a member the caller may see in the book
-- or in search. Empty if they lack both capabilities or the member is hidden.
create or replace function public.talent_resume_path(p_member uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select hp.resume_path
  from public.member_documents hp
  where hp.member_id = p_member
    and hp.resume_path is not null
    and public.my_opted_in_member(p_member)
    and (
      public.my_live_capability('resume_book')
      or public.my_live_capability('candidate_search')
    )
  limit 1
$$;


notify pgrst, 'reload schema';
commit;
