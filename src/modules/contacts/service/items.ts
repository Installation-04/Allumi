import "server-only";
import { requireRole } from "@/modules/companies";
import { decimalFromDb, decimalToDb } from "@/modules/taxes";
import { inCompany, type Actor } from "@/platform/company";
import { likeText } from "@/platform/search";
import { AppError, isConflict, prismaErrorCode } from "@/platform/errors";
import type { Tx } from "@/platform/tenant";
import { itemInputSchema, type ItemInput } from "../domain/item";

export const ITEMS_PER_PAGE = 25;

export type ItemDto = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  /** Micro-dollars (six decimals), or none. */
  unitPrice: bigint | null;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  defaultTaxCodeId: string | null;
  isActive: boolean;
};

type ItemRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  unitPrice: { toFixed(places: number): string } | null;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  defaultTaxCodeId: string | null;
  isActive: boolean;
};

const toDto = (row: ItemRow): ItemDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  unitPrice: row.unitPrice ? decimalFromDb(row.unitPrice.toFixed(6), 6) : null,
  incomeAccountId: row.incomeAccountId,
  expenseAccountId: row.expenseAccountId,
  defaultTaxCodeId: row.defaultTaxCodeId,
  isActive: row.isActive,
});

export type ItemList = { items: ItemDto[]; total: number; page: number; pageCount: number };

export async function listItems(actor: Actor, options: { search?: string; includeInactive?: boolean; page?: number } = {}): Promise<ItemList> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "item.read");
    const search = options.search?.trim();
    const where = {
      companyId: actor.companyId,
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(search ? { OR: [{ name: { contains: likeText(search), mode: "insensitive" as const } }, { code: { contains: likeText(search), mode: "insensitive" as const } }] } : {}),
    };
    const total = await tx.item.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
    const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1) || 1), pageCount);
    const rows = await tx.item.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * ITEMS_PER_PAGE, take: ITEMS_PER_PAGE });
    return { items: rows.map(toDto), total, page, pageCount };
  });
}

export async function getItem(actor: Actor, itemId: string): Promise<ItemDto | null> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "item.read");
    const row = await tx.item.findFirst({ where: { companyId: actor.companyId, id: itemId } });
    return row ? toDto(row) : null;
  });
}

/** An item's accounts must be revenue (sales) and expense (purchases) accounts of the company, its tax code one of the company's. */
async function checkReferences(tx: Tx, companyId: string, item: { incomeAccountId: string | null; expenseAccountId: string | null; defaultTaxCodeId: string | null }): Promise<void> {
  for (const [id, type] of [[item.incomeAccountId, "REVENUE"], [item.expenseAccountId, "EXPENSE"]] as const) {
    if (!id) continue;
    const account = await tx.account.findFirst({ where: { companyId, id }, select: { type: true, isActive: true } });
    if (!account || account.type !== type || !account.isActive) throw new AppError("items.accountInvalid");
  }
  if (item.defaultTaxCodeId && !(await tx.taxCode.findFirst({ where: { companyId, id: item.defaultTaxCodeId }, select: { id: true } }))) throw new AppError("items.taxCodeNotFound");
}

function data(item: ReturnType<typeof itemInputSchema.parse>) {
  return { ...item, unitPrice: item.unitPrice === null ? null : decimalToDb(item.unitPrice, 6) };
}

export async function createItem(actor: Actor, input: ItemInput): Promise<ItemDto> {
  const parsed = itemInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("items.invalid");
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "item.manage");
    await checkReferences(tx, actor.companyId, parsed.data);
    try {
      return toDto(await tx.item.create({ data: { companyId: actor.companyId, ...data(parsed.data) } }));
    } catch (error) {
      if (isConflict(error)) throw new AppError("items.codeTaken");
      throw error;
    }
  });
}

export async function updateItem(actor: Actor, itemId: string, input: ItemInput): Promise<ItemDto> {
  const parsed = itemInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("items.invalid");
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "item.manage");
    if (!(await tx.item.findFirst({ where: { companyId: actor.companyId, id: itemId }, select: { id: true } }))) throw new AppError("items.notFound");
    await checkReferences(tx, actor.companyId, parsed.data);
    try {
      return toDto(await tx.item.update({ where: { companyId_id: { companyId: actor.companyId, id: itemId } }, data: data(parsed.data) }));
    } catch (error) {
      if (isConflict(error)) throw new AppError("items.codeTaken");
      throw error;
    }
  });
}

export async function setItemActive(actor: Actor, itemId: string, active: boolean): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "item.manage");
    const updated = await tx.item.updateMany({ where: { companyId: actor.companyId, id: itemId }, data: { isActive: active } });
    if (updated.count !== 1) throw new AppError("items.notFound");
  });
}

/** Only an item that no document line uses can go; otherwise it is deactivated. */
export async function deleteItem(actor: Actor, itemId: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "item.manage");
    if (!(await tx.item.findFirst({ where: { companyId: actor.companyId, id: itemId }, select: { id: true } }))) throw new AppError("items.notFound");
    try {
      await tx.item.delete({ where: { companyId_id: { companyId: actor.companyId, id: itemId } } });
    } catch (error) {
      if (prismaErrorCode(error) === "P2003" || prismaErrorCode(error) === "P2014") throw new AppError("items.inUse");
      throw error;
    }
  });
}
