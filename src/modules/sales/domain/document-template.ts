import { z } from "zod";

export const DOCUMENT_TEXT_LIMIT = 50000;
export const templateText = z.string().transform(s => s.replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n")).refine(s => [...s].length <= DOCUMENT_TEXT_LIMIT && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(s));
export function parseHourlyRate(value: string): bigint | null {
 const m=/^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(value.trim());
 if(!m)return null;const n=BigInt(m[1]!)*100n+BigInt((m[2]??"").padEnd(2,"0"));return n>0n&&n<=100000000n?n:null;
}
export function hourlyRateText(rate:bigint,locale:string):string {
 if(rate<1n||rate>100000000n)throw new RangeError("hourly rate");
 return `${rate/100n}${locale==="en"?".":","}${(rate%100n).toString().padStart(2,"0")} CAD/h`;
}
export function renderDocumentTemplate(body:string,rate:bigint|null,locale:string,client:string,company:string):string {
 const parsed=templateText.safeParse(body);if(!parsed.success)throw new RangeError("document text");
 let result=parsed.data;
 if(result.includes("{{hourly_rate}}")){if(rate===null)throw new RangeError("missing hourly rate");result=result.split("{{hourly_rate}}").join(hourlyRateText(rate,locale));}
 result=result.split("{{client_name}}").join(client).split("{{company_name}}").join(company);
 if(/\{\{|\}\}/.test(result)||[...result].length>100000)throw new RangeError("unsupported document variable");return result;
}
