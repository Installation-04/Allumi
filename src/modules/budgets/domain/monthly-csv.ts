import { toCsv,csvFormatFor,type CsvCell } from '@/modules/reports/client';
import type { Locale } from '@/modules/ledger/client';
import type { MonthlyBudget } from '../service/monthly';
type Label='monthlyTitle'|'year'|'monthlyPeriod'|'monthlyScope'|'code'|'account'|'type'|'monthlyTarget'|'actual'|'difference'|'target'|'monthlyAllocated'|'monthlyRemaining'|'monthlyDefinedCount'|'revenue'|'expenses'|'notSet'|'definedTargets'|'coverage';
export function monthlyBudgetCsv(r:MonthlyBudget,locale:Locale,t:(key:Label,values?:{count:number})=>string){
 const rows:CsvCell[][]=[[t('monthlyTitle'),r.name],[t('year'),r.from,r.to],[t('monthlyPeriod'),r.selected.from,r.selected.to],[t('monthlyScope')],[t('code'),t('account'),t('type'),t('monthlyTarget'),t('actual'),t('difference'),t('target'),t('monthlyAllocated'),t('monthlyRemaining'),t('monthlyDefinedCount')],
 ...r.rows.map(a=>[a.code,locale==='en'?a.nameEn:a.nameFr,t(a.type==='REVENUE'?'revenue':'expenses'),a.targetCents??t('notSet'),a.actualCents,a.differenceCents??'',a.annualCents??t('notSet'),a.allocation?.allocatedCents??'',a.allocation?.remainingCents??'',a.allocation?String(a.allocation.definedCount):'']),
 [t('revenue'),t('definedTargets'),'',r.revenue.targetCents,r.revenue.actualCents],[t('expenses'),t('definedTargets'),'',r.expenses.targetCents,r.expenses.actualCents]];
 const missing=r.revenue.unbudgeted+r.expenses.unbudgeted;if(missing)rows.push([t('coverage',{count:missing})]);
 return toCsv(rows,csvFormatFor(locale));
}
