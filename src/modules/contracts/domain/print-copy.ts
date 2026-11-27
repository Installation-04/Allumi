export type ClientDocumentPrintSnapshot = {
  capturedAt: string;
  publication: { id: string; kind: "CONTRACT" | "ESTIMATE" | "INVOICE"; title: string; issuer: string; customer: string; recipient: string; locale: "fr-CA" | "en"; text: string; sha256: string };
  events: { publishedAt: string; expiresAt: string; firstViewedAt: string | null; signedAt: string | null; revokedAt: string | null };
  signature: { name: string | null; email: string | null; consent: string | null } | null;
};

// The policy travels with the file when it is opened offline. No executable content or network resources.
export const CLIENT_DOCUMENT_COPY_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Render only the verified publication and declared evidence, never the canonical payload or link secrets. */
export function clientDocumentPrintHtml(snapshot: ClientDocumentPrintSnapshot): string {
  const { publication: d, events, signature } = snapshot, en = d.locale === "en";
  const labels = en ? {
    copy: "Printable copy", instructions: "Confidential copy. Open this file in a browser; use Print to save a PDF. All dates below are UTC.",
    kind: { CONTRACT: "Contract", ESTIMATE: "Estimate", INVOICE: "Invoice" },
    customer: "Client", recipient: "Recipient", reference: "Allumi reference", captured: "Copy generated at", published: "Published at", expires: "Link expires at", viewed: "First opened through link", revoked: "Link revoked at", signed: "Electronically signed at", proof: "Declared signature", pending: "No recorded signature", signer: "Declared signer", email: "Declared email", hash: "Publication SHA-256",
    limits: "This is an exported snapshot, not a digitally sealed file. The hash covers the published content only, not the signature, events or this file. Identity and signing authority have not been verified; no external timestamp is provided. Check current link availability in Allumi."
  } : {
    copy: "Copie imprimable", instructions: "Copie confidentielle. Ouvre ce fichier dans un navigateur; utilise Imprimer pour enregistrer un PDF. Toutes les dates ci-dessous sont en UTC.",
    kind: { CONTRACT: "Contrat", ESTIMATE: "Soumission", INVOICE: "Facture" },
    customer: "Client", recipient: "Destinataire", reference: "Référence Allumi", captured: "Copie générée le", published: "Publié le", expires: "Expiration du lien", viewed: "Première ouverture via le lien", revoked: "Lien révoqué le", signed: "Signé électroniquement le", proof: "Signature déclarée", pending: "Aucune signature enregistrée", signer: "Signataire déclaré", email: "Courriel déclaré", hash: "SHA-256 du contenu publié",
    limits: "Ceci est un instantané exporté, sans signature numérique du fichier. L’empreinte couvre le contenu publié seulement, pas la signature, les événements ou ce fichier. L’identité et le pouvoir de signature ne sont pas vérifiés; aucun horodatage externe n’est fourni. Vérifie la disponibilité actuelle du lien dans Allumi."
  };
  const row = (label: string, value: string) => `<div><dt>${escape(label)}</dt><dd dir="auto">${escape(value)}</dd></div>`;
  const date = (label: string, value: string | null) => value ? row(label, value) : "";
  return `<!doctype html>
<html lang="${d.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escape(CLIENT_DOCUMENT_COPY_CSP)}"><title>${escape(d.title)} — Allumi</title>
<style>html{color-scheme:light}body{font:16px/1.6 system-ui,sans-serif;color:#1c1917;background:#fff;margin:0 auto;padding:1.5rem;max-width:52rem;overflow-wrap:anywhere}h1{font-size:1.8rem;line-height:1.25}h2{font-size:1.2rem}header,section,footer{margin-bottom:1.5rem}dl{margin:0}dl>div{margin:.5rem 0}dt{font-weight:600}dd{margin:0}.document-text,pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.proof{border-top:1px solid #a8a29e;padding-top:1rem}.hash{font-family:monospace;word-break:break-all}.notice,footer{font-size:.875rem;color:#57534e}@page{size:A4;margin:18mm}@media print{body{max-width:none;margin:0;padding:0;font-size:11pt}.instructions{display:none}h1,h2,dt{break-after:avoid}p,pre,.document-text{orphans:3;widows:3}}</style></head>
<body><header><p>${escape(d.issuer)}</p><p>${labels.copy} · ${labels.kind[d.kind]}</p><h1 dir="auto">${escape(d.title)}</h1><p class="instructions notice">${labels.instructions}</p><dl>${row(labels.customer, d.customer)}${row(labels.recipient, d.recipient)}${row(labels.reference, d.id)}${date(labels.published, events.publishedAt)}</dl></header>
<main><div class="document-text" dir="auto">${escape(d.text)}</div><section class="proof"><h2>${signature ? labels.proof : labels.pending}</h2>${signature ? `<dl>${row(labels.signer, signature.name ?? "—")}${row(labels.email, signature.email ?? "—")}${date(labels.signed, events.signedAt)}</dl><pre dir="auto">${escape(signature.consent ?? "")}</pre>` : ""}<h2>${labels.hash}</h2><p class="hash">${escape(d.sha256)}</p></section></main>
<footer><dl>${date(labels.viewed, events.firstViewedAt)}${date(labels.expires, events.expiresAt)}${date(labels.revoked, events.revokedAt)}${date(labels.captured, snapshot.capturedAt)}</dl><p>${labels.limits}</p></footer></body></html>`;
}
