import "server-only";
import { requireRole } from "@/modules/companies";
import { AppError, prismaErrorCode } from "@/platform/errors";
import { accountInputSchema, accountPatchSchema, type AccountInput, type AccountPatch, type AccountSubtype, type AccountType, type SystemAccount } from "../domain/accounts";
import { inCompany, type Actor } from "./support";

export type AccountDto = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  type: AccountType;
  subtype: AccountSubtype;
  parentId: string | null;
  systemKey: SystemAccount | null;
  isActive: boolean;
  description: string | null;
};

type AccountRow = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  type: AccountType;
  subtype: AccountSubtype;
  parentId: string | null;
  systemKey: SystemAccount | null;
  isActive: boolean;
  description: string | null;
};

const SELECT = { id: true, code: true, nameFr: true, nameEn: true, type: true, subtype: true, parentId: true, systemKey: true, isActive: true, description: true } as const;

export function toAccountDto(row: AccountRow): AccountDto {
  return { ...row };
}

export async function listAccounts(actor: Actor, options: { includeInactive?: boolean } = {}): Promise<AccountDto[]> {
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "ledger.read");
    const rows = await tx.account.findMany({
      where: { companyId: actor.companyId, ...(options.includeInactive ? {} : { isActive: true }) },
      select: SELECT,
      orderBy: { code: "asc" },
    });
    return rows.map(toAccountDto);
  });
}

export async function createAccount(actor: Actor, input: AccountInput): Promise<AccountDto> {
  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("ledger.invalidAccount");
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "account.manage");
    if (await tx.account.findFirst({ where: { companyId: actor.companyId, code: parsed.data.code }, select: { id: true } })) {
      throw new AppError("ledger.codeTaken");
    }
    const row = await tx.account.create({
      data: { companyId: actor.companyId, ...parsed.data, parentId: parsed.data.parentId ?? null, description: parsed.data.description ?? null },
      select: SELECT,
    });
    return toAccountDto(row);
  });
}

export async function updateAccount(actor: Actor, accountId: string, patch: AccountPatch): Promise<AccountDto> {
  const parsed = accountPatchSchema.safeParse(patch);
  if (!parsed.success) throw new AppError("ledger.invalidAccount");
  return inCompany(actor, async (tx) => {
    await requireRole(tx, "account.manage");
    const current = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { id: true } });
    if (!current) throw new AppError("ledger.accountNotFound");
    const { code } = parsed.data;
    if (code !== undefined && (await tx.account.findFirst({ where: { companyId: actor.companyId, code, NOT: { id: accountId } }, select: { id: true } }))) {
      throw new AppError("ledger.codeTaken");
    }
    const row = await tx.account.update({ where: { companyId_id: { companyId: actor.companyId, id: accountId } }, data: parsed.data, select: SELECT });
    return toAccountDto(row);
  });
}

/** Only an account with no postings and no other use can go; otherwise deactivate it. System accounts never go (AL005). */
export async function deleteAccount(actor: Actor, accountId: string): Promise<void> {
  await inCompany(actor, async (tx) => {
    await requireRole(tx, "account.manage");
    const account = await tx.account.findFirst({ where: { companyId: actor.companyId, id: accountId }, select: { id: true, systemKey: true } });
    if (!account) throw new AppError("ledger.accountNotFound");
    if (account.systemKey) throw new AppError("AL005");
    if ((await tx.journalLine.count({ where: { companyId: actor.companyId, accountId } })) > 0) throw new AppError("ledger.accountInUse");
    try {
      await tx.account.delete({ where: { companyId_id: { companyId: actor.companyId, id: accountId } } });
    } catch (error) {
      if (prismaErrorCode(error) === "P2003") throw new AppError("ledger.accountInUse");
      throw error;
    }
  });
}
