import { describe, expect, it } from "vitest";

import { inviteEmail } from "@/lib/cf-auth/email";

describe("invite email", () => {
  it("points alumni to the Discord join page", () => {
    const { text, html } = inviteEmail("Ali", "https://connect.quantt.ca/alumni/login", "alumni");
    expect(text).toContain("https://connect.quantt.ca/alumni/discord");
    expect(html).toContain('href="https://connect.quantt.ca/alumni/discord"');
  });

  it("leaves member and sponsor invites unchanged", () => {
    for (const audience of ["member", "sponsor"] as const) {
      const { text, html } = inviteEmail("Rita", "https://connect.quantt.ca/login", audience);
      expect(text).not.toContain("Discord");
      expect(html).not.toContain("Discord");
    }
  });
});
