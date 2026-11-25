import { expect,it } from "vitest";
import { tripInput, parseKilometers, kilometers, mileageFilters, mileageQuery, tripYearFilters, mileageCsv, type MileageReport } from "@/modules/mileage/client";
import { can } from "@/modules/companies";
import { canAccessArea, canAccessRoute } from "@/app/c/[companyId]/navigation-access";

const input={date:'2026-06-15',vehicle:'Van A',origin:'Office',destination:'Client',usage:'BUSINESS' as const,purpose:'Visit',distanceMeters:12345};
it('parses kilometre fractions exactly as integer metres without rounding or group separators',()=>{
 for(const [value,expected] of [['0.001',1],['12.345',12345],['10000',10000000]] as const)expect(parseKilometers(value,'en')).toBe(expected);
 expect(parseKilometers('12,345','fr-CA')).toBe(12345);expect(parseKilometers('12.345','fr-CA')).toBe(12345);
 for(const value of ['0','-1','1e3','1,234.567','1 234','1.2345','10000.001','100000000000','NaN',''])expect(parseKilometers(value,'en')).toBeNull();
 expect(parseKilometers('1,234','en')).toBeNull();expect(kilometers(50000000001n,'en',false)).toBe('50000000.001');expect(kilometers(1,'fr-CA')).toBe('0,001');
});
it('validates normalized single-line text, precise distances and a required business purpose',()=>{
 expect(tripInput.parse({...input,vehicle:' Van A '}).vehicle).toBe('Van A');expect(tripInput.safeParse({...input,usage:'PERSONAL',purpose:''}).success).toBe(true);
 for(const patch of [{date:'2026-02-30'},{vehicle:''},{vehicle:'🙂'.repeat(81)},{vehicle:'bad\n'},{origin:'bad\u0085'},{destination:'bad\u2028'},{purpose:''},{distanceMeters:0},{distanceMeters:1.5},{distanceMeters:10000001},{usage:'OTHER'}])expect(tripInput.safeParse({...input,...patch}).success).toBe(false);
 expect(tripInput.safeParse({...input,vehicle:'🙂'.repeat(80)}).success).toBe(true);
});
it('keeps fiscal-independent inclusive filters bounded and preserves them through pagination',()=>{
 const f=mileageFilters({du:'2024-01-01',au:'2024-12-31',vehicule:'%_Van',usage:'BUSINESS',page:'2'},'2026-11-25');
 expect(f).toMatchObject({from:'2024-01-01',to:'2024-12-31',vehicle:'%_Van',usage:'BUSINESS',page:2});expect(new URLSearchParams(mileageQuery(f,3)).get('vehicule')).toBe('%_Van');
 expect(tripYearFilters('2026-06-15','2026-11-25').to).toBe('2026-11-25');expect(tripYearFilters('2024-06-15','2026-11-25').to).toBe('2024-12-31');
 for(const q of [{du:''},{du:['2026-01-01','2026-01-01']},{du:'2024-01-01',au:'2025-01-01'},{au:'2027-01-01'},{usage:'business'},{usage:['ALL']},{vehicule:'x'.repeat(81)},{page:'0'},{page:'1e2'},{page:'9007199254740993'}])expect(()=>mileageFilters(q,'2026-11-25')).toThrow();
});
it('exports exact kilometres and neutralizes formulas without treating metres as financial cents',()=>{
 const filters=mileageFilters({du:'2026-06-01',au:'2026-06-30'},'2026-11-25');
 const r:MileageReport={filters,rows:[{...input,id:'a',revision:1,vehicle:'=2+2',origin:'@Office'}],count:1,page:1,pageCount:1,businessMeters:12345n,personalMeters:0n};
 expect(mileageCsv(r,'en',s=>s)).toContain("2026-06-15,'=2+2,BUSINESS,'@Office,Client,Visit,12.345\r\n");expect(mileageCsv(r,'fr-CA',s=>s)).toContain('Visit;12,345\r\n');expect(mileageCsv(r,'en',s=>s)).toContain('total,12.345\r\n');expect(()=>mileageCsv({...r,count:2},'en',s=>s)).toThrow();
});
it('ties navigation and management to Accounting overrides while clamping read-only roles',()=>{
 expect(canAccessRoute({role:'READ_ONLY',moduleAccess:{contacts:'none',sales:'none',taxes:'none'}},'kilometrage')).toBe(true);
 expect(canAccessArea({role:'ACCOUNTANT',moduleAccess:{accounting:'none'}},'kilometrage')).toBe(false);
 expect(can({role:'USER',moduleAccess:{accounting:'write'}},'mileage.manage')).toBe(true);expect(can({role:'READ_ONLY',moduleAccess:{accounting:'write'}},'mileage.manage')).toBe(false);
});
