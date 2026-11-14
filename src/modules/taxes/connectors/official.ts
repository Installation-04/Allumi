import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/platform/errors";
import { CRA_URL, RQ_URL, parseCraRates, parseRqRates, type OfficialPreview, type Province, type SourcePeriod } from "../domain/official-sources";
const MAX_BYTES=1_048_576;
/** Fixed HTTPS endpoints only, no credentials, redirects, tenant identifiers or configurable URLs. */
async function readSource(url:string, contentType:string) {
  try {
    const response=await fetch(url,{redirect:"error",cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(10_000),headers:{Accept:contentType}});
    if(!response.ok || !response.body || !response.headers.get("content-type")?.toLowerCase().includes(contentType))throw new Error("source");
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new Error("size");chunks.push(value);}}
    finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));
  } catch {throw new AppError("officialTaxes.unavailable");}
}
export async function fetchOfficialPreview(province:Province,date:string):Promise<OfficialPreview> {
  const [cra,rq]=await Promise.all([readSource(CRA_URL,"application/json"),province==="QC"?readSource(RQ_URL,"text/html"):Promise.resolve(null)]);
  try {
    const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
    const collectedAt=new Date().toISOString();
    const sources:SourcePeriod[]=[{id:"CRA_GST_HST",url:CRA_URL,sha256:digest(cra),collectedAt,rates:parseCraRates(JSON.parse(cra))[province]}];
    if(rq!==null)sources.push({id:"RQ_QST",url:RQ_URL,sha256:digest(rq),collectedAt,rates:parseRqRates(rq)});
    for(const source of sources)if(source.rates.filter(r=>r.from<=date&&(!r.to||r.to>=date)).length!==1)throw new Error("coverage");
    // A stable semantic fingerprint ignores dynamic HTML tokens while detecting any rate/period change.
    const fingerprint=digest(JSON.stringify({province,date,sources:sources.map(({id,url,rates})=>({id,url,rates}))}));
    return {province,date,sources,fingerprint};
  }catch {throw new AppError("officialTaxes.schema");}
}
