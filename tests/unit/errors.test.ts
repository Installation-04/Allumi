import { describe, expect, it } from "vitest";
import { databaseRuleOf } from "@/platform/errors";

describe("database rule detection", () => {
  it("finds an Allumi SQLSTATE in the places Prisma and the driver put it", () => {
    expect(databaseRuleOf({ code: "AL003" })).toBe("AL003");
    expect(databaseRuleOf({ meta: { code: "AL001" } })).toBe("AL001");
    expect(databaseRuleOf({ meta: { driverAdapterError: { cause: { originalCode: "AL008" } } } })).toBe("AL008");
    expect(databaseRuleOf(new Error("Raw query failed. Code: `AL007`. Message: allocation exceeds"))).toBe("AL007");
  });

  it("ignores other errors", () => {
    expect(databaseRuleOf(new Error("boom"))).toBeNull();
    expect(databaseRuleOf({ code: "23505" })).toBeNull();
    expect(databaseRuleOf({ code: "AL999" })).toBeNull();
    expect(databaseRuleOf(null)).toBeNull();
    expect(databaseRuleOf("AL001")).toBeNull();
  });
});
