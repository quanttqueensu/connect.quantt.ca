import { describe, expect, it } from "vitest";
import {
  authCallbackNeedsPassword,
  parseAuthHash,
  safeAuthNext,
  shouldForwardToAuthCallback,
} from "../lib/auth-session";

describe("invite / recovery links that miss /auth/callback", () => {
  it("forwards a PKCE code that landed on /login", () => {
    expect(
      shouldForwardToAuthCallback("/login", "?code=abc", ""),
    ).toBe(true);
  });

  it("forwards a token_hash invite that landed on /", () => {
    expect(
      shouldForwardToAuthCallback("/", "?token_hash=xyz&type=invite", ""),
    ).toBe(true);
  });

  it("forwards implicit-flow tokens in the hash", () => {
    expect(
      shouldForwardToAuthCallback(
        "/login",
        "",
        "#access_token=a&refresh_token=b&type=invite",
      ),
    ).toBe(true);
  });

  it("forwards a hash error so the callback can show login_link_expired", () => {
    expect(
      shouldForwardToAuthCallback("/login", "", "#error=access_denied"),
    ).toBe(true);
  });

  it("does not steal a normal password-login error banner", () => {
    expect(
      shouldForwardToAuthCallback("/login", "?error=login_failed", ""),
    ).toBe(false);
  });

  it("leaves auth.quantt.ca's code for the QUANTT sign-in callback", () => {
    expect(
      shouldForwardToAuthCallback("/auth/quantt/callback", "?code=abc", ""),
    ).toBe(false);
  });

  it("does not loop on the callback page itself", () => {
    expect(
      shouldForwardToAuthCallback("/auth/callback", "?code=abc", ""),
    ).toBe(false);
  });

  it("parses invite hashes", () => {
    const parsed = parseAuthHash("#access_token=a&refresh_token=b&type=invite");
    expect(parsed.access_token).toBe("a");
    expect(parsed.refresh_token).toBe("b");
    expect(parsed.type).toBe("invite");
  });

  it("forwards a PKCE code that landed on /for-companies or /feed", () => {
    expect(shouldForwardToAuthCallback("/for-companies", "?code=abc", "")).toBe(true);
    expect(shouldForwardToAuthCallback("/feed", "?code=abc", "")).toBe(true);
  });
});

describe("auth callback next / password-setup detection", () => {
  it("allowlists only /auth/set-password", () => {
    expect(safeAuthNext("/auth/set-password")).toBe("/auth/set-password");
    expect(safeAuthNext("/auth/set-password?x=1")).toBe("/auth/set-password");
  });

  it("rejects open redirects and relative escapes", () => {
    expect(safeAuthNext("https://evil.example/phish")).toBeNull();
    expect(safeAuthNext("//evil.example")).toBeNull();
    expect(safeAuthNext("/\\evil.example")).toBeNull();
    expect(safeAuthNext("/feed")).toBeNull();
    expect(safeAuthNext("/auth/set-password/../../login")).toBeNull();
  });

  it("sends PKCE recovery (type missing, next=set-password) to set-password", () => {
    expect(
      authCallbackNeedsPassword({
        exchanged: true,
        type: null,
        next: "/auth/set-password",
        userMustSetPassword: false,
      }),
    ).toBe(true);
  });

  it("sends invite/recovery types to set-password after exchange", () => {
    expect(
      authCallbackNeedsPassword({
        exchanged: true,
        type: "recovery",
        next: null,
        userMustSetPassword: false,
      }),
    ).toBe(true);
  });

  it("does not lock an existing session just because ?type=invite is in the URL", () => {
    expect(
      authCallbackNeedsPassword({
        exchanged: false,
        type: "invite",
        next: "/auth/set-password",
        userMustSetPassword: false,
      }),
    ).toBe(false);
  });

  it("still honors must_set_password on an existing session", () => {
    expect(
      authCallbackNeedsPassword({
        exchanged: false,
        type: null,
        next: null,
        userMustSetPassword: true,
      }),
    ).toBe(true);
  });
});
