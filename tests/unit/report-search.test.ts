import { existsSync } from "node:fs";
import { expect,it } from "vitest";
import { SEARCH_REPORTS,reportSearchCatalog,parseSearchFilters } from "@/modules/search";
import { canAccessRoute } from "@/app/c/[companyId]/navigation-access";
it("only advertises existing report routes with permission requirements matching navigation",()=>{
 expect(new Set(SEARCH_REPORTS.map(r=>r.id)).size).toBe(15);
 for(const r of SEARCH_REPORTS){expect(existsSync(`src/app/c/[companyId]/${r.id}/page.tsx`)).toBe(true);for(const sales of ["none","read"] as const)for(const contacts of ["none","read"] as const)for(const taxes of ["none","read"] as const){const moduleAccess={accounting:"read" as const,sales,contacts,taxes};const record=reportSearchCatalog("en").find(v=>v.id===r.id)!;expect(canAccessRoute({role:"ACCOUNTANT",moduleAccess},r.id.split('/')[0]!)).toBe((!record.sales||sales==="read")&&(!record.contacts||contacts==="read")&&(!record.taxes||taxes==="read"));}}
});
it("localizes report names, keeps bilingual accentless terms and recognizes report filters",()=>{
 expect(reportSearchCatalog("fr-CA").find(r=>r.id==="resultats")?.terms).toContain("Etat des resultats");expect(reportSearchCatalog("en").find(r=>r.id==="resultats")?.name).toBe("Profit and loss");expect(parseSearchFilters({type:"REPORT",statut:"AVAILABLE"},"en")).toMatchObject({kind:"REPORT",status:"AVAILABLE"});
});
