import { expect,it } from 'vitest';
import { parseHourlyRate,hourlyRateText,renderDocumentTemplate,templateText } from '@/modules/sales/client';
it('replaces every hourly rate exactly, preserves long multiline conditions and normalizes line endings',()=>{
 const body='{{company_name}}\r\nClient: {{client_name}}\rTarif: {{hourly_rate}}\n'+('Conditions '.repeat(600))+'\nRappel: {{hourly_rate}}';
 const rendered=renderDocumentTemplate(body,12599n,'fr-CA','Client exemple','Entreprise exemple');expect(rendered.match(/125,99 CAD\/h/g)).toHaveLength(2);expect(rendered).not.toContain('\r');expect(rendered).toContain('Conditions '.repeat(600));expect(rendered).toContain('Client: Client exemple');expect(renderDocumentTemplate(body,9999n,'en','Client','Company').match(/99\.99 CAD\/h/g)).toHaveLength(2);
});
it('parses cents without rounding, bounds document text and refuses unknown or incomplete variables',()=>{
 expect(parseHourlyRate('125,99')).toBe(12599n);expect(parseHourlyRate('0.01')).toBe(1n);expect(hourlyRateText(100000000n,'en')).toBe('1000000.00 CAD/h');
 for(const v of ['0','-1','1.234','1e3','1 000','1000000.01'])expect(parseHourlyRate(v)).toBeNull();
 for(const body of ['{{other}}','{{hourly_rate}}','{{company_name}'])expect(()=>renderDocumentTemplate(body,null,'fr-CA','C','E')).toThrow();
 expect(templateText.safeParse('x'.repeat(50000)).success).toBe(true);expect(templateText.safeParse('x'.repeat(50001)).success).toBe(false);expect(templateText.safeParse('bad\u0085').success).toBe(false);
});

it('keeps the displayed consent aligned with the text retained as signature evidence',async()=>{
 const {signatureConsent}=await import('@/modules/contracts/client');const fr=await import('../../messages/fr-CA.json');const en=await import('../../messages/en.json');expect(signatureConsent('fr-CA')).toBe(fr.default.contracts.consent);expect(signatureConsent('en')).toBe(en.default.contracts.consent);
});
