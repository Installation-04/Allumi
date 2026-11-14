import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { parseCraRates, parseRqRates, officialScope, CRA_URL, RQ_URL } from "@/modules/taxes";
import { fetchOfficialPreview } from "@/modules/taxes/connectors/official";
import cra from "../fixtures/official-tax-cra.json";
const rq=readFileSync(new URL("../fixtures/official-tax-rq.html",import.meta.url),"utf8");
afterEach(()=>vi.unstubAllGlobals());
function mock(json:unknown=cra,html=rq){const fn=vi.fn(async(url:unknown,_init?:RequestInit)=>new Response(url===CRA_URL?JSON.stringify(json):html,{headers:{"content-type":url===CRA_URL?"application/json":"text/html"}}));vi.stubGlobal("fetch",fn);return fn;}
it("reads dated GST/HST totals without adding the provincial HST component twice",()=>{
 const rates=parseCraRates(cra);expect(Object.keys(rates)).toHaveLength(13);
 expect(rates.ON.at(-1)).toMatchObject({percent:"13",rate:"0.130000"});
 expect(rates.NS.slice(-2)).toEqual([{from:"2016-10-01",to:"2025-03-31",percent:"15",rate:"0.150000"},{from:"2025-04-01",to:null,percent:"14",rate:"0.140000"}]);
 expect(rates.QC.at(-1)?.rate).toBe("0.050000");
 expect(parseRqRates(rq)).toEqual([{from:"2013-01-01",to:null,percent:"9.975",rate:"0.099750"}]);
});
it("fails closed on changed column dates, missing/duplicate jurisdictions and malformed percentages",()=>{
 for(const mutate of [(v:typeof cra)=>{v.result.fields.find(f=>f.id==="VPR1_HST")!.info!.notes_en="(HST) New period";},(v:typeof cra)=>{v.result.records[0]!.JRSD_CD="QC";},(v:typeof cra)=>{v.result.records[0]!.VPR1_HST="0.5 bogus";},(v:typeof cra)=>{v.result.records.pop();}]){const value=structuredClone(cra);mutate(value);expect(()=>parseCraRates(value)).toThrow();}
 for(const html of [rq+rq,rq.replace("2013</td>","2014</td>"),rq.replace("9,975","-9,975"),"<html>temporarily unavailable</html>"])expect(()=>parseRqRates(html)).toThrow();
 expect(()=>officialScope("QC","2013-03-31","2026-11-13")).toThrow();expect(()=>officialScope("ZZ","2026-01-01","2026-11-13")).toThrow();expect(()=>officialScope("QC","2026-11-14","2026-11-13")).toThrow();
});
it("fetches fixed credential-free endpoints and compares semantic rates instead of volatile HTML",async()=>{
 const fetch=mock();const a=await fetchOfficialPreview("QC","2026-11-13");
 expect(fetch.mock.calls.map(c=>c[0])).toEqual([CRA_URL,RQ_URL]);
 expect(fetch.mock.calls[0]?.[1]).toMatchObject({redirect:"error",credentials:"omit",cache:"no-store"});
 mock(cra,rq+"<!-- changing request token -->");const b=await fetchOfficialPreview("QC","2026-11-13");expect(b.fingerprint).toBe(a.fingerprint);expect(b.sources[1]?.sha256).not.toBe(a.sources[1]?.sha256);
 mock(cra,rq.replace("9,975","10"));expect((await fetchOfficialPreview("QC","2026-11-13")).fingerprint).not.toBe(a.fingerprint);
 const one=mock();expect((await fetchOfficialPreview("NS","2025-03-31")).sources).toHaveLength(1);expect(one).toHaveBeenCalledTimes(1);
});
it("refuses unavailable, redirected, oversized and incompatible source responses",async()=>{
 for(const response of [()=>Promise.reject(new Error("network")),()=>Promise.resolve(new Response("denied",{status:403})),()=>Promise.resolve(new Response("wrong",{headers:{"content-type":"text/html"}})),()=>Promise.resolve(new Response("x".repeat(1_048_577),{headers:{"content-type":"application/json"}})),()=>Promise.resolve(new Response("{}",{headers:{"content-type":"application/json"}}))]){vi.stubGlobal("fetch",vi.fn(response));await expect(fetchOfficialPreview("ON","2026-01-01")).rejects.toThrow();}
});
