import { describe, expect, it } from "vitest";
import { ACTIONS, can, type Role } from "@/modules/companies";

describe("role matrix", () => {
  it("lets everybody read the ledger, and only the owner and the accountant write", () => {
    for (const role of ["OWNER", "ACCOUNTANT", "READ_ONLY"] as const) { expect(can(role, "ledger.read")).toBe(true); expect(can(role, "contact.read")).toBe(true); expect(can(role, "bank.read")).toBe(true); }
    for (const action of ["contact.manage", "bank.manage", "entry.post", "entry.reverse", "account.manage", "period.lock", "fiscalYear.create"] as const) {
      expect(can("OWNER", action), action).toBe(true);
      expect(can("ACCOUNTANT", action), action).toBe(true);
      expect(can("READ_ONLY", action), action).toBe(false);
    }
  });

  it("keeps privileged actions for administrators", () => {
    for (const action of ["members.manage", "company.manage", "period.reopen", "fiscalYear.reopen", "fiscalYear.close", "contact.anonymize", "integration.manage"] as const) {
      expect(can("OWNER", action), action).toBe(true);
      expect(can("ACCOUNTANT", action), action).toBe(false);
      expect(can("READ_ONLY", action), action).toBe(false);
    }
  });

  it("hides the audit trail from read-only members, as the database does", () => {
    expect(can("OWNER", "audit.read")).toBe(true);
    expect(can("ACCOUNTANT", "audit.read")).toBe(true);
    expect(can("READ_ONLY", "audit.read")).toBe(false);
  });

  it("is monotonic: a read-only member never has a right the accountant lacks, nor the accountant one the owner lacks", () => {
    const rank: Role[] = ["READ_ONLY", "ACCOUNTANT", "OWNER"];
    for (const action of ACTIONS) {
      for (let i = 0; i < rank.length - 1; i++) {
        const lower = rank[i];
        const higher = rank[i + 1];
        if (lower && higher && can(lower, action)) expect(can(higher, action), `${action} ${lower}->${higher}`).toBe(true);
      }
    }
  });
});

it("honours modular permissions without elevating privileged actions or viewer writes", () => {
  expect(can({role:"USER",moduleAccess:{accounting:"write"}},"entry.post")).toBe(true);
  expect(can({role:"ACCOUNTANT",moduleAccess:{contacts:"none"}},"contact.read")).toBe(false);
  expect(can({role:"READ_ONLY",moduleAccess:{contacts:"write"}},"contact.manage")).toBe(false);
  expect(can({role:"USER",moduleAccess:{accounting:"write"}},"members.manage")).toBe(false);
  expect(can({role:"USER",moduleAccess:{accounting:"write"}},"integration.manage")).toBe(false);
});
