/** Product areas and real shortcuts; planned capabilities are described separately in the hub. */
export const AREAS = {
  ventes: { icon: "contacts", links: ["factures", "avoirs", "encaissements", "age-clients", "contacts", "catalogue", "journal"] },
  depenses: { icon: "journal", links: ["achats", "depenses", "credits-fournisseurs", "decaissements", "contacts", "catalogue", "journal"] },
  banque: { icon: "accounts", links: ["integrations", "transactions", "rapprochement", "comptes", "journal"] },
  tresorerie: { icon: "trial", links: ["balance", "journal"] },
  rapports: { icon: "trial", links: ["resultats", "bilan", "grand-livre", "age-clients", "balance"] },
  taxes: { icon: "fiscal", links: ["taxes", "comptes"] },
  comptabilite: { icon: "accounts", links: ["comptes", "journal", "grand-livre", "balance", "resultats", "bilan", "exercices"] },
  projets: { icon: "overview", links: [] },
  paie: { icon: "contacts", links: [] },
  kilometrage: { icon: "arrow", links: [] },
  applications: { icon: "overview", links: [] },
} as const;
export type Area = keyof typeof AREAS;
