/** Product areas and real shortcuts; planned capabilities are described separately in the hub. */
export const AREAS = {
  ventes: { icon: "contacts", links: ["factures", "avoirs", "contacts", "catalogue", "journal"] },
  depenses: { icon: "journal", links: ["contacts", "catalogue", "journal"] },
  banque: { icon: "accounts", links: ["comptes", "journal"] },
  tresorerie: { icon: "trial", links: ["balance", "journal"] },
  rapports: { icon: "trial", links: ["resultats", "bilan", "balance"] },
  taxes: { icon: "fiscal", links: ["taxes", "comptes"] },
  comptabilite: { icon: "accounts", links: ["comptes", "journal", "balance", "resultats", "bilan", "exercices"] },
  projets: { icon: "overview", links: [] },
  paie: { icon: "contacts", links: [] },
  kilometrage: { icon: "arrow", links: [] },
  applications: { icon: "overview", links: [] },
} as const;
export type Area = keyof typeof AREAS;
