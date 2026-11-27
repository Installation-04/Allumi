import { it, expect } from "vitest";
import { parseDuration, duration, entryInput, timeFilters, timeQuery, timeCsv, type TimeReport } from "@/modules/time/client";
it('parses exact minutes and h:mm with one-day boundaries, never decimal hours',()=>{
 for(const [raw,n] of [['1',1],['1:30',90],['90',90],['0:01',1],['24:00',1440],['1440',1440],[' 2:05 ',125]] as const)expect(parseDuration(raw)).toBe(n);
 for(const raw of ['0','0:00','1:60','24:01','1441','1.5','1,5','1e2','-30','1:3','99999','0x10'])expect(parseDuration(raw)).toBeNull();
 for(let n=1;n<=1440;n++)expect(parseDuration(duration(n,'fr-CA',false))).toBe(n);
 expect(duration(9007199254740993n,'en',false)).toBe('150119987579016:33');expect(()=>duration(1.5,'en')).toThrow();
});
it('validates labels and filters while preserving literal search and fiscal-independent dates',()=>{
 expect(entryInput.safeParse({date:'2026-02-30',project:'X',person:'A',task:'B',notes:'',usage:'BILLABLE',minutes:1}).success).toBe(false);
 expect(entryInput.safeParse({date:'2026-06-01',project:' X ',person:' A ',task:' B ',notes:'',usage:'BILLABLE',minutes:1}).success).toBe(true);
 const f=timeFilters({du:'2026-01-01',au:'2026-12-31',projet:'%_\\',page:'2',usage:'NON_BILLABLE'},'2026-12-31');expect(timeQuery(f,f.page)).toContain('projet=%25_%5C');expect(f.project).toBe('%_\\');
 for(const q of [{du:''},{du:['2026-01-01','2026-01-01']},{projet:'x\n'},{page:'0'},{usage:'OTHER'},{du:'2024-01-01',au:'2025-01-01'},{au:'2999-01-01'}])expect(()=>timeFilters(q,'2026-12-31')).toThrow();
});
it('exports all filtered rows as integer minutes with safe CSV strings, without treating durations as money',()=>{
 const r:TimeReport={filters:timeFilters({},'2026-06-30'),rows:[{id:'x',revision:1,date:'2026-06-01',project:'=SUM(A1)',person:'Alex',task:'Service',notes:'privée',usage:'BILLABLE',minutes:90}],count:1,page:1,pageCount:1,billableMinutes:90n,nonBillableMinutes:0n};
 const csv=timeCsv(r,'fr-CA',k=>k);expect(csv).toContain(';90');expect(csv).not.toContain('0,90');expect(csv).toContain('totalMinutes;90');expect(csv).not.toContain(';=SUM(A1)');expect(()=>timeCsv({...r,count:2},'en',k=>k)).toThrow();
});
