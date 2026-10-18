import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  getTrialBalance,
  initializeLedger,
  listAccounts,
  listFiscalYears,
  lockPeriod,
  postManualEntry,
  reopenPeriod,
  reverseEntry,
  type Actor,
} from "@/modules/ledger";
import { AppError } from "@/platform/errors";
import { enableTotp, owner, seedCompany, seedUser } from "./helpers";

/**
 * State-based test of the accounting engine (docs/Plan-de-tests.md, "Test à états"): random sequences of commands run
 * against an in-memory model AND the real services on the real database. After every command both must give the
 * same answer (success, or the same refusal code) and the same balances; the trial balance must balance and the
 * accounting equation must hold.
 */
let db: pg.Client;
beforeAll(async () => {
  db = await owner();
});
afterAll(async () => {
  await db.end();
});

const CODES = ["1000", "1010", "3000", "4000", "6050", "7000"] as const;
type Code = (typeof CODES)[number];

type ModelEntry = { id: number; realId: string; date: string; source: "MANUAL" | "REVERSAL"; reversedBy: number | null; lines: Map<Code, bigint> };
type Model = { next: bigint; entries: ModelEntry[]; locked: boolean[]; net: Map<Code, bigint> };
type Real = { actor: Actor; ids: Record<string, string>; year: string; periods: string[]; totp: Awaited<ReturnType<typeof enableTotp>>; step: number };

const date = (real: Real, month: number, day: number) => `${real.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const monthOf = (isoDate: string) => Number(isoDate.slice(5, 7));

async function outcome(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "ok";
  } catch (error) {
    if (error instanceof AppError) return error.key;
    throw error;
  }
}

async function compareWithModel(model: Model, real: Real): Promise<void> {
  const trial = await getTrialBalance(real.actor);
  expect(trial.balanced).toBe(true);
  expect(trial.equationHolds).toBe(true);
  const actual = new Map(trial.lines.map((line) => [line.code, line.debitCents - line.creditCents]));
  for (const code of CODES) expect(actual.get(code) ?? 0n, `balance of ${code}`).toBe(model.net.get(code) ?? 0n);
}

class PostCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly amount: bigint,
    readonly debit: Code,
    readonly credit: Code,
    readonly month: number,
    readonly day: number,
  ) {}
  check = () => true;
  async run(model: Model, real: Real) {
    const day = date(real, this.month, this.day);
    const locked = model.locked[this.month - 1] ?? false;
    let posted: { id: string; number: bigint } | null = null;
    const result = await outcome(async () => {
      posted = await postManualEntry(real.actor, {
        date: day,
        kind: "MANUAL",
        lines: [
          { accountId: real.ids[this.debit] ?? "", debitCents: this.amount, creditCents: 0n },
          { accountId: real.ids[this.credit] ?? "", debitCents: 0n, creditCents: this.amount },
        ],
      });
    });
    expect(result, this.toString()).toBe(locked ? "AL003" : "ok");
    if (!locked && posted) {
      expect((posted as { number: bigint }).number, "entry number").toBe(model.next);
      const lines = new Map<Code, bigint>();
      lines.set(this.debit, (lines.get(this.debit) ?? 0n) + this.amount);
      lines.set(this.credit, (lines.get(this.credit) ?? 0n) - this.amount);
      model.entries.push({ id: model.entries.length, realId: (posted as { id: string }).id, date: day, source: "MANUAL", reversedBy: null, lines });
      for (const [code, value] of lines) model.net.set(code, (model.net.get(code) ?? 0n) + value);
      model.next += 1n;
    }
    await compareWithModel(model, real);
  }
  toString = () => `post(${this.amount}, ${this.debit}->${this.credit}, ${this.month}/${this.day})`;
}

class ReverseCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly pick: number,
    readonly month: number,
    readonly day: number,
  ) {}
  check = (model: Model) => model.entries.length > 0;
  async run(model: Model, real: Real) {
    const target = model.entries[this.pick % model.entries.length];
    if (!target) return;
    const day = date(real, this.month, this.day);
    let reversed: { id: string; number: bigint } | null = null;
    const result = await outcome(async () => {
      reversed = await reverseEntry(real.actor, target.realId, { date: day });
    });
    let expected = "ok";
    if (target.source === "REVERSAL") expected = "AL008";
    else if (target.reversedBy !== null) expected = "ledger.alreadyReversed";
    else if (day < target.date) expected = "AL008";
    else if (model.locked[monthOf(day) - 1]) expected = "AL003";
    expect(result, `${this.toString()} on ${target.date}`).toBe(expected);
    if (expected === "ok" && reversed) {
      expect((reversed as { number: bigint }).number, "entry number").toBe(model.next);
      const mirror: ModelEntry = { id: model.entries.length, realId: (reversed as { id: string }).id, date: day, source: "REVERSAL", reversedBy: null, lines: new Map([...target.lines].map(([code, value]) => [code, -value])) };
      target.reversedBy = mirror.id;
      model.entries.push(mirror);
      for (const [code, value] of mirror.lines) model.net.set(code, (model.net.get(code) ?? 0n) + value);
      model.next += 1n;
    }
    await compareWithModel(model, real);
  }
  toString = () => `reverse(#${this.pick}, ${this.month}/${this.day})`;
}

class LockCommand implements fc.AsyncCommand<Model, Real> {
  constructor(readonly month: number) {}
  check = () => true;
  async run(model: Model, real: Real) {
    expect(await outcome(() => lockPeriod(real.actor, real.periods[this.month - 1] ?? ""))).toBe("ok");
    model.locked[this.month - 1] = true;
    await compareWithModel(model, real);
  }
  toString = () => `lock(${this.month})`;
}

class ReopenCommand implements fc.AsyncCommand<Model, Real> {
  constructor(readonly month: number) {}
  check = () => true;
  async run(model: Model, real: Real) {
    // a fresh code of the authenticator each time, as the owner would type it (the attempt counter is cleared: a run can reopen often)
    await db.query("DELETE FROM rate_limit");
    real.step += 1;
    const at = real.totp.enrolledAt + real.step * 30_000;
    expect(await outcome(() => reopenPeriod(real.actor, real.periods[this.month - 1] ?? "", "Réouverture de test (propriété P11)", { code: real.totp.code(at), now: new Date(at) }))).toBe("ok");
    model.locked[this.month - 1] = false;
    await compareWithModel(model, real);
  }
  toString = () => `reopen(${this.month})`;
}

const code = fc.constantFrom(...CODES);
// few months so that locked periods are hit often
const month = fc.integer({ min: 1, max: 4 });
const day = fc.integer({ min: 1, max: 28 });

async function freshWorld(): Promise<{ model: Model; real: Real }> {
  const tag = randomUUID().slice(0, 8);
  const email = `etat-${tag}@exemple.test`;
  const ownerId = await seedUser(db, { email });
  const companyId = await seedCompany(db, `Atelier état ${tag}`, [{ userId: ownerId, role: "OWNER" }]);
  // reopening a period needs two-factor authentication on the owner's account, and a code each time
  const totp = await enableTotp(ownerId, email);
  const actor = { userId: ownerId, companyId };
  await initializeLedger(actor);
  const accounts = await listAccounts(actor);
  const [year] = await listFiscalYears(actor);
  return {
    model: { next: 1n, entries: [], locked: Array.from({ length: 12 }, () => false), net: new Map() },
    real: { actor, ids: Object.fromEntries(accounts.map((account) => [account.code, account.id])), year: (year?.start ?? "").slice(0, 4), periods: (year?.periods ?? []).map((period) => period.id), totp, step: 0 },
  };
}

it("the services follow the model: same answers, same balances, trial balance at zero, whatever the sequence", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.commands(
        [
          fc.tuple(fc.bigInt({ min: 1n, max: 5_000_000n }), code, code, month, day).map(([amount, debit, credit, m, d]) => new PostCommand(amount, debit, credit, m, d)),
          fc.tuple(fc.nat(50), month, day).map(([pick, m, d]) => new ReverseCommand(pick, m, d)),
          month.map((m) => new LockCommand(m)),
          month.map((m) => new ReopenCommand(m)),
        ],
        { maxCommands: 25 },
      ),
      async (commands) => {
        const world = await freshWorld();
        await fc.asyncModelRun(() => world, commands);
        // numbering is gap-free: the entries the model knows are exactly 1..n
        const rows = await db.query("SELECT entry_number FROM journal_entry WHERE company_id = $1 ORDER BY entry_number", [world.real.actor.companyId]);
        expect(rows.rows.map((row) => BigInt(row.entry_number))).toEqual(Array.from({ length: world.model.entries.length }, (_, i) => BigInt(i + 1)));
      },
    ),
    { numRuns: 25 },
  );
}, 120_000);
