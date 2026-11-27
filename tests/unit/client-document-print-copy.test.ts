import { expect, it } from "vitest";
import { clientDocumentPrintHtml, type ClientDocumentPrintSnapshot } from "@/modules/contracts/client";

const snapshot: ClientDocumentPrintSnapshot = {
  capturedAt: "2026-06-03T01:02:03.000Z",
  publication: { id: "00000000-0000-7000-8000-000000000105", kind: "CONTRACT", title: "Contrat été 🪷", issuer: "Atelier Exemple", customer: "Camille", recipient: "client@example.test", locale: "en", text: "\n\nPremière ligne\n\nConditions 日本語 🪷\n125.99 CAD/h", sha256: "a".repeat(64) },
  events: { publishedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-08-30T00:00:00.000Z", firstViewedAt: "2026-06-02T00:00:00.000Z", signedAt: "2026-06-02T00:01:00.000Z", revokedAt: "2026-06-03T00:00:00.000Z" },
  signature: { name: "Camille déclaré", email: "client@example.test", consent: "I agree to sign." }
};
it("preserves complete Unicode publication, declared signature and UTC event snapshots", () => {
  const html = clientDocumentPrintHtml(snapshot);
  expect(html).toContain('<html lang="en">');
  for (const value of [snapshot.publication.text, snapshot.publication.title, snapshot.publication.id, snapshot.publication.sha256, snapshot.capturedAt, ...Object.values(snapshot.events), "Camille déclaré", "I agree to sign."]) expect(html).toContain(value);
  expect(html).toContain("Declared signature");expect(html).toContain("not a digitally sealed file");expect(html).toContain("not the signature, events or this file");
});
it("escapes every untrusted field without creating scripts, links, images or other active markup", () => {
  const malicious = '</pre><img src="https://example.test/track" onerror="alert(1)"><script>alert(2)</script>&\'';
  const d = { ...snapshot, publication: { ...snapshot.publication, title: malicious, issuer: malicious, customer: malicious, recipient: malicious, text: malicious, sha256: malicious, id: malicious }, signature: { name: malicious, email: malicious, consent: malicious } };
  const html = clientDocumentPrintHtml(d);
  expect(html).not.toContain(malicious);expect(html).toContain("&lt;/pre&gt;&lt;img src=&quot;");expect(html).toContain("&amp;&#39;");
  expect(html).not.toMatch(/<(script|img|a|form|iframe|object|link|base)\b/i);
});
it("uses the saved French document language and omits absent signature and optional events", () => {
  const html = clientDocumentPrintHtml({ ...snapshot, publication: { ...snapshot.publication, kind: "INVOICE", locale: "fr-CA" }, events: { ...snapshot.events, signedAt: null, firstViewedAt: null, revokedAt: null }, signature: null });
  expect(html).toContain('<html lang="fr-CA">');expect(html).toContain("Copie imprimable · Facture");expect(html).toContain("Aucune signature enregistrée");
  for (const value of ["Signature déclarée", "Lien révoqué le", "Première ouverture via le lien", "undefined", ">null<"]) expect(html).not.toContain(value);
});
it("carries an offline restrictive CSP and excludes unused private snapshot fields", () => {
  const html = clientDocumentPrintHtml(Object.assign({}, snapshot, { canonicalPayload: "PRIVATE-CANONICAL-105", url: "PRIVATE-LINK-105", deliveries: "PRIVATE-SMTP-105" }));
  expect(html).toContain('http-equiv="Content-Security-Policy"');expect(html).toContain("default-src &#39;none&#39;");expect(html).toContain("form-action &#39;none&#39;");expect(html).toContain('<meta charset="utf-8">');
  expect(html).not.toContain("PRIVATE-");expect(html).not.toMatch(/\b(?:src|href)\s*=/i);
});
