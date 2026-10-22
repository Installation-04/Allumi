import { expect, it } from "vitest";
import { draftSchema } from "@/modules/sales/client";
const id = "00000000-0000-7000-8000-000000000001";
const line = { description: "Service", quantity: "1,2345", unitPrice: "125,123456", accountId: id, taxCodeId: id };
const input = { contactId: id, issueDate: "2026-06-01", dueDate: "2026-06-01", lines: [line] };
it("normalizes exact inputs and rejects precision loss, invalid dates and empty lines", () => {
  expect(draftSchema.parse(input).lines[0]).toMatchObject({ quantity: "1.2345", unitPrice: "125.123456" });
  for (const value of ["0", "-1", "0.00001", "1e3", "1,000.00"]) expect(draftSchema.safeParse({ ...input, lines: [{ ...line, quantity: value }] }).success).toBe(false);
  expect(draftSchema.safeParse({ ...input, issueDate: "2026-02-30" }).success).toBe(false);
  expect(draftSchema.safeParse({ ...input, lines: [] }).success).toBe(false);
  expect(draftSchema.safeParse({ ...input, lines: Array.from({ length: 51 }, () => line) }).success).toBe(false);
});
