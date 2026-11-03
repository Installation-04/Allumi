import { expect, it } from "vitest";
import {
  depositSchema,
  depositLines,
  depositVoidSchema,
  MAX_DEPOSIT_CENTS,
} from "./deposit";
const id = "00000000-0000-7000-8000-00000000a100";
const input = {
  paymentIds: [id],
  accountId: "00000000-0000-7000-8000-00000000a105",
  date: "2026-01-10",
  expectedTotalCents: "12345",
};
it("requires distinct whole receipts and an exact positive bounded total", () => {
  expect(depositSchema.parse(input).expectedTotalCents).toBe(12345n);
  for (const changes of [
    { paymentIds: [] },
    { paymentIds: [id, id.toUpperCase()] },
    { paymentIds: Array(101).fill(id) },
    { expectedTotalCents: "1.23" },
    { expectedTotalCents: "0" },
    { expectedTotalCents: String(MAX_DEPOSIT_CENTS + 1n) },
    { date: "2026-02-30" },
  ])
    expect(depositSchema.safeParse({ ...input, ...changes }).success).toBe(
      false,
    );
});
it("moves the same exact cents from undeposited funds to the bank", () => {
  expect(depositLines("bank", "undeposited", 99999999999999n)).toEqual([
    { accountId: "bank", debitCents: 99999999999999n, creditCents: 0n },
    { accountId: "undeposited", debitCents: 0n, creditCents: 99999999999999n },
  ]);
});
it("requires a real void date and a reason", () => {
  expect(
    depositVoidSchema.safeParse({ date: "2026-02-30", reason: "x" }).success,
  ).toBe(false);
  expect(
    depositVoidSchema.safeParse({ date: "2026-01-10", reason: " " }).success,
  ).toBe(false);
});
