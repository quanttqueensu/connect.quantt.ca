#!/usr/bin/env python3
"""Verify profile document migration, privacy, and resume-book behavior in disposable local Postgres.
Usage: python3 scripts/test-profile-documents-db.py postgresql://127.0.0.1:55441/postgres
Uses the repository's Auth/Storage SQL fixture, not Supabase HTTP services.
"""
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
admin = sys.argv[1] if len(sys.argv) == 2 else ""
parsed = urlsplit(admin)
if parsed.scheme not in ("postgres", "postgresql") or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.query:
    sys.exit("Supply an explicit loopback-only PostgreSQL URL.")
name = "connect_documents_" + uuid.uuid4().hex[:12]
db = urlunsplit(parsed._replace(path="/" + name))
checks = 0


def run(sql, url=None, success=True):
    result = subprocess.run(["/opt/homebrew/bin/psql", "-XqAt", "-v", "ON_ERROR_STOP=1", url or db],
                            input=sql, text=True, capture_output=True,
                            env={**os.environ, "PGCONNECT_TIMEOUT": "5"})
    if success and result.returncode:
        raise AssertionError(result.stderr)
    if not success and not result.returncode:
        raise AssertionError("Expected refusal: " + sql)
    return result.stdout.strip()


def user(sql, uid, success=True):
    return run(f"begin; set local role authenticated; set local request.jwt.claim.sub='{uid}'; {sql}; commit", success=success)


def check(value, label):
    global checks
    if not value:
        raise AssertionError(label)
    checks += 1


def seed(email, role="member", company=None):
    uid = str(uuid.uuid4())
    cid = f"'{company}'" if company else "null"
    run(f"insert into public.invites(email,role,company_id) values('{email}','{role}',{cid});"
        f"insert into auth.users(id,email) values('{uid}','{email}')")
    return uid


run(f'create database "{name}"', admin)
try:
    run((ROOT / "tests/sql/bootstrap.sql").read_text())
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    for migration in migrations:
        if migration.name.endswith("_profile_documents.sql"):
            break
        run(migration.read_text())
    member = seed("member@docs.test")
    other = seed("other@docs.test")
    def package(uid, suffix, default=False, created="2026-10-31"):
        run("insert into public.hiring_packages(member_id,name,linkedin_url,resume_path,cover_letter_path,cover_letter,is_default,created_at) "
            f"values('{uid}','Legacy','https://example.com','{uid}/packages/{suffix}/resume.pdf',"
            f"'{uid}/packages/{suffix}/cover.pdf','Legacy text',{str(default).lower()},'{created}')")
    package(member, "chosen", True, "2026-01-01")
    package(member, "newer", False)
    package(other, "old", False, "2026-01-01")
    package(other, "latest", False)
    for migration in migrations:
        if migration.name.endswith("_profile_documents.sql"):
            run(migration.read_text())
    check(user("select resume_path from public.member_documents", member) == f"{member}/packages/chosen/resume.pdf", "imports previous default")
    check(user("select resume_path from public.member_documents", other) == f"{other}/packages/latest/resume.pdf", "falls back to newest package")
    check(user("select cover_letter from public.member_documents", member) == "Legacy text", "preserves legacy cover text")
    check(run("select count(*) from public.hiring_packages") == "4", "keeps historical packages")
    check(user(f"select count(*) from public.member_documents where member_id='{member}'", other) == "0", "other members cannot read documents")
    check(user(f"update public.member_documents set cover_letter='stolen' where member_id='{member}' returning member_id", other) == "", "other members cannot edit documents")
    user(f"update public.member_documents set member_id='{other}' where member_id='{member}'", member, False)
    check(True, "cannot reassign document ownership")
    user(f"update public.member_documents set resume_path='{other}/packages/x/resume.pdf' where member_id='{member}'", member, False)
    user(f"update public.member_documents set cover_letter_path='{member}/packages/../cover.pdf' where member_id='{member}'", member, False)
    check(True, "unsafe or cross-owner paths refused")
    run("set role anon; select * from public.member_documents", success=False)
    check(True, "anonymous access denied")
    firm = str(uuid.uuid4())
    run(f"insert into public.companies(id,name,slug,sponsor_tier_id) select '{firm}','Docs Co','docs-co',id from public.sponsor_tiers where key='principal'")
    recruiter = seed("recruiter@docs.test", "company_user", firm)
    check(user("select count(*) from public.member_documents", recruiter) == "0", "recruiters cannot read private document rows")
    user(f"insert into public.member_documents(member_id,resume_path) values('{recruiter}','{recruiter}/packages/x/resume.pdf')", recruiter, False)
    check(True, "recruiters cannot create profile documents")
    check(user("select count(*) from public.resume_book_list()", recruiter) == "0", "consent required")
    user(f"update public.profiles set resume_book_opt_in=true where id='{member}'", member)
    check(user("select id from public.resume_book_list()", recruiter) == member, "resume book uses profile documents")
    check(user("select id from public.candidate_search_list()", recruiter) == member, "search uses profile documents")
    post, application = str(uuid.uuid4()), str(uuid.uuid4())
    run(f"insert into public.posts(id,author_id,company_id,kind,title,status,published,role_type,term_season,term_year) values('{post}','{recruiter}','{firm}','job','Role','open',true,'internship','summer',2027)")
    user(f"insert into public.applications(id,member_id,kind,post_id,resume_path) values('{application}','{member}','in_app','{post}','snapshots/{application}/resume.pdf')", member)
    check(True, "application accepts profile documents without a hiring package")
    replacement = f"{member}/packages/replacement/resume.pdf"
    user(f"update public.member_documents set resume_path='{replacement}' where member_id='{member}'", member)
    check(user(f"select resume_path from public.applications where id='{application}'", member) == f"snapshots/{application}/resume.pdf", "profile replacement preserves submitted snapshot")
    check(user(f"select public.talent_resume_path('{member}')", recruiter) == replacement, "resume download follows replacement")
    user(f"update public.member_documents set resume_path=null where member_id='{member}'", member)
    check(user("select count(*) from public.resume_book_list()", recruiter) == "0", "removing resume removes book entry")
    user(f"update public.member_documents set resume_path='{replacement}' where member_id='{member}'", member)
    user(f"update public.profiles set resume_book_opt_in=false where id='{member}'", member)
    check(user(f"select public.talent_resume_path('{member}')", recruiter) == "", "withdrawal immediately blocks download")
    # Upserting one field preserves its sibling, matching the profile actions.
    user(f"insert into public.member_documents(member_id,cover_letter_path) values('{member}','{member}/packages/replacement/cover.pdf') on conflict(member_id) do update set cover_letter_path=excluded.cover_letter_path", member)
    check(user("select resume_path from public.member_documents", member) == replacement, "independent cover update preserves resume")
    run("select public.test_reset()")
    check(run("select count(*) from public.member_documents") == "0", "existing reset cascades documents")
    print(f"PASS: {checks} profile-document database checks; all migrations applied.")
finally:
    run(f'drop database "{name}" with (force)', admin)
