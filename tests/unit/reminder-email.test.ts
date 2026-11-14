import { expect, it } from "vitest";
import { reminderMail } from "@/modules/sales/domain/email";
it("renders bilingual reminder text with escaped names and no header injection", () => {
  const data = { number: "F-1\r\nBcc: hidden", issuer: "Atelier <script>", customer: "Client & <img>", dueDate: "2026-06-01", asOf: "2026-06-05", outstanding: "100,00 $" };
  for (const locale of ["fr-CA", "en"] as const) {
    const message = reminderMail(data, locale);
    expect(message.subject).not.toMatch(/[\r\n]/); expect(message.html).not.toContain("<script>"); expect(message.html).not.toContain("<img>");
    expect(message.html).toContain("Client &amp; &lt;img&gt;"); expect(message.text).toContain("100,00 $"); expect(message.text).toContain("2026-06-01"); expect(message.text).toContain("2026-06-05");
    expect(message.text).toContain(locale === "en" ? "already paid" : "déjà payé");
  }
});
