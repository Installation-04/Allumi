import type { Locale } from "@/modules/ledger/client";

/** Existing report forms only; no saved reports, tenant data or inferred reporting periods. */
export const SEARCH_REPORTS = [
  { id: "balance", fr: "Balance de vérification", en: "Trial balance", aliases: "balance verification trial balance" },
  { id: "resultats", fr: "État des résultats", en: "Profit and loss", aliases: "income statement profit loss p&l revenus depenses" },
  { id: "resultats/comparer", fr: "Comparaison des résultats", en: "Profit and loss comparison", aliases: "compare income statement profit loss p&l" },
  { id: "bilan", fr: "Bilan", en: "Balance sheet", aliases: "assets liabilities equity actifs passifs capitaux" },
  { id: "bilan/comparer", fr: "Comparaison des bilans", en: "Balance sheet comparison", aliases: "compare assets liabilities bilan" },
  { id: "grand-livre", fr: "Grand livre", en: "General ledger", aliases: "grand livre ledger compte account" },
  { id: "flux-tresorerie", fr: "Suivi de trésorerie comptabilisée", en: "Recorded cash movements", aliases: "tresorerie cash movements liquidity liquidites" },
  { id: "previsions-tresorerie", fr: "Prévision de trésorerie", en: "Cash flow forecast", aliases: "cash flow forecast projection due date prevision tresorerie echeances liquidites", sales: true },
  { id: "age-clients", fr: "Âge des comptes clients", en: "Accounts receivable aging", aliases: "receivables overdue unpaid clients impayes", sales: true },
  { id: "age-fournisseurs", fr: "Âge des comptes fournisseurs", en: "Accounts payable aging", aliases: "payables supplier vendor overdue fournisseurs" },
  { id: "sommaire-taxes", fr: "Sommaire TPS/TVQ", en: "GST/QST summary", aliases: "taxes taxe vente sales tax tps tvq tvh gst qst hst", taxes: true },
  { id: "sommaire-taxes/comparer", fr: "Comparaison des périodes de taxes", en: "Tax period comparison", aliases: "compare taxes tps tvq tvh gst qst hst", taxes: true },
  { id: "releves-clients", fr: "Relevé de compte client", en: "Customer account statement", aliases: "client customer statement releve", sales: true, contacts: true },
  { id: "releves-fournisseurs", fr: "Relevé de compte fournisseur", en: "Supplier account statement", aliases: "supplier vendor statement fournisseur releve", contacts: true },
] as const;

export function reportSearchCatalog(locale: Locale) {
  return SEARCH_REPORTS.map(report => {
    const terms = `${report.fr} ${report.en} ${report.aliases} ${report.id}`;
    return { id: report.id, name: locale === "en" ? report.en : report.fr,
      terms: `${terms} ${terms.normalize("NFD").replace(/\p{M}/gu, "")}`,
      sales: "sales" in report, contacts: "contacts" in report, taxes: "taxes" in report };
  });
}
