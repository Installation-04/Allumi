import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { contentSecurityPolicy, newNonce } from "@/platform/csp";

const directive = (policy: string, name: string) => policy.split(";").map((part) => part.trim()).find((part) => part === name || part.startsWith(`${name} `)) ?? "";

describe("nonce", () => {
  it("is 128 random bits in base64, safe to put in a header, and never repeats", () => {
    const nonces = Array.from({ length: 2000 }, newNonce);
    expect(new Set(nonces).size).toBe(nonces.length);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    }
  });
});

describe("content security policy", () => {
  const policy = contentSecurityPolicy("abc123==");

  it("lets scripts and styles run only with the request's nonce, and never allows inline scripts", () => {
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'nonce-abc123=='");
    expect(directive(policy, "script-src") + directive(policy, "style-src")).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(policy).not.toMatch(/script-src[^;]*https?:/);
  });

  it("limits unsafe-inline to style attributes (the error page), which a nonce cannot cover", () => {
    expect(directive(policy, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
    expect(policy.match(/unsafe-inline/g)).toHaveLength(1);
  });

  it("keeps the protections the previous policy had", () => {
    for (const expected of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(directive(policy, expected.split(" ")[0]!)).toBe(expected);
    }
  });

  it("allows the data: URL of the two-factor QR code and nothing remote", () => {
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  });

  it("never upgrades to https: Allumi is served over plain HTTP by design", () => {
    expect(contentSecurityPolicy("n", { development: true })).not.toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("allows eval and websockets only in development", () => {
    const development = contentSecurityPolicy("n", { development: true });
    expect(directive(development, "script-src")).toContain("'unsafe-eval'");
    expect(directive(development, "connect-src")).toContain("ws:");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("ws:");
  });
});

describe("proxy", () => {
  const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? "")?.[1];

  it("gives every page response a fresh nonce and hands the same policy to the rendering request", () => {
    const [first, second] = [proxy(new NextRequest("http://localhost/connexion")), proxy(new NextRequest("http://localhost/connexion"))];
    const policy = first.headers.get("content-security-policy");
    expect(nonceOf(policy)).toBeTruthy();
    expect(nonceOf(second.headers.get("content-security-policy"))).not.toBe(nonceOf(policy));
    // Next reads the nonce from the request it renders: these are the overridden request headers.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(policy));
  });

  it("still sends visitors without a session to the sign-in page, as before", () => {
    const response = proxy(new NextRequest("http://localhost/compte/securite"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/connexion");
  });
});
