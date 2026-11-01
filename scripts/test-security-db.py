#!/usr/bin/env python3
"""Exercise migrations/RLS/races on a new, disposable LOCAL PostgreSQL database.

Usage: python3 scripts/test-security-db.py postgresql://127.0.0.1:55439/postgres
Requires psql and local database-creation privileges. Never uses .env credentials.
Auth/Storage SQL fixtures do not substitute for Supabase HTTP integration tests.
"""
import concurrent.futures
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
PSQL = shutil.which("psql") or "/opt/homebrew/bin/psql"
ADMIN = sys.argv[1] if len(sys.argv) == 2 else ""
parsed = urlsplit(ADMIN)
if parsed.scheme not in ("postgres", "postgresql") or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.query:
    sys.exit("Supply an explicit loopback-only PostgreSQL URL without query options.")
NAME = "connect_security_" + uuid.uuid4().hex[:12]
DB = urlunsplit(parsed._replace(path="/" + NAME))
checks = 0


def run(sql, *, url=DB, success=True):
    result = subprocess.run([PSQL, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", url],
                            input=sql, text=True, capture_output=True,
                            env={**os.environ, "PGCONNECT_TIMEOUT": "5"})
    if success and result.returncode:
        raise AssertionError(result.stderr)
    if not success and not result.returncode:
        raise AssertionError("Expected database refusal: " + sql)
    return result.stdout.strip()


def check(condition, label):
    global checks
    if not condition:
        raise AssertionError(label)
    checks += 1


def user(sql, uid, *, success=True):
    return run("begin; set local role authenticated; "
               f"set local request.jwt.claim.sub='{uid}'; " + sql + "; commit;", success=success)


def seed(email, role="member", company=None):
    uid = str(uuid.uuid4())
    company_sql = f"'{company}'" if company else "null"
    run(f"insert into public.invites(email, role, company_id) values('{email}', '{role}', {company_sql});"
        f"insert into auth.users(id, email) values('{uid}', '{email}');")
    return uid


def job(uid, company, *, status="open", kind="job", external="null", ident=None):
    return ("insert into public.posts(id, author_id, company_id, kind, title, status, external_url, "
            "role_type, term_season, term_year, published) values "
            f"('{ident or uuid.uuid4()}', '{uid}', '{company}', '{kind}', 'Test', '{status}', {external}, "
            "'internship', 'summer', 2027, true)")


def count(company):
    return int(run(f"select count(*) from public.posts where company_id='{company}' "
                   "and kind='job' and external_url is null and status='open'"))


def race(statements, uid):
    # Keep each first reservation open briefly to force overlapping transactions.
    def attempt(sql):
        try:
            user(sql + "; select pg_sleep(0.15)", uid)
            return True
        except AssertionError as error:
            if "open in-app job limit" not in str(error) and "could not serialize" not in str(error):
                raise
            return False
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(attempt, statements))


run(f'create database "{NAME}"', url=ADMIN)
try:
    run((ROOT / "tests/sql/bootstrap.sql").read_text())
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        run(migration.read_text())
    member = seed("member@test.dev")
    # The queue view must retain RLS and bound old data without rewriting it.
    admin = seed("admin@test.dev")
    run(f"update public.profiles set is_admin=true where id='{admin}'")
    run("alter table public.company_join_requests disable trigger join_request_bounds_guard; "
        "insert into public.company_join_requests(company_name,contact_name,contact_email,note) "
        "values(repeat('x',1000),'Pat','legacy@co.dev',repeat('x',100000)); "
        "alter table public.company_join_requests enable trigger join_request_bounds_guard")
    check(user("select count(*) from public.company_join_request_queue", member) == "0", "queue view preserves member RLS")
    check(user("select char_length(company_name) || ':' || char_length(note) from public.company_join_request_queue", admin) == "200:2000", "legacy queue payload bounded for admins")
    check(run("select char_length(note) from public.company_join_requests") == "100000", "legacy originals preserved")
    run("set role anon; select * from public.company_join_request_queue", success=False)
    run("truncate public.company_join_requests")
    company = str(uuid.uuid4())
    run(f"insert into public.companies(id,name,slug,sponsor_tier_id) "
        f"select '{company}', 'Test', 'test', id from public.sponsor_tiers where key='supporter'")
    recruiter = seed("recruiter@test.dev", "company_user", company)

    # Direct writes use the same DB roles/context as PostgREST, not service bypass.
    good = f"{member}/packages/x/resume.pdf"
    user("insert into public.hiring_packages(member_id,name,linkedin_url,resume_path) "
         f"values('{member}','Safe','https://example.com','{good}')", member)
    for suffix in ["../other/resume.pdf", "packages/../resume.pdf", "packages/%2e%2e/resume.pdf",
                   "packages/x%2f..%2fresume.pdf", "packages/x/resume.pdf?x", "packages/x/resume.pdf#x",
                   "packages/x\\..\\resume.pdf", "packages/x/resume.pdf\n"]:
        user("insert into public.hiring_packages(member_id,name,linkedin_url,resume_path) "
             f"values('{member}','Unsafe','https://example.com','{member}/{suffix}')", member, success=False)
        check(True, "unsafe package refused")
    user(f"update public.profiles set photo_path='{member}/photo.webp' where id='{member}'", member)
    user(f"update public.profiles set photo_path='{member}/../../resumes/other.pdf' where id='{member}'", member, success=False)
    check(True, "cross-bucket photo refused")
    post = str(uuid.uuid4())
    run(job(recruiter, company, ident=post))
    for suffix in ["..", "%2e%2e", "../victim/resume.pdf"]:
        application = str(uuid.uuid4())
        user("insert into public.applications(id,member_id,kind,post_id,resume_path) "
             f"values('{application}','{member}','in_app','{post}','snapshots/{application}/{suffix}')",
             member, success=False)
        check(True, "unsafe application snapshot refused")
    application = str(uuid.uuid4())
    user("insert into public.applications(id,member_id,kind,post_id,resume_path) "
         f"values('{application}','{member}','in_app','{post}','snapshots/{application}/resume.pdf')", member)
    check(True, "canonical application snapshot accepted")
    run(f"delete from public.posts where id='{post}'")

    request = "insert into public.company_join_requests(company_name,contact_name,contact_email) values('Co','Pat','pat@co.dev')"
    run("set role anon; " + request, success=False)
    user(request, member, success=False)
    call = ("select public.submit_join_request('Co',null,'Pat','pat@co.dev',null,'" + "a"*64 + "')")
    run("set role anon; " + call, success=False)
    user(call, member, success=False)
    check(True, "direct insert and RPC closed to both public roles")
    first = run("set role service_role; " + call)
    duplicate = run("set role service_role; " + call.replace("pat@co.dev", " PAT@CO.DEV ").replace("'Co'", "'Changed'"))
    check(first == duplicate, "new and duplicate RPC responses match")
    check(run("select count(*) || ':' || min(company_name) from public.company_join_requests") == "1:Co", "duplicate preserves first request")
    for n in range(10):
        run("set role service_role; " + call.replace("pat@co.dev", f"pat{n}@co.dev"))
    check(run("select count(*) from public.company_join_requests") == "4", "five source attempts/hour including duplicate")
    run("set role service_role; " + call.replace("'Co'", "repeat('x',201)"), success=False)
    run(request.replace("'Co'", "repeat('x',201)"), success=False)
    check(True, "bounds at RPC and table")
    run("truncate public.company_join_requests; delete from connect_private.join_admission;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda n: run("set role service_role; " + call.replace("pat@co.dev", f"parallel{n}@co.dev")), range(12)))
    check(run("select count(*) from public.company_join_requests") == "5", "source budget survives concurrency")
    run("truncate public.company_join_requests; delete from connect_private.join_admission;")
    for n in range(105):
        run("set role service_role; " + call.replace("pat@co.dev", f"global{n}@co.dev").replace("a"*64, f"{n:064x}"))
    check(run("select count(*) from public.company_join_requests") == "100", "global budget bounds rotating sources")
    # Exercise daily and queue ceilings without waiting for wall-clock windows.
    run("truncate public.company_join_requests; delete from connect_private.join_admission; "
        "insert into connect_private.join_admission(key,used,expires_at) "
        "select 'global-day:' || floor(extract(epoch from clock_timestamp()) / 86400), 500, now() + interval '1 day'")
    run("set role service_role; " + call)
    check(run("select count(*) from public.company_join_requests") == "0", "daily admission ceiling")
    run("delete from connect_private.join_admission; "
        "insert into public.company_join_requests(company_name,contact_name,contact_email) "
        "select 'Co','Pat','queue' || n || '@co.dev' from generate_series(1,1000) n")
    run("set role service_role; " + call)
    check(run("select count(*) from public.company_join_requests") == "1000", "pending queue ceiling")
    run("truncate public.company_join_requests; delete from connect_private.join_admission;")
    for n in range(5):
        run("set role service_role; " + call.replace("a"*64, f"{n:064x}"))
    check(run("select used from connect_private.join_admission where key like 'email:%'") == "4", "email budget saturates across sources")
    # Expired admission rows are reclaimed and do not block a fresh window.
    run("update connect_private.join_admission set expires_at=now()-interval '1 second'")
    run("set role service_role; " + call.replace("pat@co.dev", "fresh@co.dev"))
    check(run("select count(*) from connect_private.join_admission where expires_at < now()") == "0", "expired bookkeeping reclaimed")

    # A finite-cap company cannot claim two slots in one statement or race.
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    statement = job(recruiter, company, ident=a)
    values = job(recruiter, company, ident=b).split(" values ")[1]
    user(statement + ", " + values, recruiter, success=False)
    check(count(company) == 0, "bulk insert rolls back every row/slot")
    outcomes = race([job(recruiter, company) for _ in range(6)], recruiter)
    check(sum(outcomes) == 1 and count(company) == 1, "concurrent insert cannot overbook")
    run(f"update public.posts set status='closed' where company_id='{company}'")
    outcomes = race(["set transaction isolation level repeatable read; select count(*) from public.posts; " +
                     job(recruiter, company) for _ in range(4)], recruiter)
    check(sum(outcomes) == 1 and count(company) == 1, "stronger isolation cannot overbook")
    user(f"update public.posts set title='Still editable' where company_id='{company}'", recruiter)
    run(f"update public.posts set status='closed' where company_id='{company}'")
    closed = [str(uuid.uuid4()), str(uuid.uuid4())]
    for ident in closed:
        user(job(recruiter, company, status="closed", ident=ident), recruiter)
    user(f"update public.posts set status='open' where id in ('{closed[0]}','{closed[1]}')", recruiter, success=False)
    check(count(company) == 0, "bulk reopen rolls back")
    outcomes = race([f"update public.posts set status='open' where id='{ident}'" for ident in closed], recruiter)
    check(sum(outcomes) == 1 and count(company) == 1, "concurrent reopen cannot overbook")
    run(f"update public.posts set status='closed' where company_id='{company}'")
    links = [str(uuid.uuid4()), str(uuid.uuid4())]
    for ident in links:
        user(job(recruiter, company, external="'https://example.com'", ident=ident), recruiter)
    outcomes = race([f"update public.posts set external_url=null where id='{ident}'" for ident in links], recruiter)
    check(sum(outcomes) == 1 and count(company) == 1, "concurrent external-to-in-app conversion cannot overbook")
    run(f"insert into public.company_capability_overrides(company_id,capability,granted,value) values('{company}','post_in_app_job',true,2)")
    user(job(recruiter, company), recruiter)
    check(count(company) == 2, "override quota honored")
    run(f"update public.company_capability_overrides set value=null where company_id='{company}'")
    for _ in range(3):
        user(job(recruiter, company), recruiter)
    check(count(company) == 5, "unlimited quota honored")
    # Upserts must not reserve a second slot for a same-slot edit.
    existing = run(f"select id from public.posts where company_id='{company}' and status='open' and kind='job' and external_url is null limit 1")
    run(f"update public.company_capability_overrides set value=5 where company_id='{company}'")
    user(job(recruiter, company, ident=existing) + " on conflict(id) do update set title=excluded.title", recruiter)
    check(run(f"select used from connect_private.job_slots where company_id='{company}'") == "5", "upsert consumes no extra slot")
    run(f"update public.company_capability_overrides set value=1 where company_id='{company}'")
    user(f"update public.posts set title='After downgrade' where id='{existing}'", recruiter)
    user(f"select public.close_own_post('{existing}')", recruiter)
    check(count(company) == 4, "over-quota editing/closing survives downgrade")
    other = str(uuid.uuid4())
    run(f"insert into public.companies(id,name,slug,sponsor_tier_id) "
        f"select '{other}', 'Other', 'other', id from public.sponsor_tiers where key='supporter'")
    second = seed("second@test.dev", "company_user", other)
    user(job(second, other), second)
    check(count(other) == 1, "companies have independent quotas")
    user(job(second, other), second, success=False)
    run(f"delete from public.posts where company_id='{other}'")
    user(job(second, other), second)
    check(count(other) == 1, "deleting a job releases its slot")
    run(f"delete from public.companies where id='{other}'")
    check(run(f"select count(*) from connect_private.job_slots where company_id='{other}'") == "0", "company cascade removes counters safely")
    run(f"update public.company_capability_overrides set granted=false where company_id='{company}'")
    user(job(recruiter, company), recruiter, success=False)
    check(True, "revoked capability cannot acquire a slot")
    run("select public.test_reset()")
    check(run("select count(*) from connect_private.job_slots") == "0", "reset clears slot bookkeeping")
    print(f"PASS: {checks} database boundary and concurrency checks; all migrations applied.")
finally:
    run(f'drop database "{NAME}" with (force)', url=ADMIN)
