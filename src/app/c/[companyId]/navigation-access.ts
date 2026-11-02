import { can, type Action, type AccessContext } from "@/modules/companies";
import { AREAS, type Area } from "./sections";

/** Shared by tabs, the sidebar and activity shortcuts. Unknown destinations are not advertised. */
export const ROUTE_ACCESS: Record<string, readonly Action[]> = {
  "": ["company.read"],
  parametres: ["company.read"],
  contacts: ["contact.read"],
  journal: ["ledger.read"],
  decaissements: ["ledger.read"],
  "credits-fournisseurs": ["ledger.read"],
  depenses: ["ledger.read"],
  achats: ["ledger.read"],
  factures: ["sales.read"],
  avoirs: ["sales.read"],
  encaissements: ["sales.read"],
  catalogue: ["catalog.read"],
  comptes: ["ledger.read"],
  balance: ["ledger.read"],
  exercices: ["ledger.read"],
  taxes: ["taxes.read"],
  entreprise: ["company.read"],
  utilisateurs: ["members.manage"],
  audit: ["audit.read"],
  integrations: ["integration.manage"],
  transactions: ["bank.read"],
  rapprochement: ["bank.read"],
  resultats: ["ledger.read"],
  bilan: ["ledger.read"],
  "flux-tresorerie": ["ledger.read"],
  "grand-livre": ["ledger.read"],
  "sommaire-taxes": ["ledger.read", "taxes.read"],
  "age-fournisseurs": ["ledger.read"],
  "age-clients": ["ledger.read", "sales.read"],
};

const AREA_ACCESS: Partial<Record<Area, readonly Action[]>> = {
  ventes: ["sales.read"],
  banque: ["bank.read"],
  tresorerie: ["ledger.read"],
  rapports: ["ledger.read"],
  taxes: ["taxes.read"],
  comptabilite: ["ledger.read"],
};

export function canAccessRoute(company: AccessContext, route: string): boolean {
  return Object.hasOwn(ROUTE_ACCESS, route) && ROUTE_ACCESS[route]!.every(action => can(company, action));
}

export function visibleAreaRoutes(company: AccessContext, area: Area) {
  return AREAS[area].links.filter(route => canAccessRoute(company, route));
}

export function canAccessArea(company: AccessContext, area: Area): boolean {
  if (!(AREA_ACCESS[area] ?? []).every(action => can(company, action))) return false;
  // Planned areas carry no company data. Existing activity hubs must offer an authorized destination.
  return AREAS[area].links.length === 0 || visibleAreaRoutes(company, area).length > 0;
}
