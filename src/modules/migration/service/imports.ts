import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireRole, type Action } from "@/modules/companies";
import { accountInputSchema, acceptsManualEntries, isValidIsoDate, postManualEntryWithin, MAX_LINE_CENTS, type EntryLine } from "@/modules/ledger";
import { recordEvent } from "@/modules/audit";
import { env } from "@/platform/env";
import { AppError, isConflict } from "@/platform/errors";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { prepareMigration, type MigrationRow, type MigrationSpec, identityKey } from "../domain/mapping";
import { MigrationCsvError } from "../domain/csv";
const LIMIT = 5000;
const TTL = 30 * 60 * 1000;
const ACTION: Record<MigrationSpec["kind"], Action> = { CUSTOMERS: "contact.manage", SUPPLIERS: "contact.manage", ITEMS: "catalog.manage", ACCOUNTS: "account.manage", BALANCES: "entry.post" };
function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") return value.toJSON();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function parse(text: string, input: unknown) {
  try { return prepareMigration(text, input); }
  catch (e) { if (e instanceof MigrationCsvError) throw new AppError("migration.invalid"); throw e; }
}
async function access(tx: Tx, kind: MigrationSpec["kind"]) { await requireRole(tx, "migration.manage"); await requireRole(tx, ACTION[kind]); }
type Prepared = ReturnType<typeof prepareMigration>;
type Reason = "ambiguous" | "kind" | "reference" | "reserved" | "inactive" | "controls" | "amount";
export type PlannedRow = { source: MigrationRow; status: "NEW" | "EXISTS" | "CONFLICT" | "UNCHANGED"; reason?: Reason; targetId?: string; targetName?: string; currentCents?: string; targetCents?: string; deltaCents?: string; refs?: { income: string | null; expense: string | null; tax: string | null } };

async function buildPlan(tx: Tx, actor: CompanyContext, prepared: Prepared, locked: boolean) {
  const { spec, rows } = prepared, companyId = actor.companyId;
  let entries: PlannedRow[] = [], state: unknown = null;
  if (spec.kind === "CUSTOMERS" || spec.kind === "SUPPLIERS") {
    if (locked) await tx.$queryRaw`SELECT id FROM contact WHERE company_id=${companyId}::uuid AND anonymized_at IS NULL ORDER BY id LIMIT ${LIMIT + 1} FOR SHARE`;
    const contacts = await tx.contact.findMany({ where: { companyId, anonymizedAt: null }, take: LIMIT + 1, orderBy: { id: "asc" }, select: { id: true, displayName: true, legalName: true, email: true, phone: true, isCustomer: true, isSupplier: true, isActive: true } });
    if (contacts.length > LIMIT) throw new AppError("migration.destinationLimit");
    state = contacts;
    entries = rows.map(source => {
      const matches = contacts.filter(c => identityKey(c.displayName) === source.key);
      if (!matches.length) return { source, status: "NEW" };
      const match = matches[0]!;
      return { source, status: matches.length > 1 ? "CONFLICT" : (spec.kind === "CUSTOMERS" ? match.isCustomer : match.isSupplier) ? "EXISTS" : "CONFLICT", reason: matches.length > 1 ? "ambiguous" : (spec.kind === "CUSTOMERS" ? match.isCustomer : match.isSupplier) ? undefined : "kind", targetId: match.id, targetName: match.displayName };
    });
    if (contacts.length + entries.filter(e => e.status === "NEW").length > LIMIT) throw new AppError("migration.destinationLimit");
  } else {
    const needsAccounts = spec.kind !== "ITEMS" || rows.some(r => r.kind === "ITEMS" && (r.refs.income || r.refs.expense));
    const needsTaxes = rows.some(r => r.kind === "ITEMS" && r.refs.tax);
    if (needsAccounts) await requireRole(tx, "ledger.read"); if (needsTaxes) await requireRole(tx, "taxes.read");
    if (locked && needsAccounts) await tx.$queryRaw`SELECT id FROM account WHERE company_id=${companyId}::uuid ORDER BY id LIMIT ${LIMIT + 1} FOR SHARE`;
    if (locked && needsTaxes) await tx.$queryRaw`SELECT id FROM tax_code WHERE company_id=${companyId}::uuid ORDER BY id LIMIT ${LIMIT + 1} FOR SHARE`;
    const accounts = needsAccounts ? await tx.account.findMany({ where: { companyId }, take: LIMIT + 1, orderBy: { id: "asc" }, select: { id: true, code: true, nameFr: true, nameEn: true, type: true, subtype: true, isActive: true, systemKey: true } }) : [];
    const taxes = needsTaxes ? await tx.taxCode.findMany({ where: { companyId }, take: LIMIT + 1, orderBy: { id: "asc" }, select: { id: true, code: true, isActive: true } }) : [];
    if (accounts.length > LIMIT || taxes.length > LIMIT) throw new AppError("migration.destinationLimit");
    if (spec.kind === "ITEMS") {
      if (locked) await tx.$queryRaw`SELECT id FROM item WHERE company_id=${companyId}::uuid ORDER BY id LIMIT ${LIMIT + 1} FOR SHARE`;
      const items = await tx.item.findMany({ where: { companyId }, take: LIMIT + 1, orderBy: { id: "asc" }, select: { id: true, code: true, name: true, unitPrice: true, description: true, isActive: true, incomeAccountId: true, expenseAccountId: true, defaultTaxCodeId: true } });
      if (items.length > LIMIT) throw new AppError("migration.destinationLimit");
      state = { items, accounts, taxes };
      entries = rows.map(source => {
        if (source.kind !== "ITEMS") throw new AppError("migration.invalid");
        const matches = items.filter(i => identityKey(i.name) === identityKey(source.name) || (source.data.code && i.code && identityKey(i.code) === identityKey(source.data.code)));
        if (matches.length) {
          const match = matches[0]!, same = matches.length === 1 && identityKey(match.name) === identityKey(source.name) && identityKey(match.code ?? "") === identityKey(source.data.code ?? "");
          return { source, status: same ? "EXISTS" : "CONFLICT", reason: same ? undefined : "ambiguous", targetId: match.id, targetName: match.name };
        }
        const income = source.refs.income ? accounts.find(a => a.code === source.refs.income && a.type === "REVENUE" && a.isActive) : null;
        const expense = source.refs.expense ? accounts.find(a => a.code === source.refs.expense && a.type === "EXPENSE" && a.isActive) : null;
        const tax = source.refs.tax ? taxes.find(t => t.code === source.refs.tax && t.isActive) : null;
        const invalid = (source.refs.income && !income) || (source.refs.expense && !expense) || (source.refs.tax && !tax);
        return { source, status: invalid ? "CONFLICT" : "NEW", reason: invalid ? "reference" : undefined, refs: { income: income?.id ?? null, expense: expense?.id ?? null, tax: tax?.id ?? null } };
      });
      if (items.length + entries.filter(e => e.status === "NEW").length > LIMIT) throw new AppError("migration.destinationLimit");
    } else if (spec.kind === "ACCOUNTS") {
      state = accounts;
      entries = rows.map(source => {
        if (source.kind !== "ACCOUNTS") throw new AppError("migration.invalid");
        const existing = accounts.find(a => a.code === source.data.code);
        if (existing) return { source, status: existing.type === source.data.type && existing.subtype === source.data.subtype ? "EXISTS" : "CONFLICT", reason: existing.type === source.data.type && existing.subtype === source.data.subtype ? undefined : "kind", targetId: existing.id, targetName: existing.nameFr };
        return { source, status: accountInputSchema.safeParse(source.data).success ? "NEW" : "CONFLICT", reason: accountInputSchema.safeParse(source.data).success ? undefined : "reserved" };
      });
      if (accounts.length + entries.filter(e => e.status === "NEW").length > LIMIT) throw new AppError("migration.destinationLimit");
    } else {
      if (!isValidIsoDate(spec.cutoverDate) || spec.skipExisting) throw new AppError("migration.date");
      if (await tx.migrationBatch.findFirst({ where: { companyId, kind: "BALANCES" }, select: { id: true } })) throw new AppError("migration.alreadyImported");
      const date = new Date(`${spec.cutoverDate}T00:00:00Z`);
      if (await tx.journalEntry.findFirst({ where: { companyId, entryDate: { gt: date } }, select: { id: true } })) throw new AppError("migration.future");
      if (locked) { await tx.$queryRaw`SELECT id FROM fiscal_year WHERE company_id=${companyId}::uuid ORDER BY id FOR SHARE`; await tx.$queryRaw`SELECT id FROM fiscal_period WHERE company_id=${companyId}::uuid ORDER BY id FOR SHARE`; }
      const periods = await tx.fiscalPeriod.findMany({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } }, select: { id: true, status: true, fiscalYear: { select: { id: true, status: true } } } });
      if (periods.length !== 1 || periods[0]!.status !== "OPEN" || periods[0]!.fiscalYear.status !== "OPEN") throw new AppError("migration.period");
      const balances = await tx.$queryRaw<{ id: string; cents: string }[]>`SELECT account_id AS id,sum(debit_cents-credit_cents)::text AS cents FROM journal_line WHERE company_id=${companyId}::uuid AND entry_date<=${date} GROUP BY account_id ORDER BY account_id`;
      const current = new Map(balances.map(b => [b.id, BigInt(b.cents)]));
      const included = new Set(rows.filter(r => r.kind === "BALANCES").map(r => r.data.code));
      if (accounts.some(a => (current.get(a.id) ?? 0n) !== 0n && !included.has(a.code))) throw new AppError("migration.coverage");
      state = { accounts, balances, periods };
      entries = rows.map(source => {
        if (source.kind !== "BALANCES") throw new AppError("migration.invalid");
        const target = BigInt(source.data.debitCents) - BigInt(source.data.creditCents), account = accounts.find(a => a.code === source.data.code);
        if (!account) return { source, status: "CONFLICT", reason: "reference" };
        const before = current.get(account.id) ?? 0n, delta = target - before;
        const reason: Reason | undefined = !delta ? undefined : !account.isActive ? "inactive" : !acceptsManualEntries(account) ? "controls" : (delta < 0n ? -delta : delta) > MAX_LINE_CENTS ? "amount" : undefined;
        return { source, status: reason ? "CONFLICT" : delta ? "NEW" : "UNCHANGED", reason, targetId: account.id, targetName: account.nameFr, currentCents: before.toString(), targetCents: target.toString(), deltaCents: delta.toString() };
      });
    }
  }

  const fingerprint = digest({ kind: spec.kind, cutoverDate: spec.kind === "BALANCES" ? spec.cutoverDate : "", rows: prepared.rows.map(r => ({ kind: r.kind, key: r.key, data: r.data, ...(r.kind === "ITEMS" ? { refs: r.refs } : {}) })) });
  if (await tx.migrationBatch.findUnique({ where: { companyId_kind_fingerprint: { companyId, kind: spec.kind, fingerprint } }, select: { id: true } })) throw new AppError("migration.alreadyImported");
  const createdCount = entries.filter(e => e.status === "NEW").length, skippedCount = entries.length - createdCount;
  const ready = createdCount > 0 && !entries.some(e => e.status === "CONFLICT" || (e.status === "EXISTS" && !spec.skipExisting));
  return { entries, createdCount, skippedCount, ready, stateDigest: digest(state), fingerprint };
}
function signature(actor: CompanyContext, data: Prepared, plan: Awaited<ReturnType<typeof buildPlan>>, expires: number, text: string) {
  return createHmac("sha256", env().AUTH_SECRET).update("allumi:quickbooks-migration:v1\n" + JSON.stringify(canonical({ actor: { userId: actor.userId, companyId: actor.companyId }, spec: data.spec, file: createHash("sha256").update(text).digest("hex"), fingerprint: plan.fingerprint, state: plan.stateDigest, expires }))).digest("hex");
}
export async function previewMigration(actor: CompanyContext, text: string, input: unknown) {
  const data = parse(text, input);
  return withCompany(actor, async tx => {
    await access(tx, data.spec.kind);
    const plan = await buildPlan(tx, actor, data, false), expires = Date.now() + TTL;
    const totals = data.spec.kind === "BALANCES" ? plan.entries.reduce((sum, row) => {
      if (row.source.kind === "BALANCES") { sum.targetDebitCents += BigInt(row.source.data.debitCents); sum.targetCreditCents += BigInt(row.source.data.creditCents); }
      const delta = BigInt(row.deltaCents ?? "0"); if (delta > 0n) sum.adjustmentDebitCents += delta; else sum.adjustmentCreditCents -= delta;
      return sum;
    }, { targetDebitCents: 0n, targetCreditCents: 0n, adjustmentDebitCents: 0n, adjustmentCreditCents: 0n }) : null;
    return { rows: plan.entries, ignored: data.ignored, createdCount: plan.createdCount, skippedCount: plan.skippedCount, ready: plan.ready, totals: totals ? { targetDebitCents: totals.targetDebitCents.toString(), targetCreditCents: totals.targetCreditCents.toString(), adjustmentDebitCents: totals.adjustmentDebitCents.toString(), adjustmentCreditCents: totals.adjustmentCreditCents.toString() } : null, token: `${expires}.${signature(actor, data, plan, expires, text)}`, expires };
  });
}
export type MigrationPreview = Awaited<ReturnType<typeof previewMigration>>;
export async function confirmMigration(actor: CompanyContext, text: string, input: unknown, token: string, acknowledged: boolean) {
  if (!acknowledged || typeof token !== "string" || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) throw new AppError("migration.confirm");
  const [rawTime, mac] = token.split("."), expires = Number(rawTime);
  if (expires < Date.now() || expires > Date.now() + TTL) throw new AppError("migration.stale");
  const data = parse(text, input);
  try { return await withCompany(actor, async tx => {
    await access(tx, data.spec.kind);
    // The company row serializes imports and waits for in-flight FK writes before the fresh destination read.
    await tx.$queryRaw`SELECT id FROM company WHERE id=${actor.companyId}::uuid FOR UPDATE`;
    const plan = await buildPlan(tx, actor, data, true), expected = signature(actor, data, plan, expires, text);
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(mac!, "hex"))) throw new AppError("migration.stale");
    if (!plan.ready) throw new AppError("migration.conflicts");
    const added = plan.entries.filter(e => e.status === "NEW"), ids = added.map(() => randomUUID());
    let journalEntryId: string | null = null;
    if (data.spec.kind === "CUSTOMERS" || data.spec.kind === "SUPPLIERS") {
      await tx.contact.createMany({ data: added.map((e, i) => {
        if (e.source.kind !== "CUSTOMERS" && e.source.kind !== "SUPPLIERS") throw new AppError("migration.invalid");
        const { kind, ...values } = e.source.data;
        return { id: ids[i]!, companyId: actor.companyId, ...values, isCustomer: kind !== "SUPPLIER", isSupplier: kind !== "CUSTOMER" };
      }) });
    } else if (data.spec.kind === "ITEMS") {
      await tx.item.createMany({ data: added.map((e, i) => {
        if (e.source.kind !== "ITEMS" || !e.refs) throw new AppError("migration.invalid");
        return { ...e.source.data, id: ids[i]!, companyId: actor.companyId, incomeAccountId: e.refs.income, expenseAccountId: e.refs.expense, defaultTaxCodeId: e.refs.tax };
      }) });
    } else if (data.spec.kind === "ACCOUNTS") {
      await tx.account.createMany({ data: added.map((e, i) => {
        if (e.source.kind !== "ACCOUNTS") throw new AppError("migration.invalid");
        return { ...e.source.data, id: ids[i]!, companyId: actor.companyId };
      }) });
    } else {
      const lines: EntryLine[] = added.map(e => { const delta = BigInt(e.deltaCents!); return { accountId: e.targetId!, debitCents: delta > 0n ? delta : 0n, creditCents: delta < 0n ? -delta : 0n }; });
      const posted = await postManualEntryWithin(tx, actor, { date: data.spec.cutoverDate, kind: "OPENING_BALANCE", memo: `QuickBooks ${data.spec.source} — ${data.spec.cutoverDate}`, lines }); journalEntryId = posted.id;
    }
    const batch = await tx.migrationBatch.create({ data: { companyId: actor.companyId, createdById: actor.userId, source: data.spec.source, kind: data.spec.kind, fingerprint: plan.fingerprint, sourceDigest: createHash("sha256").update(text).digest("hex"), rowCount: plan.entries.length, createdCount: plan.createdCount, skippedCount: plan.skippedCount, journalEntryId } });
    await recordEvent(tx, { action: "migration.import", entityType: "migration_batch", entityId: batch.id, data: { kind: data.spec.kind, source: data.spec.source, count: plan.createdCount, ignoredColumns: data.ignored.map(c => c.column), journalEntryId, created: journalEntryId ? [] : added.map((e, i) => ({ id: ids[i]!, sourceRow: e.source.row })) } });
    return { id: batch.id, createdCount: plan.createdCount, skippedCount: plan.skippedCount, journalEntryId };
  }); } catch (e) { if (isConflict(e)) throw new AppError("migration.alreadyImported"); throw e; }
}
export async function migrationHistory(actor: CompanyContext) {
  return withCompany(actor, async tx => { await requireRole(tx, "migration.manage"); return tx.migrationBatch.findMany({ where: { companyId: actor.companyId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 }); });
}
