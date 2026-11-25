/** Real-service fixtures, exclusively for the disposable browser-test database. */
import { closePrisma } from "@/platform/db";
import { createMileageTrip } from "@/modules/mileage";
import { E2E_DB } from "./db";
for(const key of ['DATABASE_URL','APP_DATABASE_URL'])if(new URL(process.env[key]??'').pathname!==`/${E2E_DB}`)throw new Error('Refusing non-E2E database');
process.env.APP_URL=`http://127.0.0.1:${process.env.E2E_PORT??3100}`;
process.env.AUTH_SECRET='e2e-mileage-fixture-only-e2e-mileage-fixture-only';
process.env.ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
const [userId,companyId]=process.argv.slice(2);if(![userId,companyId].every(id=>id&&/^[0-9a-f-]{36}$/.test(id)))throw new Error('Missing fixture identifiers');
try{
 for(let i=1;i<=51;i++)await createMileageTrip({userId:userId!,companyId:companyId!},{date:'2026-06-15',vehicle:'Camion Exemple',origin:'Québec',destination:'Montréal',usage:'BUSINESS',purpose:`Visite exemple ${i}`,distanceMeters:1});
 process.stdout.write(JSON.stringify({count:51}));
}finally{await closePrisma();}
