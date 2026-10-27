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
