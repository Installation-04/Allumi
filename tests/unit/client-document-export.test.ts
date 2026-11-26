import { expect,it } from 'vitest';
import { clientDocumentsCsv,clientDocumentQuery,type ClientDocumentExportRow } from '@/modules/contracts/client';
const row:ClientDocumentExportRow={id:'0198e000-0000-7000-8000-000000000001',title:'=HYPERLINK("bad")',customerName:'  +cmd',kind:'CONTRACT',stage:'SIGNED',linkState:'EXPIRED',publishedAt:'2026-06-01T12:00:00.000Z',firstViewedAt:'2026-06-01T12:01:00.000Z',signedAt:'2026-06-01T12:02:00.000Z',expiresAt:'2026-08-30T12:00:00.000Z',capturedAt:'2026-09-01T12:00:00.000Z'};
it('produces a complete flat localized CSV with UTC dates, quoted text and neutralized formulas',()=>{
 const fr=clientDocumentsCsv([row],'fr-CA',k=>k),en=clientDocumentsCsv([{...row,title:'Quote, "line"\nnext',customerName:'@client'}],'en',k=>k);
 expect(fr).toContain("'  +cmd");expect(fr).toContain("'=HYPERLINK");expect(fr).toContain(';');expect(fr).toContain('UTC ISO 8601');expect(fr).toContain(row.signedAt);expect(en).toContain('"Quote, ""line""\nnext"');expect(en).toContain("'@client");expect(en.endsWith('\r\n')).toBe(true);expect(clientDocumentsCsv([],'en',k=>k).split('\r\n')).toHaveLength(2);expect(()=>clientDocumentsCsv(Array.from({length:5001},()=>row),'en',k=>k)).toThrow();
});
it('shares strict single-value filters and page validation across list and export',()=>{
 expect(clientDocumentQuery({q:'  %_\\  ',kind:'CONTRACT',stage:'SIGNED',link:'EXPIRED',page:'2'})).toEqual({q:'%_\\',kind:'CONTRACT',stage:'SIGNED',link:'EXPIRED',page:2});
 for(const q of [{q:['a','b']},{stage:['SIGNED','DRAFT']},{stage:'BAD'},{page:''},{page:'0'},{page:'1001'},{q:'\nword'},{q:'x'.repeat(121)}])expect(()=>clientDocumentQuery(q)).toThrow();
});
