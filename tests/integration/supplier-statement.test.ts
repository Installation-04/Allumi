import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type pg from "pg";
import { amountInput, recordDisbursement, voidDisbursement } from "@/modules/payments";
import { saveDraft, getDraft, postBill, voidBill, getBill, saveCreditDraft, getCreditDraft, postCreditNote, voidCreditNote } from "@/modules/purchases";
import {
  getSupplierStatement,
  getSupplierStatementExport,
  listStatementSuppliers,
} from "@/modules/reports";
import { owner } from "./helpers";
import { asOwnerA, setContext, seedWorld, W } from "./world";
const actor = { userId: W.userOwnerA, companyId: W.companyA };
let db: pg.Client;
async function post(
  date: string,
  cents: bigint,
  contactId: string = W.supplier,
  supplierReference?: string,
) {
  const id = await saveDraft(actor, {
    contactId,
    supplierReference,
    documentDate: date,
    dueDate: date,
    memo: "Internal confidential note",
    lines: [
      {
        description: "Statement fixture",
        quantity: "1",
        unitPrice: amountInput(cents, "en"),
        accountId: W.expenses,
        taxCodeId: W.taxCodeExempt,
      },
    ],
  });
  await postBill(actor, id, (await getDraft(actor, id))!.revision, date);
  return { id };
}
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  await db.query("UPDATE contact SET is_supplier=true WHERE id=$1", [W.otherCustomer]);
  await db.query(
    "INSERT INTO number_sequence(company_id,key,next_value,prefix,padding) VALUES($1,'JOURNAL_ENTRY',1,'J-',5),($1,'PURCHASE_DOCUMENT',1,'A-',5),($1,'PAYMENT_SENT',1,'D-',5)",
    [W.companyA],
  );
});
afterAll(async () => {
  await db?.end();
});
it("carries opening and running balances across pages in journal order and exports every movement", async () => {
  await post("2026-05-31", 1234n);
  const first = await post("2026-06-01", 800n);
  for (let i = 0; i < 103; i++) await post("2026-06-02", BigInt(i + 1));
  await voidBill(actor, first.id, "2026-06-30", "Private reversal reason");
  await post("2026-07-01", 999n);
  await post("2026-06-05", 777n, W.otherCustomer);
  const period = {
    contactId: W.supplier,
    from: "2026-06-01",
    to: "2026-06-30",
  };
  const one = await getSupplierStatement(actor, period),
    two = await getSupplierStatement(actor, { ...period, page: 2 });
  expect(one).toMatchObject({
    openingCents: 1234n,
    debitCents: 800n,
    creditCents: 6156n,
    closingCents: 6590n,
    lineCount: 105,
    pageCount: 2,
  });
  expect(one.rows).toHaveLength(100);
  expect(two.rows).toHaveLength(5);
  const all = await getSupplierStatementExport(actor, period);
  expect(all.rows.map((r) => r.id)).toEqual(
    [...one.rows, ...two.rows].map((r) => r.id),
  );
  expect(all.rows.at(-1)).toMatchObject({
    kind: "REVERSAL",
    balanceCents: 6590n,
  });
  expect(all.rows[0]).toMatchObject({ kind: "BILL", balanceCents: 2034n });
  expect(
    all.rows.every(
      (r, i) =>
        i === 0 ||
        r.balanceCents ===
          all.rows[i - 1]!.balanceCents + r.creditCents - r.debitCents,
    ),
  ).toBe(true);
  expect(
    (await getSupplierStatement(actor, { ...period, page: 999 })).page,
  ).toBe(2);
  await expect(
    getSupplierStatementExport(actor, period, { maxLines: 104 }),
  ).rejects.toMatchObject({ key: "reports.tooManyLines" });
  expect(
    JSON.stringify(all, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  ).not.toMatch(/Internal confidential|Private reversal/);
  const empty = await getSupplierStatement(actor, {
    ...period,
    from: "2026-06-10",
    to: "2026-06-20",
  });
  expect(empty).toMatchObject({
    openingCents: 7390n,
    closingCents: 7390n,
    lineCount: 0,
  });
});
it("keeps payments, supplier credits and their reversals on their own accounting dates", async () => {
  const {id}=await post("2026-05-01",10_000n,W.supplier,"VENDOR-REF-001");
  const source=(await getBill(actor,id))!;
  const credit=await saveCreditDraft(actor,id,{documentDate:"2026-05-02",memo:"Private credit memo",lines:[{lineId:source.lines[0]!.id,amount:"25"}]});
  await postCreditNote(actor,credit,(await getCreditDraft(actor,credit))!.revision,"2026-05-02");
  const payment=await recordDisbursement(actor,{billId:id,date:"2026-05-03",accountId:W.bank,method:"EFT",amountCents:"5000",expectedOpenCents:"7500",memo:"Private payment memo"});
  const period={contactId:W.supplier,from:"2026-05-01",to:"2026-05-03"};
  const paid=await getSupplierStatement(actor,period);
  expect(paid).toMatchObject({openingCents:0n,debitCents:7500n,creditCents:10000n,closingCents:2500n});
  expect(paid.rows.map(r=>r.kind)).toEqual(["BILL","SUPPLIER_CREDIT","PAYMENT"]);
  expect(paid.rows.map(r=>r.balanceCents)).toEqual([10000n,7500n,2500n]);
  expect(paid.rows[0]!.supplierReference).toBe("VENDOR-REF-001");
  await voidDisbursement(actor,payment.id,{date:"2026-05-05",reason:"Private reversal reason"});
  await voidCreditNote(actor,credit,"2026-05-06","Private credit reversal reason");
  await voidBill(actor,id,"2026-05-07","Private bill reversal reason");
  expect(await getSupplierStatement(actor,period)).toEqual(paid);
  const reversed=await getSupplierStatementExport(actor,{...period,to:"2026-05-07"});
  expect(reversed).toMatchObject({openingCents:0n,debitCents:17500n,creditCents:17500n,closingCents:0n,lineCount:6});
  expect(reversed.rows.slice(-3).map(r=>r.kind)).toEqual(["REVERSAL","REVERSAL","REVERSAL"]);
  expect(JSON.stringify(reversed,(_,v)=>typeof v==="bigint"?String(v):v)).not.toMatch(/Private|confidential/);
});

let entrySeq=900_000;
async function loosePayment(direction:"SENT"|"RECEIVED",ledger:"PAYABLE"|"RECEIVABLE",date:string,cents:number) {
  const id=randomUUID(),entry=randomUUID(),received=direction==="RECEIVED";
  await db.query("BEGIN");
  try {
    await setContext(db,asOwnerA);
    await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,source_id,created_by_id) SELECT $1,$2,$3,$4::date,id,'PAYMENT',$5,$6 FROM fiscal_period WHERE company_id=$2 AND $4::date BETWEEN start_date AND end_date",[entry,W.companyA,++entrySeq,date,id,W.userOwnerA]);
    await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,entry_date) VALUES(gen_random_uuid(),$1,$2,1,$3,$4,$5,$6::date)",[W.companyA,entry,W.bank,received?cents:0,received?0:cents,date]);
    await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,contact_id,entry_date) VALUES(gen_random_uuid(),$1,$2,2,$3,$4,$5,$6,$7::date)",[W.companyA,entry,ledger==="PAYABLE"?W.payable:W.receivable,received?0:cents,received?cents:0,W.supplier,date]);
    await db.query("INSERT INTO payment(id,company_id,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,$3::payment_direction,$4::payment_ledger,$5,$6::date,$7,$8,'EFT',$9,$10,now())",[id,W.companyA,direction,ledger,W.supplier,date,cents,W.bank,entry,W.userOwnerA]);
    await db.query("COMMIT");
  } catch(error) { await db.query("ROLLBACK");throw error; }
}

it("includes historical supplier refunds and unapplied payments without mixing the receivable ledger",async()=>{
  await db.query("UPDATE contact SET is_customer=true WHERE id=$1",[W.supplier]);
  await loosePayment("SENT","PAYABLE","2026-05-08",1000);
  await loosePayment("RECEIVED","PAYABLE","2026-05-09",400);
  await loosePayment("RECEIVED","RECEIVABLE","2026-05-09",700);
  const r=await getSupplierStatement(actor,{contactId:W.supplier,from:"2026-05-08",to:"2026-05-10"});
  expect(r).toMatchObject({openingCents:0n,debitCents:1000n,creditCents:400n,closingCents:-600n,lineCount:2});
  expect(r.rows.map(row=>row.kind)).toEqual(["PAYMENT","REFUND"]);
});

it("bounds supplier lookup, escapes wildcard searches and excludes customer-only contacts", async () => {
  for (let i = 0; i < 102; i++)
    await db.query(
      "INSERT INTO contact(id,company_id,is_supplier,display_name,updated_at) VALUES($1,$2,true,$3,now())",
      [
        randomUUID(),
        W.companyA,
        `Search fixture ${String(i).padStart(3, "0")}`,
      ],
    );
  const found = await listStatementSuppliers(actor, "Search fixture");
  expect(found.contacts).toHaveLength(100);
  expect(found.hasMore).toBe(true);
  expect(
    (await listStatementSuppliers(actor, "Search fixture 101")).contacts,
  ).toHaveLength(1);
  expect((await listStatementSuppliers(actor, "%")).contacts).toHaveLength(0);
  const literalId=randomUUID();
  await db.query("INSERT INTO contact(id,company_id,is_supplier,display_name,updated_at) VALUES($1,$2,true,$3,now())",[literalId,W.companyA,"Supplier %_\\ literal"]);
  expect((await listStatementSuppliers(actor,"%_\\")).contacts.map(c=>c.id)).toEqual([literalId]);
  expect(
    (await listStatementSuppliers(actor)).contacts.map((c) => c.id),
  ).not.toContain(W.customer);
  const range = { contactId: W.supplier, from: "2026-06-01", to: "2026-06-30" };
  await db.query("UPDATE contact SET is_active=false WHERE id=$1",[W.supplier]);
  const before = await getSupplierStatement(actor, range);
  expect(before.contact.isActive).toBe(false);
  expect((await listStatementSuppliers(actor,"Fournisseur Fictif")).contacts).toContainEqual({id:W.supplier,displayName:"Fournisseur Fictif",isActive:false});
  await db.query(
    "UPDATE fiscal_period SET status='LOCKED',locked_at=now(),locked_by_id=$2 WHERE company_id=$1",
    [W.companyA, W.userOwnerA],
  );
  await db.query(
    "UPDATE fiscal_year SET status='CLOSED',closed_at=now(),closed_by_id=$2 WHERE company_id=$1",
    [W.companyA, W.userOwnerA],
  );
  expect(await getSupplierStatement(actor, range)).toEqual(before);

  await expect(
    getSupplierStatement(
      { userId: W.userOwnerB, companyId: W.companyB },
      { contactId: W.supplier, from: "2026-01-01", to: "2026-12-31" },
    ),
  ).rejects.toMatchObject({ key: "reports.contact" });
});

it("requires accounting and contacts but permits supplier reporting without sales access",async()=>{
  const reader={...actor,userId:W.userReader};
  const period={contactId:W.supplier,from:"2026-06-01",to:"2026-06-30"};
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify({accounting:"read",contacts:"read",sales:"none"})]);
  expect((await getSupplierStatement(reader,period)).contact.id).toBe(W.supplier);
  expect((await listStatementSuppliers(reader)).contacts.length).toBeGreaterThan(0);
  for(const permissions of [{accounting:"none",contacts:"read"},{accounting:"read",contacts:"none"}]){
    await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[W.companyA,W.userReader,JSON.stringify(permissions)]);
    await expect(getSupplierStatement(reader,period)).rejects.toThrow();
    await expect(getSupplierStatementExport(reader,period)).rejects.toThrow();
    await expect(listStatementSuppliers(reader)).rejects.toThrow();
  }
  for(const input of [{...period,contactId:"invalid"},{...period,contactId:W.customer},{...period,from:"2026-02-30"},{...period,from:"2026-07-01"}])await expect(getSupplierStatement(actor,input)).rejects.toThrow();
  await expect(getSupplierStatement({userId:W.userOwnerB,companyId:W.companyA},period)).rejects.toThrow();
  for(const limit of [-1,1.5,200001,Infinity])await expect(getSupplierStatementExport(actor,period,{maxLines:limit})).rejects.toMatchObject({key:"reports.tooManyLines"});
});
