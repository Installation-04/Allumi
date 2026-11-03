import type { Locale } from "@/modules/ledger/client";
import { csvFormatFor,toCsv,type CsvCell } from "./csv";
export const CASH_FIGURES=["openingCents","incomingCents","outgoingCents","transferInCents","transferOutCents","closingCents"] as const;
export type CashFigures=Record<typeof CASH_FIGURES[number],bigint>;
export type CashAccount={id:string;code:string;nameFr:string;nameEn:string;isActive:boolean};
export type CashAccountTotals=CashAccount&CashFigures;
export type CashMovement={id:string;entryId:string;entryNumber:string;date:string;accountId:string;accountCode:string;memo:string|null;kind:"movement"|"transfer"|"mixed";debitCents:bigint;creditCents:bigint};
export function cashTotals(accounts:readonly CashFigures[]){
 const total=Object.fromEntries(CASH_FIGURES.map(k=>[k,accounts.reduce((sum,a)=>sum+a[k],0n)])) as CashFigures;
 const netCents=total.closingCents-total.openingCents;
 const differenceCents=total.openingCents+total.incomingCents-total.outgoingCents+total.transferInCents-total.transferOutCents-total.closingCents;
 return {...total,netCents,differenceCents};
}
export type CashMovementsReport={from:string;to:string;accounts:CashAccount[];selectedAccountId:string|null;totals:ReturnType<typeof cashTotals>;byAccount:CashAccountTotals[];lines:CashMovement[];lineCount:number;mixedEntryCount:number;page:number;pageCount:number};
export type CashCsvLabels=Record<typeof CASH_FIGURES[number],string>&{account:string;total:string;date:string;entry:string;memo:string;kind:string;debit:string;credit:string;net:string;control:string;detail:string;mixedCount:string;scope:string;movement:string;transfer:string;mixed:string};
export function cashMovementsCsv(r:CashMovementsReport,title:string,l:CashCsvLabels,locale:Locale){
 const amounts=(a:CashFigures)=>CASH_FIGURES.map(k=>a[k]);
 const rows:CsvCell[][]=[[title],[r.from,r.to],[l.scope],[l.account,...CASH_FIGURES.map(k=>l[k])]];
 for(const a of r.byAccount)rows.push([`${a.code} – ${locale==="en"?a.nameEn:a.nameFr}`,...amounts(a)]);
 rows.push([l.total,...amounts(r.totals)],[l.net,r.totals.netCents],[l.control,r.totals.differenceCents],[l.mixedCount,String(r.mixedEntryCount)],[l.detail],[l.date,l.entry,l.account,l.memo,l.kind,l.debit,l.credit]);
 for(const m of r.lines)rows.push([m.date,m.entryNumber,m.accountCode,m.memo??"",l[m.kind],m.debitCents,m.creditCents]);
 return toCsv(rows,csvFormatFor(locale));
}
