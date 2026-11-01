type Line = { position: number; accountId: string; taxCodeId: string | null; amountCents: bigint };
type Tax = { taxId: string; amountCents: bigint };
type Document = { totalCents: bigint; lines: Line[]; taxes: Tax[] };
/** Mirrors the cumulative source limits in supplier_credit_limits; drafts never reserve a balance. */
export function creditFitsBill(bill: Document, credit: Document, previous: Document[]) {
  if (credit.totalCents <= 0n || credit.totalCents + previous.reduce((n, d) => n + d.totalCents, 0n) > bill.totalCents) return false;
  return credit.lines.every(line => {
    const source = bill.lines.find(l => l.position === line.position);
    const used = previous.flatMap(d => d.lines).filter(l => l.position === line.position).reduce((n,l) => n + l.amountCents,0n);
    return source && line.accountId === source.accountId && line.taxCodeId === source.taxCodeId && line.amountCents >= 0n && line.amountCents + used <= source.amountCents;
  }) && credit.taxes.every(tax => {
    const source = bill.taxes.find(t => t.taxId === tax.taxId);
    const used = previous.flatMap(d => d.taxes).filter(t => t.taxId === tax.taxId).reduce((n,t) => n + t.amountCents,0n);
    return source && tax.amountCents + used <= source.amountCents;
  });
}
