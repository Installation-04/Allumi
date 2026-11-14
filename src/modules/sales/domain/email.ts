export type InvoiceMailData = {
  number: string; issuer: string[]; customer: string[]; issueDate: string; dueDate: string | null;
  reference: string | null; memo: string | null; subtotal: string; total: string;
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
  taxes: { label: string; amount: string }[];
};
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A balance reminder deliberately excludes invoice notes, private links and line details. */
export function reminderMail(data: { number: string; issuer: string; customer: string; dueDate: string; asOf: string; outstanding: string }, locale: "fr-CA" | "en") {
  const en = locale === "en";
  const subject = `${en ? "Payment reminder" : "Rappel de paiement"} · ${data.number}`.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 200);
  const lines = [data.issuer, "", `${en ? "Hello" : "Bonjour"} ${data.customer},`, "",
    en ? `Our records show an outstanding balance for invoice ${data.number}.` : `Nos dossiers indiquent un solde à payer pour la facture ${data.number}.`,
    `${en ? "Due date" : "Échéance"}: ${data.dueDate}`,
    `${en ? "Outstanding balance (CAD)" : "Solde à payer (CAD)"}: ${data.outstanding}`,
    `${en ? "Balance checked on" : "Solde vérifié le"}: ${data.asOf}`, "",
    en ? "If you have already paid or have a question, please contact us so we can review your account." : "Si vous avez déjà payé ou avez une question, veuillez communiquer avec nous afin de vérifier votre compte.",
    "", en ? "Thank you." : "Merci."];
  return { subject, text: lines.join("\n"), html: `<!doctype html><html lang="${locale}"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#292524;max-width:680px;margin:auto;padding:20px">${lines.map(l => `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(l)}</p>`).join("")}</body></html>` };
}

/** Standalone invoice: no external resources, private app links or uploaded evidence. */
export function invoiceMail(data: InvoiceMailData, locale: "fr-CA" | "en") {
  const l = locale === "en" ? { invoice: "Invoice", date: "Date", due: "Due date", customer: "Bill to", reference: "Reference", subtotal: "Subtotal", total: "Total (CAD)", description: "Description", quantity: "Quantity", price: "Unit price (CAD)", amount: "Amount" }
    : { invoice: "Facture", date: "Date", due: "Échéance", customer: "Facturé à", reference: "Référence", subtotal: "Sous-total", total: "Total (CAD)", description: "Description", quantity: "Quantité", price: "Prix unitaire (CAD)", amount: "Montant" };
  const title = `${l.invoice} ${data.number}`;
  const details = [`${l.date}: ${data.issueDate}`, ...(data.dueDate ? [`${l.due}: ${data.dueDate}`] : []), ...(data.reference ? [`${l.reference}: ${data.reference}`] : [])];
  const summary = [`${l.subtotal}: ${data.subtotal}`, ...data.taxes.map(t => `${t.label}: ${t.amount}`), `${l.total}: ${data.total}`];
  const text = [title, ...data.issuer, "", l.customer, ...data.customer, "", ...details, "", ...data.lines.map(line => `${line.description}\n${line.quantity} × ${line.unitPrice} CAD — ${line.amount}`), "", ...summary, "", data.memo ?? ""].join("\n");
  const paragraphs = (lines: string[]) => lines.map(line => `<p style="margin:4px 0;white-space:pre-wrap">${escape(line)}</p>`).join("");
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#292524;max-width:680px;margin:auto;padding:20px"><h1>${escape(title)}</h1>${paragraphs(data.issuer)}<h2>${l.customer}</h2>${paragraphs(data.customer)}<hr>${paragraphs(details)}<table style="width:100%;border-collapse:collapse"><thead><tr>${[l.description,l.quantity,l.price,l.amount].map(s=>`<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid #ccc">${s}</th>`).join("")}</tr></thead><tbody>${data.lines.map(line=>`<tr>${[line.description,line.quantity,line.unitPrice,line.amount].map(v=>`<td style="padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere">${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>${paragraphs(summary)}${paragraphs(data.memo ? [data.memo] : [])}</body></html>`;
  return { subject: `${title} · ${data.issuer[0] ?? "Allumi"}`.replace(/[\r\n]/g," ").slice(0,200), text, html };
}
