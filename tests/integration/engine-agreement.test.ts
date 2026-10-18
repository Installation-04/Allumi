import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkEntry, MAX_LINE_CENTS, reversalLines, type EntryLine } from "@/modules/ledger";
import { owner } from "./helpers";
import { appClient, asOwnerA, entry, inContext, line, seedWorld, sqlstate, W } from "./world";

/**
 * The two safety nets must refuse the same entries (docs/Plan-de-tests.md, P2): the domain check that runs before
 * anything is sent, and the constraints and triggers of the database, tried here as the restricted role.
 */
let db: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  db = await owner();
  await seedWorld(db);
  app = await appClient();
});
afterAll(async () => {
  await app.end();
  await db.end();
});

const ACCOUNTS = [W.bank, W.capital, W.sales, W.expenses] as const;
const ENTRY = "00000000-0000-7000-8000-00000000f001";

const amount = fc.oneof(
  { weight: 6, arbitrary: fc.bigInt({ min: 1n, max: 1_000_000n }) },
  { weight: 1, arbitrary: fc.constant(0n) },
  { weight: 1, arbitrary: fc.bigInt({ min: -1000n, max: -1n }) },
  { weight: 1, arbitrary: fc.constantFrom(MAX_LINE_CENTS, MAX_LINE_CENTS + 1n) },
);
const lineArb = fc.record({ account: fc.constantFrom(...ACCOUNTS), debit: amount, credit: amount });

/** Mostly well-formed lines (one side only), with a share of broken ones. */
const sidedLine = fc.record({ account: fc.constantFrom(...ACCOUNTS), debit: fc.bigInt({ min: 1n, max: 1_000_000n }), onDebit: fc.boolean() });

async function tryPost(lines: EntryLine[]): Promise<string | null> {
  return sqlstate(() =>
    inContext(app, asOwnerA, async () => {
      await entry(app, { id: ENTRY, no: 900, date: "2026-02-10" });
      for (const [index, l] of lines.entries()) {
        await app.query("SAVEPOINT l");
        await line(app, ENTRY, index + 1, l.accountId, { debit: Number(l.debitCents), credit: Number(l.creditCents) });
        await app.query("RELEASE SAVEPOINT l");
      }
    }),
  );
}

describe("domain and database agree", () => {
  it("P2: arbitrary lines, valid or not, are refused by the domain exactly when the database refuses them", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(lineArb, { maxLength: 6 }), async (raw) => {
        // amounts above 2^53 would lose precision as JS numbers in the test helper: keep the helper honest
        const lines = raw.map((l) => ({ accountId: l.account, debitCents: l.debit, creditCents: l.credit }));
        if (lines.some((l) => l.debitCents > 2n ** 50n || l.creditCents > 2n ** 50n)) {
          expect(checkEntry(lines).length).toBeGreaterThan(0); // the ceiling is a domain-and-CHECK rule
          return;
        }
        const state = await tryPost(lines);
        const problems = checkEntry(lines);
        if (problems.length === 0) expect(state).toBeNull();
        else expect(["AL001", "AL002", "23514"]).toContain(state);
      }),
      { numRuns: 60 },
    );
  });

  it("P2: well-formed entries, balanced or off by a few cents, follow the same rule", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(sidedLine, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 2 }), async (raw, skew) => {
        const lines: EntryLine[] = raw.map((l) => ({ accountId: l.account, debitCents: l.onDebit ? l.debit : 0n, creditCents: l.onDebit ? 0n : l.debit }));
        const debit = lines.reduce((sum, l) => sum + l.debitCents, 0n);
        const credit = lines.reduce((sum, l) => sum + l.creditCents, 0n);
        // add one balancing line, then break the balance by `skew` cents
        const gap = debit - credit;
        const balancing: EntryLine = gap >= 0n ? { accountId: W.capital, debitCents: 0n, creditCents: gap + BigInt(skew) } : { accountId: W.bank, debitCents: -gap + BigInt(skew), creditCents: 0n };
        const all = [...lines, ...(balancing.debitCents + balancing.creditCents > 0n ? [balancing] : [])];
        const state = await tryPost(all);
        const problems = checkEntry(all);
        expect(problems.length === 0).toBe(state === null);
        if (state !== null) expect(["AL001", "AL002", "23514"]).toContain(state);
      }),
      { numRuns: 60 },
    );
  });

  it("P3 at the database: the mirror of any valid entry is accepted as its reversal, anything else is refused (AL008)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(sidedLine, { minLength: 1, maxLength: 5 }), fc.boolean(), async (raw, tamper) => {
        const original: EntryLine[] = raw.map((l) => ({ accountId: l.account, debitCents: l.onDebit ? l.debit : 0n, creditCents: l.onDebit ? 0n : l.debit }));
        const gap = original.reduce((sum, l) => sum + l.debitCents - l.creditCents, 0n);
        if (gap !== 0n) original.push(gap > 0n ? { accountId: W.capital, debitCents: 0n, creditCents: gap } : { accountId: W.bank, debitCents: -gap, creditCents: 0n });
        const mirror = reversalLines(original);
        const lines = tamper ? mirror.map((l, i) => (i === 0 ? { ...l, accountId: l.accountId === W.expenses ? W.sales : W.expenses } : l)) : mirror;
        const state = await sqlstate(() =>
          inContext(app, asOwnerA, async () => {
            await entry(app, { id: ENTRY, no: 901, date: "2026-02-10" });
            for (const [i, l] of original.entries()) await line(app, ENTRY, i + 1, l.accountId, { debit: Number(l.debitCents), credit: Number(l.creditCents) });
            const reversal = "00000000-0000-7000-8000-00000000f002";
            await entry(app, { id: reversal, no: 902, date: "2026-02-11", source: "REVERSAL", reverses: ENTRY });
            for (const [i, l] of lines.entries()) await line(app, reversal, i + 1, l.accountId, { debit: Number(l.debitCents), credit: Number(l.creditCents) });
          }),
        );
        // the rule: the reversal must be exactly the mirror, as a multiset of (account, debit, credit)
        const key = (l: EntryLine) => `${l.accountId}:${l.debitCents}:${l.creditCents}`;
        const sameMirror = JSON.stringify(lines.map(key).sort()) === JSON.stringify(mirror.map(key).sort());
        if (sameMirror) expect(state).toBeNull();
        else expect(state).toBe("AL008");
      }),
      { numRuns: 40 },
    );
  });

  it("matches the example refusals one by one", async () => {
    expect(await tryPost([])).toBe("AL002");
    expect(await tryPost([{ accountId: W.bank, debitCents: 100n, creditCents: 0n }])).toBe("AL002");
    expect(await tryPost([{ accountId: W.bank, debitCents: 100n, creditCents: 0n }, { accountId: W.capital, debitCents: 0n, creditCents: 99n }])).toBe("AL001");
    expect(await tryPost([{ accountId: W.bank, debitCents: 100n, creditCents: 100n }, { accountId: W.capital, debitCents: 0n, creditCents: 0n }])).toBe("23514");
    expect(await tryPost([{ accountId: W.bank, debitCents: 100n, creditCents: 0n }, { accountId: W.capital, debitCents: 0n, creditCents: 100n }])).toBeNull();
  });
});
