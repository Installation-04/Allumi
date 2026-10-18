import "server-only";
import { requireRole } from "@/modules/companies";
import { ensureSalesTaxAccount, fromDbDate, listAccounts, toDbDate, todayIso, type IsoDate } from "@/modules/ledger";
import { inCompany, type Actor } from "@/platform/company";
import { AppError, isConflict } from "@/platform/errors";
import { decimalFromDb, decimalToDb } from "../domain/decimal";
import { planRateChange, rateOn, type RateRow } from "../domain/rates";
import { taxCodeInputSchema, taxCodePatchSchema, taxInputSchema, taxPatchSchema, taxRateInputSchema, type TaxCodeInput, type TaxCodePatch, type TaxInput, type TaxPatch } from "../domain/schemas";
import { QUEBEC_TAX_CODES, QUEBEC_TAXES, type TaxTreatment } from "../domain/starter";

export type RateDto = { id: string; rateMicro: bigint; from: IsoDate; to: IsoDate | null };

export type TaxDto = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  registrationNumber: string | null;
  payableAccountId: string;
  recoverableAccountId: string | null;
  isActive: boolean;
  /** Newest first. */
  rates: RateDto[];
  /** The rate in force today, if any. */
  currentRateMicro: bigint | null;
};

export type TaxCodeDto = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  treatment: TaxTreatment;
  isActive: boolean;
  /** The taxes the code applies, in order. */
  taxes: { id: string; code: string; nameFr: string; nameEn: string }[];
};

const rateDto = (row: { id: string; rate: { toFixed(places: number): string }; effectiveFrom: Date; effectiveTo: Date | null }): RateDto => ({
  id: row.id,
  rateMicro: decimalFromDb(row.rate.toFixed(6), 6),
  from: fromDbDate(row.effectiveFrom),
  to: row.effectiveTo ? fromDbDate(row.effectiveTo) : null,
});

const rateRow = (rate: RateDto): RateRow => ({ id: rate.id, rateMicro: rate.rateMicro, from: rate.from, to: rate.to });

type TaxRow = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  registrationNumber: string | null;
  payableAccountId: string;
  recoverableAccountId: string | null;
  isActive: boolean;
  rates: { id: string; rate: { toFixed(places: number): string }; effectiveFrom: Date; effectiveTo: Date | null }[];
};

function taxDto(row: TaxRow, today: IsoDate): TaxDto {
  const rates = row.rates.map(rateDto).sort((a, b) => (a.from < b.from ? 1 : -1));
  return {
    id: row.id,
    code: row.code,
    nameFr: row.nameFr,
    nameEn: row.nameEn,
    registrationNumber: row.registrationNumber,
    payableAccountId: row.payableAccountId,
    recoverableAccountId: row.recoverableAccountId,
    isActive: row.isActive,
    rates,
    currentRateMicro: rateOn(rates.map(rateRow), today),
  };
}

const INCLUDE_RATES = { rates: { orderBy: { effectiveFrom: "desc" as const } } };

export async function listTaxes(actor: Actor, options: { now?: Date } = {}): Promise<TaxDto[]> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.read");
    const rows = await tx.tax.findMany({ where: { companyId: actor.companyId }, include: INCLUDE_RATES, orderBy: { code: "asc" } });
    const today = todayIso(options.now);
    return rows.map((row) => taxDto(row, today));
  });
}

export async function getTax(actor: Actor, taxId: string, options: { now?: Date } = {}): Promise<TaxDto | null> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.read");
    const row = await tx.tax.findFirst({ where: { companyId: actor.companyId, id: taxId }, include: INCLUDE_RATES });
    return row ? taxDto(row, todayIso(options.now)) : null;
  });
}

/**
 * Creates a tax with its first rate. Without accounts given, its accounts are created (the payable one, a liability, and, unless
 * told otherwise, the recoverable one, an asset: the tax a purchase can claim back). Given accounts must be sales-tax accounts of
 * the right type.
 */
export async function createTax(actor: Actor, input: TaxInput): Promise<TaxDto> {
  const parsed = taxInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("taxes.invalid");
  const data = parsed.data;

  await inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    if (await tx.tax.findFirst({ where: { companyId: actor.companyId, code: data.code }, select: { id: true } })) throw new AppError("taxes.codeTaken");
    for (const [id, type] of [[data.payableAccountId, "LIABILITY"], [data.recoverableAccountId, "ASSET"]] as const) {
      if (!id) continue;
      const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id }, select: { subtype: true, type: true } });
      if (!account || account.subtype !== "SALES_TAX" || account.type !== type) throw new AppError("taxes.accountInvalid");
    }
    if (data.payableAccountId && data.payableAccountId === data.recoverableAccountId) throw new AppError("taxes.accountInvalid");
  });

  const payable =
    data.payableAccountId ??
    (await ensureSalesTaxAccount(actor, { code: "2150", nameFr: `${data.nameFr} à payer`, nameEn: `${data.nameEn} payable`, type: "LIABILITY" })).id;
  const recoverable =
    data.recoverableAccountId ??
    (data.recoverable ? (await ensureSalesTaxAccount(actor, { code: "1250", nameFr: `${data.nameFr} à recevoir`, nameEn: `${data.nameEn} receivable`, type: "ASSET" })).id : null);

  const id = await inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    try {
      const tax = await tx.tax.create({
        data: {
          companyId: actor.companyId,
          code: data.code,
          nameFr: data.nameFr,
          nameEn: data.nameEn,
          registrationNumber: data.registrationNumber,
          payableAccountId: payable,
          recoverableAccountId: recoverable,
        },
        select: { id: true },
      });
      await tx.taxRate.create({ data: { companyId: actor.companyId, taxId: tax.id, rate: decimalToDb(data.rateMicro, 6), effectiveFrom: toDbDate(data.from) } });
      return tax.id;
    } catch (error) {
      if (isConflict(error)) throw new AppError("taxes.codeTaken");
      throw error;
    }
  });
  const created = await getTax(actor, id);
  if (!created) throw new AppError("taxes.notFound");
  return created;
}

export async function updateTax(actor: Actor, taxId: string, patch: TaxPatch): Promise<TaxDto> {
  const parsed = taxPatchSchema.safeParse(patch);
  if (!parsed.success) throw new AppError("taxes.invalid");
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    const updated = await tx.tax.updateMany({ where: { companyId: actor.companyId, id: taxId }, data: parsed.data });
    if (updated.count !== 1) throw new AppError("taxes.notFound");
  });
  const tax = await getTax(actor, taxId);
  if (!tax) throw new AppError("taxes.notFound");
  return tax;
}

/**
 * Adds a rate that starts on a date: the rate in force is closed the day before. History is only extended at its end, so
 * documents already written (which keep their rate) and the reports of past periods do not move.
 */
export async function addTaxRate(actor: Actor, taxId: string, input: { rateMicro: bigint; from: IsoDate }): Promise<TaxDto> {
  const parsed = taxRateInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("taxes.invalid");
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    const tax = await tx.tax.findFirst({ where: { companyId: actor.companyId, id: taxId }, include: INCLUDE_RATES });
    if (!tax) throw new AppError("taxes.notFound");
    const plan = planRateChange(tax.rates.map(rateDto).map(rateRow), parsed.data.from);
    if (!plan.ok) throw new AppError(`taxes.rate.${plan.problem}`);
    try {
      if (plan.plan.closePrevious) {
        await tx.taxRate.updateMany({ where: { companyId: actor.companyId, taxId, id: plan.plan.closePrevious.id }, data: { effectiveTo: toDbDate(plan.plan.closePrevious.to) } });
      }
      await tx.taxRate.create({ data: { companyId: actor.companyId, taxId, rate: decimalToDb(parsed.data.rateMicro, 6), effectiveFrom: toDbDate(parsed.data.from) } });
    } catch (error) {
      if (isConflict(error)) throw new AppError("taxes.rate.overlap"); // a double click: the other request added it first
      throw error;
    }
  });
  const tax = await getTax(actor, taxId);
  if (!tax) throw new AppError("taxes.notFound");
  return tax;
}

type TaxCodeRow = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  treatment: TaxTreatment;
  isActive: boolean;
  components: { position: number; tax: { id: string; code: string; nameFr: string; nameEn: string } }[];
};

const taxCodeDto = (row: TaxCodeRow): TaxCodeDto => ({
  id: row.id,
  code: row.code,
  nameFr: row.nameFr,
  nameEn: row.nameEn,
  treatment: row.treatment,
  isActive: row.isActive,
  taxes: [...row.components].sort((a, b) => a.position - b.position).map((component) => component.tax),
});

const INCLUDE_COMPONENTS = { components: { include: { tax: { select: { id: true, code: true, nameFr: true, nameEn: true } } } } };

export async function listTaxCodes(actor: Actor): Promise<TaxCodeDto[]> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.read");
    const rows = await tx.taxCode.findMany({ where: { companyId: actor.companyId }, include: INCLUDE_COMPONENTS, orderBy: { code: "asc" } });
    return rows.map(taxCodeDto);
  });
}

/** A code names the taxes a line carries: standard codes have at least one, the others (zero-rated, exempt, out of scope) none. */
export async function createTaxCode(actor: Actor, input: TaxCodeInput): Promise<TaxCodeDto> {
  const parsed = taxCodeInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("taxes.invalidCode");
  const data = parsed.data;
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    if (await tx.taxCode.findFirst({ where: { companyId: actor.companyId, code: data.code }, select: { id: true } })) throw new AppError("taxes.codeTaken");
    if (data.taxIds.length > 0 && (await tx.tax.count({ where: { companyId: actor.companyId, id: { in: data.taxIds } } })) !== data.taxIds.length) throw new AppError("taxes.notFound");
    try {
      const created = await tx.taxCode.create({
        data: { companyId: actor.companyId, code: data.code, nameFr: data.nameFr, nameEn: data.nameEn, treatment: data.treatment },
        select: { id: true },
      });
      // the deferred check of the database (a standard code has taxes, the others none) runs at the commit
      await tx.taxCodeComponent.createMany({ data: data.taxIds.map((taxId, index) => ({ companyId: actor.companyId, taxCodeId: created.id, taxId, position: index + 1 })) });
      const row = await tx.taxCode.findFirstOrThrow({ where: { companyId: actor.companyId, id: created.id }, include: INCLUDE_COMPONENTS });
      return taxCodeDto(row);
    } catch (error) {
      if (isConflict(error)) throw new AppError("taxes.codeTaken");
      throw error;
    }
  });
}

/** Names and availability only: what a code taxes is part of its meaning for the documents that use it (create another code). */
export async function updateTaxCode(actor: Actor, taxCodeId: string, patch: TaxCodePatch): Promise<void> {
  const parsed = taxCodePatchSchema.safeParse(patch);
  if (!parsed.success) throw new AppError("taxes.invalidCode");
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    const updated = await tx.taxCode.updateMany({ where: { companyId: actor.companyId, id: taxCodeId }, data: parsed.data });
    if (updated.count !== 1) throw new AppError("taxes.notFound");
  });
}

/**
 * Installs the taxes of Québec (GST and QST, with their codes: GST + QST, GST only, zero-rated, exempt, out of scope)
 * on the accounts of the starter chart. Safe to run again: it only adds what is missing.
 */
export async function installQuebecTaxes(actor: Actor): Promise<{ taxes: number; codes: number }> {
  // The tax accounts first (the chart's own, or new ones on the next free code), each in its own transaction.
  const existing = await listAccounts(actor, { includeInactive: true });
  const accountIds = new Map<string, { payable: string; recoverable: string }>();
  for (const starter of QUEBEC_TAXES) {
    const payable = existing.find((account) => account.code === starter.payableAccount.code && account.subtype === "SALES_TAX" && account.type === "LIABILITY");
    const recoverable = existing.find((account) => account.code === starter.recoverableAccount.code && account.subtype === "SALES_TAX" && account.type === "ASSET");
    accountIds.set(starter.code, {
      payable: payable?.id ?? (await ensureSalesTaxAccount(actor, { ...starter.payableAccount, type: "LIABILITY" })).id,
      recoverable: recoverable?.id ?? (await ensureSalesTaxAccount(actor, { ...starter.recoverableAccount, type: "ASSET" })).id,
    });
  }

  return inCompany(actor, async (tx) => {
    await requireRole(tx, "tax.manage");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`taxes-install:${actor.companyId}`}, 0))`;
    let taxes = 0;
    let codes = 0;
    const idByCode = new Map<string, string>();
    for (const starter of QUEBEC_TAXES) {
      const found = await tx.tax.findFirst({ where: { companyId: actor.companyId, code: starter.code }, select: { id: true } });
      if (found) {
        idByCode.set(starter.code, found.id);
        continue;
      }
      const accounts = accountIds.get(starter.code);
      if (!accounts) continue;
      const tax = await tx.tax.create({
        data: { companyId: actor.companyId, code: starter.code, nameFr: starter.nameFr, nameEn: starter.nameEn, payableAccountId: accounts.payable, recoverableAccountId: accounts.recoverable },
        select: { id: true },
      });
      await tx.taxRate.create({ data: { companyId: actor.companyId, taxId: tax.id, rate: decimalToDb(starter.rateMicro, 6), effectiveFrom: toDbDate(starter.from) } });
      idByCode.set(starter.code, tax.id);
      taxes += 1;
    }
    for (const starter of QUEBEC_TAX_CODES) {
      if (await tx.taxCode.findFirst({ where: { companyId: actor.companyId, code: starter.code }, select: { id: true } })) continue;
      const taxIds = starter.taxCodes.map((code) => idByCode.get(code)).filter((id): id is string => id !== undefined);
      if (taxIds.length !== starter.taxCodes.length) continue;
      const created = await tx.taxCode.create({
        data: { companyId: actor.companyId, code: starter.code, nameFr: starter.nameFr, nameEn: starter.nameEn, treatment: starter.treatment },
        select: { id: true },
      });
      await tx.taxCodeComponent.createMany({ data: taxIds.map((taxId, index) => ({ companyId: actor.companyId, taxCodeId: created.id, taxId, position: index + 1 })) });
      codes += 1;
    }
    return { taxes, codes };
  });
}
