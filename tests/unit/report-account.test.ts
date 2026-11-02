import { it,expect } from "vitest";
import { reportAccountId } from "@/app/_lib/report-account";
it("allows an explicitly empty scope and normalizes a single account identifier",()=>{
 expect(reportAccountId(undefined)).toBeUndefined();expect(reportAccountId("")).toBeUndefined();expect(reportAccountId([""])).toBeUndefined();
 expect(reportAccountId("00000000-0000-7000-8000-00000000ABCD")).toBe("00000000-0000-7000-8000-00000000abcd");
});
it("rejects malformed and ambiguous scopes rather than broadening financial exports",()=>{
 for(const value of ["bad","null","00000000-0000-7000-8000-00000000abcd\u0000",[],["",""],["00000000-0000-7000-8000-00000000abcd","invalid"]])expect(()=>reportAccountId(value)).toThrow();
});
