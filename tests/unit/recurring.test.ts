import { expect, it } from "vitest";
import { recurringDate, recurringDueDate, recurringSchema } from "@/modules/sales/domain/recurring";
it("anchors month ends and leap days without drift",()=>{
 expect([0,1,2,3].map(i=>recurringDate("2026-01-31",1,i,31))).toEqual(["2026-01-31","2026-02-28","2026-03-31","2026-04-30"]);
 expect(recurringDate("2024-02-29",12,1,29)).toBe("2025-02-28");expect(recurringDate("2024-02-29",12,4,29)).toBe("2028-02-29");
 expect(recurringDate("2026-11-30",3,1,31)).toBe("2027-02-28");expect(recurringDueDate("2026-12-31",30)).toBe("2027-01-30");
 expect(recurringDate("2999-12-31",1,1,31)).toBeNull();expect(recurringDueDate("2999-12-31",1)).toBeNull();
 for(const args of [["2026-02-30",1,0,1],["2026-01-01",2,0,1],["2026-01-01",1,-1,1],["2026-01-01",1,0,32]] as const)expect(recurringDate(args[0],args[1],args[2],args[3])).toBeNull();
});
it("refuses dates inconsistent with the anchor and end date",()=>{
 const input={creationKey:"00000000-0000-7000-8000-000000000001",sourceInvoiceId:"00000000-0000-7000-8000-000000000002",name:"Service",startDate:"2026-02-28",intervalMonths:"1",anchorDay:"31",termDays:"30"};
 expect(recurringSchema.safeParse(input).success).toBe(true);expect(recurringSchema.safeParse({...input,startDate:"2026-02-27"}).success).toBe(false);expect(recurringSchema.safeParse({...input,endDate:"2026-01-01"}).success).toBe(false);
});
