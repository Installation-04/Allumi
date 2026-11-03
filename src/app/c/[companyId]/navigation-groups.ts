/** One canonical home per tool keeps global navigation distinct from contextual tabs. */
export const NAVIGATION_GROUPS = {
  depenses: ["achats", "depenses", "credits-fournisseurs", "decaissements"],
  ventes: ["factures", "avoirs", "encaissements", "remboursements", "contacts", "catalogue"],
  banque: ["transactions", "depots", "rapprochement", "integrations"],
  comptabilite: ["comptes", "journal", "balance", "exercices"],
  tresorerie: ["flux-tresorerie"],
  rapports: ["resultats", "bilan", "grand-livre", "releves-clients", "age-clients", "age-fournisseurs", "sommaire-taxes"],
} as const;

export function matchesNavigationPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
