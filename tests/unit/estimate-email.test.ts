import { expect, it } from "vitest";
import { estimateMail, invoiceMail } from "@/modules/sales/domain/email";
it("renders estimates as non-payable proposals with public terms, escaped details and sanitized subjects", () => {
  const data = { number: "DEV-1\r\nBcc: hidden", issuer: ["Atelier <script>"], customer: ["Client & <img>"], issueDate: "2026-06-01", dueDate: "2026-07-01", reference: "REF", subtotal: "$100.00", total: "$114.98", lines: [{ description: "<img>", quantity: "1", unitPrice: "100", amount: "$100.00" }], taxes: [{ label: "GST", amount: "$5.00" }], terms: "Public <terms>" };
  for (const locale of ["fr-CA", "en"] as const) {
    const message = estimateMail(data, locale);
    expect(message.subject).not.toMatch(/[\r\n]/); expect(message.html).not.toContain("<script>"); expect(message.html).toContain("Client &amp; &lt;img&gt;"); expect(message.html).toContain("Public &lt;terms&gt;");
    expect(message.text).toContain(locale === "en" ? "No payment is requested" : "Aucun paiement n’est demandé"); expect(message.text).toContain(locale === "en" ? "Valid until: 2026-07-01" : "Valide jusqu’au: 2026-07-01");
    const invoice = invoiceMail({ ...data, memo: "Invoice note" }, locale); expect(invoice.text).not.toContain("No payment is requested"); expect(invoice.text).toContain("Invoice note");
  }
});
