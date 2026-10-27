import { NAVIGATION_GROUPS, matchesNavigationPath } from "@/app/c/[companyId]/navigation-groups";
import { describe, expect, it } from "vitest";
import { canAccessArea, canAccessRoute, ROUTE_ACCESS, visibleAreaRoutes } from "@/app/c/[companyId]/navigation-access";
import { AREAS } from "@/app/c/[companyId]/sections";
import type { AccessContext } from "@/modules/companies";

describe("company navigation authorization", () => {
  it("does not expose administrator shortcuts to accountants or readers", () => {
    for (const role of ["ACCOUNTANT", "READ_ONLY", "USER"] as const) {
      expect(visibleAreaRoutes({ role }, "banque")).toContain("transactions");
      expect(visibleAreaRoutes({ role }, "banque")).not.toContain("integrations");
      expect(canAccessRoute({ role }, "utilisateurs")).toBe(false);
    }
    expect(visibleAreaRoutes({ role: "OWNER" }, "banque")).toContain("integrations");
  });

  it("keeps a directory-only member out of financial activity hubs", () => {
    const member: AccessContext = { role: "USER", moduleAccess: { contacts: "read", catalog: "none", sales: "none", accounting: "none", taxes: "none", audit: "none" } };
    expect(visibleAreaRoutes(member, "depenses")).toEqual(["contacts"]);
    expect(canAccessArea(member, "depenses")).toBe(true);
    for (const area of ["ventes", "banque", "rapports", "comptabilite", "tresorerie", "taxes"] as const) expect(canAccessArea(member, area), area).toBe(false);
    expect(canAccessRoute(member, "contacts")).toBe(true);
    expect(canAccessRoute(member, "entreprise")).toBe(true);
  });

  it("requires both sales and accounting for receivables aging", () => {
    const member: AccessContext = { role: "READ_ONLY", moduleAccess: { sales: "none" } };
    expect(visibleAreaRoutes(member, "rapports")).toContain("bilan");
    expect(visibleAreaRoutes(member, "rapports")).not.toContain("age-clients");
    expect(canAccessRoute({ ...member, moduleAccess: { accounting: "none" } }, "age-clients")).toBe(false);
    expect(canAccessRoute({ role: "READ_ONLY" }, "age-clients")).toBe(true);
  });

  it("requires an explicit policy for each current shortcut and rejects unknown routes", () => {
    for (const area of Object.values(AREAS)) for (const route of area.links) expect(Object.hasOwn(ROUTE_ACCESS, route), route).toBe(true);
    expect(canAccessRoute({ role: "OWNER" }, "future-unregistered-page")).toBe(false);
    expect(canAccessRoute({ role: "OWNER" }, "constructor")).toBe(false);
  });
});


describe("contextual navigation", () => {
  it("assigns each tool to only one parent and an explicit permission policy", () => {
    const routes = Object.values(NAVIGATION_GROUPS).flat();
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(Object.hasOwn(ROUTE_ACCESS, route)).toBe(true);
  });
  it("retains the active tab on child pages without matching a route prefix", () => {
    expect(matchesNavigationPath("/c/acme/factures/validees/123", "/c/acme/factures")).toBe(true);
    expect(matchesNavigationPath("/c/acme/factures", "/c/acme/factures")).toBe(true);
    expect(matchesNavigationPath("/c/acme/factures-autres", "/c/acme/factures")).toBe(false);
    expect(matchesNavigationPath("/c/other/factures", "/c/acme/factures")).toBe(false);
  });
});
