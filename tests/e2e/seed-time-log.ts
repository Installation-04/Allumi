import { closePrisma } from '@/platform/db';
import { createTimeEntry } from '@/modules/time';
import { E2E_DB } from './db';
for(const k of ['DATABASE_URL','APP_DATABASE_URL'])if(new URL(process.env[k]??'').pathname!==`/${E2E_DB}`)throw new Error('Refusing non-E2E database');
process.env.APP_URL??=`http://127.0.0.1:${process.env.E2E_PORT??3100}`;
process.env.AUTH_SECRET??='e2e-time-fixture-only-e2e-time-fixture-only';
process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString('base64');
const [userId,companyId]=process.argv.slice(2);if(![userId,companyId].every(v=>v&&/^[0-9a-f-]{36}$/.test(v)))throw new Error('Invalid fixture identifiers');
try{for(let i=1;i<=52;i++)await createTimeEntry({userId:userId!,companyId:companyId!},{date:'2026-06-16',project:'DOS109 %_',person:'Camille Exemple',task:`Activité exemple ${i}`,notes:'',usage:'NON_BILLABLE',minutes:1});}finally{await closePrisma();}
