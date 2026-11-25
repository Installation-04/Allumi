import { expect,it } from "vitest";
import { buildCashForecast,cashForecastRange,cashForecastCsv,forecastChart,type ForecastOpenItem,type ForecastCsvLabels } from "@/modules/reports";
import { forecastFilters } from "@/app/_lib/cash-forecast";
import en from "@messages/en.json";
const account={id:'bank',code:'1000',nameFr:'=Banque',nameEn:'@Bank',isActive:false,cents:10000n};
const item=(id:string,ledger:ForecastOpenItem['ledger'],cents:bigint,dueDate:string|null,kind:ForecastOpenItem['kind']='INVOICE'):ForecastOpenItem=>({id,ledger,cents,dueDate,kind,number:id,party:'=2+2',date:'2026-06-01'});
const build=(items:ForecastOpenItem[]=[],opening=10000n)=>buildCashForecast({asOf:'2026-06-30',days:7,accounts:[{...account,cents:opening}],items,receivableControlCents:0n,payableControlCents:0n,futureCashCount:2,futureCashCents:200n});
it('uses end-of-day opening, carries overdue items and includes both horizon boundaries exactly',()=>{
 const r=build([item('overdue','PAYABLE',15000n,'2026-06-30'),item('last','RECEIVABLE',7000n,'2026-07-07'),item('beyond','RECEIVABLE',9900n,'2026-07-08'),item('fallback','RECEIVABLE',100n,null)]);
 expect(r.from).toBe('2026-07-01');expect(r.to).toBe('2026-07-07');expect(r.daily).toHaveLength(7);expect(r.daily[0]).toMatchObject({openingCents:10000n,incomingCents:100n,outgoingCents:15000n,closingCents:-4900n});expect(r.daily[6]!.closingCents).toBe(2100n);expect(r).toMatchObject({minimumCents:-4900n,minimumDate:'2026-07-01',negativeDays:6,firstNegativeDate:'2026-07-01',carriedCount:2,beyondCount:1,closingCents:2100n});
});
it('excludes unapplied credits, payments and refunds without silently netting them',()=>{
 const r=build([item('invoice','RECEIVABLE',5000n,'2026-07-02'),item('credit','RECEIVABLE',1000n,null,'CREDIT_NOTE'),item('payment','RECEIVABLE',200n,null,'PAYMENT'),item('refund','RECEIVABLE',100n,null,'REFUND'),item('bill','PAYABLE',400n,'2026-07-02'),item('supplier-credit','PAYABLE',100n,null,'CREDIT_NOTE')]);
 expect(r).toMatchObject({incomingCents:5000n,outgoingCents:400n,excludedCount:4,receivableDifferenceCents:-3900n,payableDifferenceCents:-300n,futureCashCount:2,futureCashCents:200n});expect(r.items).toHaveLength(2);
});
it('preserves huge and negative cents and produces bounded chart coordinates',()=>{
 const huge=900719925474099312345n,r=build([item('large','RECEIVABLE',huge,'2026-07-01')],-huge);
 expect(r.openingCents).toBe(-huge);expect(r.closingCents).toBe(0n);expect(r.minimumCents).toBe(-huge);expect(r.firstNegativeDate).toBe('2026-06-30');expect(r.negativeDays).toBe(0);
 for(const point of forecastChart(r).points.split(' ')){const [x,y]=point.split(',').map(Number);expect(x).toBeGreaterThanOrEqual(20);expect(x).toBeLessThanOrEqual(700);expect(y).toBeGreaterThanOrEqual(20);expect(y).toBeLessThanOrEqual(160);}
 expect(forecastChart(build([],0n)).points).not.toMatch(/NaN|Infinity/);
});
it('uses calendar days across leap days and daylight saving changes',()=>{
 expect(cashForecastRange('2028-02-28',7).dates.slice(0,2)).toEqual(['2028-02-29','2028-03-01']);expect(cashForecastRange('2026-03-07',7).to).toBe('2026-03-14');expect(cashForecastRange('2026-12-31',90).to).toBe('2027-03-31');
 for(const [date,days] of [['2026-02-29',7],['2026-06-30',8],['9999-12-31',7]] as const)expect(()=>cashForecastRange(date,days)).toThrow();
});
it('refuses oversized or inconsistent sources without returning a partial projection',()=>{
 expect(()=>build(Array.from({length:5001},(_,i)=>item(String(i),'RECEIVABLE',1n,null)))).toThrow();expect(()=>build([item('bad','PAYABLE',-1n,null)])).toThrow();
 const r=build();expect(()=>buildCashForecast({...r,items:[],accounts:Array.from({length:1001},()=>account),receivableControlCents:0n,payableControlCents:0n})).toThrow();expect(build()).toMatchObject({closingCents:10000n,items:[],firstNegativeDate:null});
});
it('rejects duplicate, malformed and future filters identically for page and export',()=>{
 expect(forecastFilters({},'2026-07-01')).toEqual({asOf:'2026-07-01',days:30,page:1,receiptDelay:0,paymentDelay:0});
 for(const q of [{date:['2026-01-01']},{date:'2026-07-02'},{date:''},{date:'2026-02-30'},{jours:['7','30']},{jours:'007'},{page:'0'},{page:'1e2'},{page:'9007199254740993'}])expect(()=>forecastFilters(q,'2026-07-01')).toThrow();
 expect(forecastFilters({date:'2026-06-30',jours:'90',page:'2'},'2026-07-01')).toEqual({asOf:'2026-06-30',days:90,page:2,receiptDelay:0,paymentDelay:0});
});
it('exports exact bilingual numeric values and neutralizes formulas in all text sources',()=>{
 const r=build([item('=FORMULA','RECEIVABLE',12345n,'2026-07-01')]),labels=en.cashForecast as ForecastCsvLabels;
 expect(cashForecastCsv(r,labels,'en')).toContain("2026-07-01,Customer invoice,'=FORMULA,'=2+2,2026-06-01,2026-07-01,No,123.45\r\n");expect(cashForecastCsv(r,labels,'fr-CA')).toContain(';123,45\r\n');expect(cashForecastCsv(r,labels,'en')).toContain("1000,'@Bank,100.00");
});
it('compares delays from the same opening and sources without losing amounts beyond the horizon',()=>{
 const source=[item('bill','PAYABLE',15000n,'2026-06-20'),item('invoice','RECEIVABLE',7000n,'2026-07-07'),item('later','RECEIVABLE',900n,'2026-08-01')],original=structuredClone(source);
 const r=buildCashForecast({asOf:'2026-06-30',days:7,receiptDelay:7,paymentDelay:14,accounts:[account],items:source,receivableControlCents:7900n,payableControlCents:15000n,futureCashCount:0,futureCashCents:0n});
 expect(r.baseline).toMatchObject({closingCents:2000n,minimumCents:-5000n,negativeDays:6});expect(r).toMatchObject({closingCents:10000n,minimumCents:10000n,negativeDays:0,deferredIncomingCount:1,deferredIncomingCents:7000n,deferredOutgoingCount:1,deferredOutgoingCents:15000n,beyondCount:3,receivableDifferenceCents:0n,payableDifferenceCents:0n});expect(r.items).toEqual([]);expect(source).toEqual(original);
});
it('shifts overdue items after carrying them forward and keeps original due dates intact',()=>{
 const r=buildCashForecast({asOf:'2026-06-30',days:30,receiptDelay:7,paymentDelay:14,accounts:[account],items:[item('client','RECEIVABLE',9007199254740993n,'2026-06-01'),item('supplier','PAYABLE',12000n,'2026-07-01')],receivableControlCents:0n,payableControlCents:0n,futureCashCount:0,futureCashCents:0n});
 expect(r.items.map(i=>[i.id,i.projectedDate,i.dueDate,i.carried])).toEqual([['client','2026-07-08','2026-06-01',true],['supplier','2026-07-15','2026-07-01',false]]);expect(r.daily[7]!.incomingCents).toBe(9007199254740993n);expect(r.daily[14]!.outgoingCents).toBe(12000n);expect(r.closingCents).toBe(r.baseline.closingCents);expect(r.deferredIncomingCount).toBe(0);
});
it('uses calendar dates across year boundaries and excludes an out-of-range shifted date safely',()=>{
 const r=buildCashForecast({asOf:'2026-12-15',days:30,receiptDelay:14,accounts:[],items:[{...item('year','RECEIVABLE',1n,'2026-12-20'),date:'2026-12-15'}],receivableControlCents:1n,payableControlCents:0n,futureCashCount:0,futureCashCents:0n});expect(r.items[0]!.projectedDate).toBe('2027-01-03');
 const end=buildCashForecast({asOf:'2999-12-05',days:7,receiptDelay:30,accounts:[],items:[{...item('end','RECEIVABLE',1n,'2999-12-06'),date:'2999-12-01'}],receivableControlCents:1n,payableControlCents:0n,futureCashCount:0,futureCashCents:0n});expect(end.deferredIncomingCents).toBe(1n);expect(end.items).toEqual([]);
});
it('refuses unsupported and duplicated delay assumptions instead of silently using zero',()=>{
 for(const q of [{delai_clients:'1'},{delai_clients:'07'},{delai_clients:''},{delai_clients:['7','7']},{delai_fournisseurs:'-7'},{delai_fournisseurs:'7.0'}])expect(()=>forecastFilters(q,'2026-07-01')).toThrow();
 expect(forecastFilters({delai_clients:'7',delai_fournisseurs:'30'},'2026-07-01')).toMatchObject({receiptDelay:7,paymentDelay:30});
 for(const delay of [-1,1,7.5,NaN,Infinity])expect(()=>buildCashForecast({...build(),receiptDelay:delay,receivableControlCents:0n,payableControlCents:0n})).toThrow();
});
it('exports the selected assumptions, reference comparison and deferred amounts with original source dates',()=>{
 const r=buildCashForecast({asOf:'2026-06-30',days:7,receiptDelay:7,accounts:[],items:[item('delay','RECEIVABLE',12345n,'2026-07-02')],receivableControlCents:12345n,payableControlCents:0n,futureCashCount:0,futureCashCents:0n});const csv=cashForecastCsv(r,en.cashForecast as ForecastCsvLabels,'en');
 expect(csv).toContain('Additional customer delay (days),7\r\n');expect(csv).toContain('No additional delay,123.45,0.00,123.45,0.00,2026-06-30,0\r\n');expect(csv).toContain('Receipts shifted beyond the horizon,1,123.45\r\n');expect(csv).not.toContain(',delay,');
});
