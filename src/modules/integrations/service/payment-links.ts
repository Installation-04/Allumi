import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/modules/companies";
import { postManualEntryWithin } from "@/modules/ledger";
import { recordReceiptWithin } from "@/modules/payments";
import { AppError, isConflict, toAppError } from "@/platform/errors";
import { decrypt } from "@/platform/secrets";
import { withCompany, type CompanyContext, type Tx } from "@/platform/tenant";
import { createPaymentConnector, fetchHttp, type PaymentConnector } from "../connectors";
import { parseStoredCredentials } from "../domain/credentials";
import { bookingDate, feeEntryLines, linkAmountProblem, linkDescription, paymentProblem, reviewCode, type PaidSession, type PaymentLinkStatus } from "../domain/online-payment";
import type { ProviderId } from "../domain/provider";
import { credentialBinding, type Deps } from "./connections";
import { failureCode } from "./failure";

/** One press looks at most this many links, for at most this long: press again to continue. */
const MAX_LINKS_PER_RUN = 50;
const BUDGET_MS = 40_000;
/** The failures that say every other link would fail the same way: stop and tell the person. */
const STOPPING = new Set(["integrations.unauthorized", "integrations.forbidden", "integrations.rateLimited", "integrations.unavailable"]);

type Loaded = { id: string; provider: ProviderId; sandbox: boolean; accountId: string; feeAccountId: string | null; secret: Uint8Array };

/** The connection of a payment link: active, with its encrypted credentials. Owner only: the credentials are the owner's. */
async function loadConnection(tx: Tx, actor: CompanyContext, connectionId: string): Promise<Loaded> {
  await requireRole(tx, "integration.manage");
  const connection = await tx.integrationConnection.findFirst({
    where: { companyId: actor.companyId, id: connectionId }, select: { id: true, provider: true, status: true, sandbox: true, accountId: true, feeAccountId: true },
  });
  if (!connection) throw new AppError("integrations.notFound");
  if (connection.provider !== "STRIPE") throw new AppError("onlinePayments.provider");
  if (connection.status !== "ACTIVE") throw new AppError("integrations.disabled");
  const credential = await tx.integrationCredential.findFirst({ where: { companyId: actor.companyId, connectionId }, select: { credentialsEnc: true } });
  if (!credential?.credentialsEnc) throw new AppError("integrations.disabled");
  return { ...connection, secret: credential.credentialsEnc };
}

function openConnector(loaded: Loaded, actor: CompanyContext, deps: Deps): PaymentConnector {
  const credentials = (() => {
    try {
      return parseStoredCredentials(loaded.provider, decrypt(loaded.secret, credentialBinding(actor.companyId, loaded.id)));
    } catch {
      return null; // wrong key, another row's blob, a damaged one
    }
  })();
  if (!credentials) throw new AppError("integrations.credentials");
  return createPaymentConnector(loaded.provider, credentials, { sandbox: loaded.sandbox, http: deps.http ?? fetchHttp });
}

const openBalance = async (tx: Tx, companyId: string, invoiceId: string): Promise<bigint> => {
  const rows = await tx.$queryRaw<{ cents: bigint }[]>`SELECT sales_document_open_cents(${companyId}::uuid, ${invoiceId}::uuid) AS cents`;
  return rows[0]?.cents ?? 0n;
};

const lockInvoice = async (tx: Tx, companyId: string, invoiceId: string): Promise<boolean> => {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_document WHERE company_id = ${companyId}::uuid AND id = ${invoiceId}::uuid AND kind = 'INVOICE' FOR UPDATE`;
  return rows.length > 0;
};

// ---------------------------------------------------------------- create

const createSchema = z.object({ invoiceId: z.string().uuid(), connectionId: z.string().uuid() });

/**
 * Makes a payment page for the open balance of a posted invoice: owner only (the keys are the owner's). The link is
 * reserved first (one live link per invoice, enforced by the database), then made at the service in two idempotent
 * calls (a price, a page), then marked active with its address. A failure in between leaves the link pending with
 * the reason; pressing again resumes it, and the service hands back what the first attempt made.
 */
export async function createPaymentLink(actor: CompanyContext, input: unknown, deps: Deps = {}): Promise<{ id: string; url: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new AppError("onlinePayments.invalid");
  const { invoiceId, connectionId } = parsed.data;

  try {
    const reserved = await withCompany(actor, async (tx) => {
      await requireRole(tx, "sales.manage");
      const loaded = await loadConnection(tx, actor, connectionId);
      if (!loaded.feeAccountId) throw new AppError("onlinePayments.feeAccount");
      if (!(await lockInvoice(tx, actor.companyId, invoiceId))) throw new AppError("onlinePayments.invoiceNotFound");
      const invoice = await tx.salesDocument.findFirstOrThrow({ where: { companyId: actor.companyId, id: invoiceId }, select: { number: true, status: true, currency: true, locale: true } });
      if (invoice.status !== "POSTED") throw new AppError("payments.invoiceNotOpen");
      const open = await openBalance(tx, actor.companyId, invoiceId);
      if (open <= 0n) throw new AppError("onlinePayments.nothingDue");
      const problem = linkAmountProblem(open, invoice.currency);
      if (problem) throw new AppError(problem);

      const live = await tx.paymentLink.findFirst({ where: { companyId: actor.companyId, invoiceId, status: { in: ["PENDING", "ACTIVE"] } } });
      let link = live;
      if (live && (live.amountCents !== open || live.connectionId !== connectionId)) {
        // A pending link nobody finished is replaced by one for today's balance; a live one is cancelled by the person, on purpose.
        if (live.status === "ACTIVE") throw new AppError("onlinePayments.linkExists");
        await tx.paymentLink.update({ where: { companyId_id: { companyId: actor.companyId, id: live.id } }, data: { status: "CANCELLED" } });
        link = null;
      }
      link ??= await tx.paymentLink.create({
        data: { id: randomUUID(), companyId: actor.companyId, invoiceId, connectionId, amountCents: open, currency: invoice.currency, createdById: actor.userId },
      });
      return { link, loaded, description: linkDescription(invoice.number, invoice.locale) };
    });

    const { link } = reserved;
    if (link.status === "ACTIVE" && link.url) return { id: link.id, url: link.url };

    try {
      const connector = openConnector(reserved.loaded, actor, deps);
      const known = link.externalPriceId;
      const priceId = known ?? (await connector.createPrice({ linkId: link.id, amountCents: link.amountCents, currency: link.currency, name: reserved.description }));
      if (!known) await withCompany(actor, (tx) => tx.paymentLink.update({ where: { companyId_id: { companyId: actor.companyId, id: link.id } }, data: { externalPriceId: priceId } }));
      const remote = await connector.createLink({ linkId: link.id, priceId, description: reserved.description });
      return await withCompany(actor, async (tx) => {
        await requireRole(tx, "integration.manage");
        const done = await tx.paymentLink.updateMany({
          where: { companyId: actor.companyId, id: link.id, status: "PENDING" },
          data: { status: "ACTIVE", externalId: remote.id, url: remote.url, lastError: null },
        });
        if (done.count === 1) return { id: link.id, url: remote.url };
        // Two presses made the same link (the service answered both with the same page): the first one's answer stands.
        const current = await tx.paymentLink.findFirst({ where: { companyId: actor.companyId, id: link.id }, select: { status: true, url: true, externalId: true } });
        if (current?.status === "ACTIVE" && current.url && current.externalId === remote.id) return { id: link.id, url: current.url };
        throw new AppError("onlinePayments.linkChanged");
      });
    } catch (error) {
      // Kept on the link so the page can say why it is still pending; best effort, the first failure is the one that counts.
      await withCompany(actor, (tx) =>
        tx.paymentLink.updateMany({ where: { companyId: actor.companyId, id: link.id, status: "PENDING" }, data: { lastError: failureCode(error) } })).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (isConflict(error)) throw new AppError("onlinePayments.linkExists");
    throw toAppError(error);
  }
}

// ---------------------------------------------------------------- collect

export type CollectResult = {
  /** Links looked at. */
  checked: number;
  /** Payments booked. */
  paid: number;
  /** Payments that arrived but could not be booked: the link says why. */
  review: number;
  /** A second payment on a link that was already paid (to refund at the service). */
  extra: number;
  /** Payments started but not settled yet (a bank debit still clearing). */
  waiting: number;
  /** Links that could not be read this time. */
  failed: number;
  /** True when links were left for another press. */
  more: boolean;
};

const emptyResult = (): CollectResult => ({ checked: 0, paid: 0, review: 0, extra: 0, waiting: 0, failed: 0, more: false });

type Booked = { kind: "paid" } | { kind: "ignored" } | { kind: "extra" } | { kind: "review"; reason: string };

/** What the books refuse about a payment is a reason to look at it; anything else (a permission, a bug) is not hidden behind one. */
const isRefusal = (error: unknown): error is AppError =>
  error instanceof AppError && /^((payments|ledger|onlinePayments)\.|AL0\d\d$)/.test(error.key);

/**
 * Books one settled payment on its link, in one transaction: the receipt for the gross amount on the account of the
 * connection (applied to the invoice), the fees as an entry of their own, the online payment and the link marked
 * paid. A payment already booked is left alone; one the books refuse rolls back whole and puts the link to review.
 */
async function bookPayment(actor: CompanyContext, linkId: string, paid: PaidSession, deps: Deps): Promise<Booked> {
  try {
    return await withCompany(actor, async (tx): Promise<Booked> => {
      await requireRole(tx, "integration.manage");
      const rows = await tx.$queryRaw<{ invoice_id: string; connection_id: string; amount_cents: bigint; currency: string; status: PaymentLinkStatus }[]>`
        SELECT invoice_id, connection_id, amount_cents, currency, status::text AS status FROM payment_link
         WHERE company_id = ${actor.companyId}::uuid AND id = ${linkId}::uuid FOR UPDATE`;
      const link = rows[0];
      if (!link) throw new AppError("onlinePayments.notFound");
      if (await tx.onlinePayment.findFirst({ where: { companyId: actor.companyId, providerRef: paid.sessionId }, select: { id: true } })) return { kind: "ignored" };
      if (link.status === "PAID") return { kind: "extra" };
      if (link.status !== "ACTIVE") return { kind: "ignored" };

      const problem = paymentProblem({ amountCents: link.amount_cents, currency: link.currency }, paid);
      if (problem) return { kind: "review", reason: problem };

      const connection = await tx.integrationConnection.findFirst({ where: { companyId: actor.companyId, id: link.connection_id }, select: { accountId: true, feeAccountId: true } });
      if (!connection) throw new AppError("integrations.notFound");
      if (paid.feeCents > 0n && !connection.feeAccountId) return { kind: "review", reason: "onlinePayments.feeAccount" };

      await lockInvoice(tx, actor.companyId, link.invoice_id);
      const open = await openBalance(tx, actor.companyId, link.invoice_id);
      const date = bookingDate(paid.paidAt);
      const receipt = await recordReceiptWithin(tx, actor, {
        invoiceId: link.invoice_id, amountCents: paid.grossCents.toString(), expectedOpenCents: open.toString(), date, accountId: connection.accountId,
        method: "CREDIT_CARD", reference: paid.paymentIntentId, memo: `Stripe · ${paid.sessionId}`,
      }, { now: deps.now });
      // The receipt checked its own rules at once; a new entry needs its lines before its balance is checked again.
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
      const fee = paid.feeCents > 0n && connection.feeAccountId
        ? await postManualEntryWithin(tx, actor, { date, kind: "MANUAL", memo: `Stripe · ${receipt.number}`, lines: feeEntryLines(connection.feeAccountId, connection.accountId, paid.feeCents) })
        : null;
      await tx.onlinePayment.create({
        data: {
          companyId: actor.companyId, linkId, providerRef: paid.sessionId, paymentId: receipt.id, feeEntryId: fee?.id ?? null, grossCents: paid.grossCents,
          feeCents: paid.feeCents, netCents: paid.netCents, currency: paid.currency, paidAt: paid.paidAt, createdById: actor.userId,
        },
      });
      await tx.paymentLink.update({ where: { companyId_id: { companyId: actor.companyId, id: linkId } }, data: { status: "PAID" } });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return { kind: "paid" };
    });
  } catch (error) {
    if (isConflict(error)) return { kind: "ignored" }; // another press booked it first
    const failure = toAppError(error);
    if (!isRefusal(failure)) throw failure;
    return { kind: "review", reason: reviewCode(failure.key) };
  }
}

async function markReview(actor: CompanyContext, linkId: string, reason: string): Promise<void> {
  await withCompany(actor, async (tx) => {
    await requireRole(tx, "integration.manage");
    await tx.paymentLink.updateMany({ where: { companyId: actor.companyId, id: linkId, status: "ACTIVE" }, data: { status: "REVIEW", reviewReason: reason, lastError: null } });
  });
}

/** Reads what a link was paid and books it. */
async function collectLink(actor: CompanyContext, connector: PaymentConnector, link: { id: string; externalId: string }, deps: Deps, into: CollectResult): Promise<void> {
  const { payments, waiting } = await connector.listPayments(link.externalId);
  into.waiting += waiting;
  for (const payment of payments) {
    if (!payment.ok) {
      await markReview(actor, link.id, "onlinePayments.settlementCurrency");
      into.review++;
      continue;
    }
    const booked = await bookPayment(actor, link.id, payment.paid, deps);
    if (booked.kind === "review") {
      await markReview(actor, link.id, booked.reason);
      into.review++;
    } else if (booked.kind === "paid") into.paid++;
    else if (booked.kind === "extra") into.extra++;
  }
}

const collectSchema = z.object({ connectionId: z.string().uuid() });

/**
 * Looks at the active payment links of a connection and books what has been paid: owner only. There is nothing to
 * receive a call from the service, so the owner presses the button (the same way a sync is started). Looking twice
 * is harmless: a session already booked is left as it is.
 */
export async function collectPayments(actor: CompanyContext, input: unknown, deps: Deps = {}): Promise<CollectResult> {
  const parsed = collectSchema.safeParse(input);
  if (!parsed.success) throw new AppError("onlinePayments.invalid");
  try {
    const { loaded, links } = await withCompany(actor, async (tx) => {
      const connection = await loadConnection(tx, actor, parsed.data.connectionId);
      const rows = await tx.paymentLink.findMany({
        where: { companyId: actor.companyId, connectionId: connection.id, status: "ACTIVE", externalId: { not: null } },
        select: { id: true, externalId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_LINKS_PER_RUN + 1,
      });
      return { loaded: connection, links: rows.flatMap((row) => (row.externalId ? [{ id: row.id, externalId: row.externalId }] : [])) };
    });
    const result = emptyResult();
    result.more = links.length > MAX_LINKS_PER_RUN;
    if (links.length === 0) return result;
    const connector = openConnector(loaded, actor, deps);
    const started = Date.now();
    let firstFailure: unknown = null;
    for (const link of links.slice(0, MAX_LINKS_PER_RUN)) {
      if (Date.now() - started > BUDGET_MS) {
        result.more = true;
        break;
      }
      try {
        await collectLink(actor, connector, link, deps, result);
        result.checked++;
        await withCompany(actor, (tx) => tx.paymentLink.updateMany({ where: { companyId: actor.companyId, id: link.id, lastError: { not: null } }, data: { lastError: null } }));
      } catch (error) {
        if (!(error instanceof AppError) || !error.key.startsWith("integrations.")) throw error;
        if (STOPPING.has(error.key)) throw error;
        // This link only: its answer was not usable. Say so on the link and go on with the others.
        result.failed++;
        firstFailure ??= error;
        await withCompany(actor, (tx) => tx.paymentLink.updateMany({ where: { companyId: actor.companyId, id: link.id, status: "ACTIVE" }, data: { lastError: failureCode(error) } })).catch(() => undefined);
      }
    }
    if (result.checked === 0 && firstFailure) throw firstFailure;
    return result;
  } catch (error) {
    throw toAppError(error);
  }
}

// ---------------------------------------------------------------- cancel

export type CancelResult = {
  /** Where the link ended: CANCELLED, or PAID / REVIEW when a payment arrived first. */
  status: PaymentLinkStatus;
  /** False when the page could not be closed at the service (the connection is disconnected): close it in the Stripe dashboard. */
  closedAtService: boolean;
};

/**
 * Cancels a link: owner only. The page is closed at the service first, then looked at once more (a payment made a
 * moment ago is booked, not lost), and only then marked cancelled. A link under review is acknowledged without
 * calling the service.
 */
export async function cancelPaymentLink(actor: CompanyContext, id: string, deps: Deps = {}): Promise<CancelResult> {
  try {
    const link = await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      const row = await tx.paymentLink.findFirst({ where: { companyId: actor.companyId, id }, select: { id: true, status: true, externalId: true, connectionId: true } });
      if (!row) throw new AppError("onlinePayments.notFound");
      return row;
    });
    if (link.status === "PAID") throw new AppError("onlinePayments.alreadyPaid");
    if (link.status === "CANCELLED") return { status: "CANCELLED", closedAtService: true };

    let closedAtService = true;
    if (link.status === "ACTIVE" && link.externalId) {
      const loaded = await withCompany(actor, (tx) => loadConnection(tx, actor, link.connectionId)).catch((error: unknown) => {
        if (error instanceof AppError && error.key === "integrations.disabled") return null;
        throw error;
      });
      if (loaded) {
        const connector = openConnector(loaded, actor, deps);
        await connector.deactivateLink(link.externalId);
        const seen = emptyResult();
        await collectLink(actor, connector, { id: link.id, externalId: link.externalId }, deps, seen);
      } else {
        closedAtService = false;
      }
    }
    const status = await withCompany(actor, async (tx) => {
      await requireRole(tx, "integration.manage");
      // A payment that arrived while cancelling (now PAID, or under review) is not hidden by the cancellation.
      const from = link.status === "REVIEW" ? (["REVIEW"] as const) : (["PENDING", "ACTIVE"] as const);
      const done = await tx.paymentLink.updateMany({ where: { companyId: actor.companyId, id, status: { in: [...from] } }, data: { status: "CANCELLED" } });
      if (done.count === 1) return "CANCELLED" as const;
      const current = await tx.paymentLink.findFirstOrThrow({ where: { companyId: actor.companyId, id }, select: { status: true } });
      return current.status;
    });
    return { status, closedAtService };
  } catch (error) {
    throw toAppError(error);
  }
}

// ---------------------------------------------------------------- read

export type PaymentLinkDto = {
  id: string;
  invoiceId: string;
  connectionId: string;
  connectionLabel: string;
  status: PaymentLinkStatus;
  amountCents: bigint;
  currency: string;
  url: string | null;
  lastError: string | null;
  reviewReason: string | null;
  createdAt: Date;
  /** The payment received, once the link is paid. */
  payment: { paymentId: string; number: string; grossCents: bigint; feeCents: bigint; netCents: bigint; paidAt: Date } | null;
};

/** The payment links of an invoice, newest first. */
export async function listInvoicePaymentLinks(actor: CompanyContext, invoiceId: string): Promise<PaymentLinkDto[]> {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    const rows = await tx.paymentLink.findMany({
      where: { companyId: actor.companyId, invoiceId },
      select: {
        id: true, invoiceId: true, connectionId: true, status: true, amountCents: true, currency: true, url: true, lastError: true, reviewReason: true, createdAt: true,
        connection: { select: { label: true } },
        onlinePayment: { select: { paymentId: true, grossCents: true, feeCents: true, netCents: true, paidAt: true, payment: { select: { number: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    return rows.map((row) => ({
      id: row.id, invoiceId: row.invoiceId, connectionId: row.connectionId, connectionLabel: row.connection.label, status: row.status, amountCents: row.amountCents,
      currency: row.currency, url: row.url, lastError: row.lastError, reviewReason: row.reviewReason, createdAt: row.createdAt,
      payment: row.onlinePayment
        ? { paymentId: row.onlinePayment.paymentId, number: row.onlinePayment.payment.number ?? "", grossCents: row.onlinePayment.grossCents, feeCents: row.onlinePayment.feeCents, netCents: row.onlinePayment.netCents, paidAt: row.onlinePayment.paidAt }
        : null,
    }));
  });
}

/** The active Stripe connections that can take a payment page: with a fee account. */
export async function listPaymentConnections(actor: CompanyContext) {
  return withCompany(actor, async (tx) => {
    await requireRole(tx, "sales.read");
    return tx.integrationConnection.findMany({
      where: { companyId: actor.companyId, provider: "STRIPE", status: "ACTIVE", feeAccountId: { not: null } },
      select: { id: true, label: true, sandbox: true },
      orderBy: [{ label: "asc" }, { id: "asc" }],
      take: 20,
    });
  });
}
