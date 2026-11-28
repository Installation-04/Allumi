import { expect, it } from 'vitest';
import { entryNumber, financeFilters, financeQuery, financeCsv, type ProjectFinance } from '@/modules/projects/client';

it('parses exact internal bigint numbers without accepting prefixes, signs or numeric rounding', () => {
  expect(entryNumber('00042')).toBe(42n);
  expect(entryNumber('9223372036854775807')).toBe(9223372036854775807n);
  for (const value of ['0', '-1', '+1', '1.0', '1e3', 'J-00042', ' 42', '9223372036854775808', 42, null]) expect(() => entryNumber(value)).toThrow();
});
it('keeps inclusive financial dates bounded and refuses duplicate parameters and unsafe pages', () => {
  expect(financeFilters({}, '2026-11-28')).toEqual({ from: '2026-01-01', to: '2026-11-28', page: 1 });
  expect(financeQuery(financeFilters({ du: '2026-03-01', au: '2026-03-31', page: '2' }, '2026-11-28'), 3)).toBe('du=2026-03-01&au=2026-03-31&page=3');
  for (const q of [{ du: ['2026-01-01', '2026-02-01'] }, { au: '2026-02-30' }, { du: '2026-04-01', au: '2026-03-31' }, { au: '2026-11-29' }, { du: '2025-01-01' }, { page: '0' }, { page: '9007199254740992' }]) expect(() => financeFilters(q, '2026-11-28')).toThrow();
});
it('exports signed exact cents with spreadsheet-safe project labels and refuses partial reports', () => {
  const r: ProjectFinance = { code: 'P113', name: '=FORMULA()', status: 'ACTIVE', filters: { from: '2026-03-01', to: '2026-03-31', page: 1 }, rows: [{ id: 'id', number: '42', rootNumber: '41', date: '2026-03-15', reversed: true, revenue: -12345n, expenses: 67n }], count: 1, page: 1, pages: 1, revenue: -12345n, expenses: 67n };
  const en = financeCsv(r, 'en', k => k), fr = financeCsv(r, 'fr-CA', k => k);
  expect(en).toContain('-123.45'); expect(en).toContain('-124.12'); expect(fr).toContain('-123,45'); expect(en).toContain("'=FORMULA()");
  expect(() => financeCsv({ ...r, count: 2 }, 'en', k => k)).toThrow('incomplete');
});
