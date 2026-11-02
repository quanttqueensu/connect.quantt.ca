import { afterEach, describe, expect, it, vi } from "vitest";

import { createHubClient } from "@/lib/db/client";
import type { R2BucketLike } from "@/lib/db/storage";
import { markConversationRead } from "../lib/message-read";

import { addCompany, addMember, all, asD1, freshDb, run, uuid, viewer } from "./db/sqlite";

afterEach(() => vi.restoreAllMocks());

const noFiles = {} as R2BucketLike;

function setup() {
  const raw = freshDb();
  const member = addMember(raw);
  const firm = addCompany(raw, "partner");
  const id = uuid();
  run(raw, `INSERT INTO conversations (id, member_id, company_id) VALUES (?, ?, ?)`, id, member, firm.companyId);
  const as = (profileId: string) =>
    createHubClient({
      db: asD1(raw),
      files: noFiles,
      principal: { kind: "user", viewer: viewer(raw, profileId, new Date()) },
      fileLinks: null,
    });
  return { raw, member, firm, id, as };
}

describe("conversation read markers", () => {
  it("updates only the member's read marker for a member", async () => {
    const { raw, member, id, as } = setup();
    await markConversationRead(as(member), { id: member, role: "member" }, id);
    const row = all(raw, `SELECT member_last_read_at, company_last_read_at FROM conversations WHERE id = ?`, id)[0];
    expect(Number.isFinite(Date.parse(String(row.member_last_read_at)))).toBe(true);
    expect(row.company_last_read_at).toBeNull();
  });

  it("updates only the firm's read marker for a company user", async () => {
    const { raw, firm, id, as } = setup();
    await markConversationRead(as(firm.userId), { id: firm.userId, role: "company_user" }, id);
    const row = all(raw, `SELECT member_last_read_at, company_last_read_at FROM conversations WHERE id = ?`, id)[0];
    expect(row.member_last_read_at).toBeNull();
    expect(Number.isFinite(Date.parse(String(row.company_last_read_at)))).toBe(true);
  });

  it("logs a silent refusal without throwing or redirecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { raw, id, as } = setup();
    const stranger = addMember(raw);
    await markConversationRead(as(stranger), { id: stranger, role: "member" }, id);
    expect(warn).toHaveBeenCalledWith(`markRead: conversation ${id} refused for profile ${stranger}`);
    expect(all(raw, `SELECT member_last_read_at FROM conversations WHERE id = ?`, id)[0].member_last_read_at).toBeNull();
  });
});
