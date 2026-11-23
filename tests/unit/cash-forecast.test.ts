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
 expect(forecastFilters({},'2026-07-01')).toEqual({asOf:'2026-07-01',days:30,page:1});
 for(const q of [{date:['2026-01-01']},{date:'2026-07-02'},{date:''},{date:'2026-02-30'},{jours:['7','30']},{jours:'007'},{page:'0'},{page:'1e2'},{page:'9007199254740993'}])expect(()=>forecastFilters(q,'2026-07-01')).toThrow();
 expect(forecastFilters({date:'2026-06-30',jours:'90',page:'2'},'2026-07-01')).toEqual({asOf:'2026-06-30',days:90,page:2});
});
it('exports exact bilingual numeric values and neutralizes formulas in all text sources',()=>{
 const r=build([item('=FORMULA','RECEIVABLE',12345n,'2026-07-01')]),labels=en.cashForecast as ForecastCsvLabels;
 expect(cashForecastCsv(r,labels,'en')).toContain("2026-07-01,Customer invoice,'=FORMULA,'=2+2,2026-06-01,2026-07-01,No,123.45\r\n");expect(cashForecastCsv(r,labels,'fr-CA')).toContain(';123,45\r\n');expect(cashForecastCsv(r,labels,'en')).toContain("1000,'@Bank,100.00");
});
