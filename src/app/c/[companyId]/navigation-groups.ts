/** One canonical home per tool keeps global navigation distinct from contextual tabs. */
export const NAVIGATION_GROUPS = {
  depenses: ["achats", "depenses", "credits-fournisseurs", "decaissements"],
  ventes: ["factures", "avoirs", "encaissements", "contacts", "catalogue"],
  banque: ["transactions", "rapprochement", "integrations"],
  comptabilite: ["comptes", "journal", "balance", "exercices"],
  rapports: ["resultats", "bilan", "grand-livre", "age-clients"],
} as const;

export function matchesNavigationPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
