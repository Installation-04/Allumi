import { closePrisma } from '@/platform/db';
import { createTimeEntry } from '@/modules/time';
import { E2E_DB } from './db';
for(const k of ['DATABASE_URL','APP_DATABASE_URL'])if(new URL(process.env[k]??'').pathname!==`/${E2E_DB}`)throw new Error('Refusing non-E2E database');
process.env.APP_URL??=`http://127.0.0.1:${process.env.E2E_PORT??3100}`;
process.env.AUTH_SECRET??='e2e-time-print-only-e2e-time-print-only';
process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString('base64');
const [userId,companyId,mode='initial']=process.argv.slice(2);if(![userId,companyId].every(v=>v&&/^[0-9a-f-]{36}$/.test(v))||!['initial','extra','capacity'].includes(mode))throw new Error('Invalid fixture arguments');
try{const count=mode==='initial'?106:mode==='extra'?1:894;for(let i=0;i<count;i++)await createTimeEntry({userId:userId!,companyId:companyId!},{date:mode==='extra'||i===0?'2026-09-30':i===1?'2026-09-01':'2026-09-15',project:'IMP111 %_'+(mode==='initial'&&i===1?'X'.repeat(111):''),person:mode==='initial'&&i===1?'P'.repeat(80):'Camille Exemple',task:mode==='extra'?'Saisie relue à l’ouverture':mode==='initial'&&i===1?'A'.repeat(200):`Activité imprimable ${i}`,notes:mode==='initial'&&i===1?'N'.repeat(200):'Note interne conservée',usage:mode==='initial'&&i===0?'NON_BILLABLE':'BILLABLE',minutes:mode==='extra'?60:mode==='initial'&&i===0?90:mode==='initial'&&i===1?125:1});}finally{await closePrisma();}
