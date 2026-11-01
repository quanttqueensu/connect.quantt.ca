-- Run after bootstrap.sql and all migrations in a disposable local database.
-- Rolls back all fixtures. Exercises the real capability helpers and RLS.
begin;
do $$
declare
  tier uuid;
  firms uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  admin_id uuid := gen_random_uuid();
  recruiter_id uuid := gen_random_uuid();
  i int;
begin
  insert into public.sponsor_tiers(key, name, rank)
    values ('override-test', 'Override test', 999) returning id into tier;
  for i in 1..5 loop
    insert into public.companies(id, name, slug, sponsor_tier_id, status)
      values (firms[i], 'Override test ' || i, 'override-test-' || i, tier, 'active');
  end loop;
  insert into public.invites(email, role, is_admin)
    values ('override-admin@test.dev', 'member', true);
  insert into auth.users(id, email) values (admin_id, 'override-admin@test.dev');
  insert into public.invites(email, role, company_id)
    values ('override-recruiter@test.dev', 'company_user', firms[1]);
  insert into auth.users(id, email) values (recruiter_id, 'override-recruiter@test.dev');

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  insert into public.company_capability_overrides(company_id, capability, granted)
    values (firms[1], 'resume_book', true);
  for i in 1..5 loop
    if public.company_has_capability(firms[i], 'resume_book') <> (i = 1) then
      raise exception 'Company grant affected a peer';
    end if;
  end loop;

  insert into public.sponsor_tier_capabilities(tier_id, capability, value)
    values (tier, 'resume_book', null), (tier, 'post_in_app_job', 2);
  if not public.company_has_capability(firms[2], 'resume_book') then
    raise exception 'Tier grant did not reach inheriting company';
  end if;
  delete from public.sponsor_tier_capabilities where tier_id = tier and capability = 'resume_book';
  if not public.company_has_capability(firms[1], 'resume_book')
      or public.company_has_capability(firms[2], 'resume_book') then
    raise exception 'Explicit grant did not survive tier revocation';
  end if;

  update public.company_capability_overrides set granted = false where company_id = firms[1];
  insert into public.sponsor_tier_capabilities(tier_id, capability) values (tier, 'resume_book');
  if public.company_has_capability(firms[1], 'resume_book')
      or not public.company_has_capability(firms[2], 'resume_book') then
    raise exception 'Explicit revocation did not survive tier grant';
  end if;
  delete from public.company_capability_overrides where company_id = firms[1];
  if not public.company_has_capability(firms[1], 'resume_book') then
    raise exception 'Reset did not restore tier inheritance';
  end if;

  insert into public.company_capability_overrides(company_id, capability, granted, value)
    values (firms[1], 'post_in_app_job', true, 7);
  if public.company_capability_value(firms[1], 'post_in_app_job') <> 7
      or public.company_capability_value(firms[2], 'post_in_app_job') <> 2 then
    raise exception 'Company quota affected a peer';
  end if;
  update public.company_capability_overrides set value = null where company_id = firms[1];
  if public.company_capability_value(firms[1], 'post_in_app_job') is not null then
    raise exception 'Unlimited quota was not preserved';
  end if;
  update public.companies set status = 'inactive' where id = firms[1];
  if public.company_has_capability(firms[1], 'post_in_app_job') then
    raise exception 'Override enabled an inactive company';
  end if;

  perform set_config('request.jwt.claim.sub', recruiter_id::text, true);
  begin
    insert into public.company_capability_overrides(company_id, capability, granted)
      values (firms[1], 'resume_book', true);
    raise exception 'Recruiter was allowed to grant access';
  exception when insufficient_privilege then null;
  end;
  delete from public.company_capability_overrides where company_id = firms[1];
  if not exists (select 1 from public.company_capability_overrides where company_id = firms[1]) then
    raise exception 'Recruiter was allowed to reset overrides';
  end if;
  reset role;
end $$;
rollback;
