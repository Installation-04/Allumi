/** Bounded real-service fixtures for complete annual/monthly print copies. */
import { closePrisma } from "@/platform/db";
import { createAccount, createFiscalYear, postManualEntry, updateAccount } from "@/modules/ledger";
import { createBudget, getBudgetComparison, getMonthlyAllocation, saveBudgetTarget, saveMonthlyAllocation } from "@/modules/budgets";
import { E2E_DB } from "./db";
for (const key of ["DATABASE_URL","APP_DATABASE_URL"]) if (new URL(process.env[key] ?? "").pathname !== `/${E2E_DB}`) throw new Error("Refusing non-E2E database");
process.env.APP_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
process.env.AUTH_SECRET = "e2e-budget-fixture-only-e2e-budget-fixture-only";
process.env.ENCRYPTION_KEY = Buffer.alloc(32,7).toString("base64");
const [userId,companyId] = process.argv.slice(2);
if (![userId,companyId].every(id=>id&&/^[0-9a-f-]{36}$/.test(id))) throw new Error("Missing fixture identifiers");
const actor = {userId:userId!,companyId:companyId!};
try {
  const year = await createFiscalYear(actor,{containing:"2024-04-01"});
  const budget = await createBudget(actor,{name:"Budget de référence — exercice 2024",fiscalYearId:year.id});
  const bank = await createAccount(actor,{code:"BP91-BANK",nameFr:"Banque exemple",nameEn:"Example bank",type:"ASSET",subtype:"BANK"});
  const revenue = await createAccount(actor,{code:"BP91-REV",nameFr:"Revenus détaillés "+"X".repeat(100),nameEn:"Detailed revenue "+"X".repeat(100),type:"REVENUE",subtype:"OPERATING_REVENUE",description:"BUDGET-PRINT-PRIVATE-ACCOUNT"});
  const zero = await createAccount(actor,{code:"BP91-ZERO",nameFr:"Objectif nul",nameEn:"Zero target",type:"EXPENSE",subtype:"OPERATING_EXPENSE"});
  const uncovered = await createAccount(actor,{code:"BP91-UNSET",nameFr:"Historique sans objectif",nameEn:"Unbudgeted history",type:"EXPENSE",subtype:"OPERATING_EXPENSE"});
  const missing = await createAccount(actor,{code:"BP91-MISSING",nameFr:"Mois non définis",nameEn:"Undefined months",type:"EXPENSE",subtype:"OPERATING_EXPENSE"});
  const target = async (accountId:string,amountCents:bigint) => saveBudgetTarget(actor,budget,{accountId,amountCents,revision:(await getBudgetComparison(actor,budget)).revision});
  await target(revenue.id,1000001n); await target(zero.id,0n); await target(missing.id,120000n);
  for (let i=0;i<101;i++) {
    const a = await createAccount(actor,{code:`BP91-ZZ-${String(i).padStart(3,"0")}`,nameFr:`Compte budgétaire ${i}`,nameEn:`Budget account ${i}`,type:"EXPENSE",subtype:"OPERATING_EXPENSE"});
    await target(a.id,100n);
  }
  for (const [accountId,amounts] of [[revenue.id,[500000n,0n]],[zero.id,[0n,null]]] as const) {
    const a = await getMonthlyAllocation(actor,budget,accountId);
    await saveMonthlyAllocation(actor,budget,accountId,{revision:a.budget.revision,targets:a.periods.map(p=>({periodId:p.id,amountCents:p.from==="2024-04-01"?amounts[0]:p.from==="2024-05-01"?amounts[1]:null}))});
  }
  const post = async (date:string,debit:string,credit:string,amount:bigint) => postManualEntry(actor,{date,kind:"MANUAL",memo:"BUDGET-PRINT-PRIVATE-MEMO",lines:[{accountId:debit,debitCents:amount,creditCents:0n,description:"BUDGET-PRINT-PRIVATE-LINE"},{accountId:credit,debitCents:0n,creditCents:amount}]});
  await post("2024-04-01",bank.id,revenue.id,250000n); await post("2024-04-30",bank.id,revenue.id,10000n);
  await post("2024-05-01",bank.id,revenue.id,17000n); await post("2024-04-15",zero.id,bank.id,12500n); await post("2024-04-20",uncovered.id,bank.id,500n);
  await updateAccount(actor,uncovered.id,{isActive:false});
  process.stdout.write(JSON.stringify({budget,period:year.periods.find(p=>p.start==="2024-04-01")!.id,nextPeriod:year.periods.find(p=>p.start==="2024-05-01")!.id,year:year.id,count:105}));
} finally { await closePrisma(); }
