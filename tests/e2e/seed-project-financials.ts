/** Fictional original entries and dated counter using the actual posting services. */
import { closePrisma } from '@/platform/db';
import { createAccount, createFiscalYear, postManualEntry, reverseEntry } from '@/modules/ledger';
import { E2E_DB } from './db';
for (const key of ['DATABASE_URL', 'APP_DATABASE_URL']) if (new URL(process.env[key] ?? '').pathname !== `/${E2E_DB}`) throw new Error('Refusing non-E2E database');
process.env.APP_URL ??= `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
process.env.AUTH_SECRET ??= 'e2e-project-finance-only-e2e-project-finance-only';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
const [userId, companyId] = process.argv.slice(2);
if (![userId, companyId].every(v => v && /^[0-9a-f-]{36}$/.test(v))) throw new Error('Invalid fixture identifiers');
const actor = { userId: userId!, companyId: companyId! };
try {
  await createFiscalYear(actor, { containing: '2023-01-01' });
  const bank = await createAccount(actor, { code: 'PF113-BANK', nameFr: 'Banque exemple projet', nameEn: 'Project example bank', type: 'ASSET', subtype: 'BANK' });
  const rev = await createAccount(actor, { code: 'PF113-REV', nameFr: 'Services exemple', nameEn: 'Example services', type: 'REVENUE', subtype: 'OPERATING_REVENUE' });
  const exp = await createAccount(actor, { code: 'PF113-EXP', nameFr: 'Frais exemple', nameEn: 'Example expenses', type: 'EXPENSE', subtype: 'OPERATING_EXPENSE' });
  const post = (date: string, debit: string, credit: string, amount: bigint) => postManualEntry(actor, { date, kind: 'MANUAL', memo: 'PF113-PRIVATE-MEMO', lines: [{ accountId: debit, debitCents: amount, creditCents: 0n, description: 'PF113-PRIVATE-LINE' }, { accountId: credit, debitCents: 0n, creditCents: amount }] });
  const sale = await post('2023-03-01', bank.id, rev.id, 250000n), expense = await post('2023-03-31', exp.id, bank.id, 35000n), previous = await post('2023-02-28', bank.id, rev.id, 10000n);
  const counter = await reverseEntry(actor, previous.id, { date: '2023-03-15' });
  process.stdout.write(JSON.stringify({ sale, expense, previous, counter }, (_, v) => typeof v === 'bigint' ? String(v) : v));
} finally { await closePrisma(); }
