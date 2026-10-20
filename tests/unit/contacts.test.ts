import { describe, expect, it } from "vitest";
import { contactSchema } from "@/modules/contacts";

describe("contact validation", () => {
  const valid = { kind: "CUSTOMER", displayName: " Atelier ", country: " ca ", email: " " };
  it("normalizes optional fields and country", () => {
    expect(contactSchema.parse(valid)).toMatchObject({ displayName: "Atelier", country: "CA", email: null, paymentTermsDays: 30 });
  });
  it.each([{ displayName: " " }, { email: "invalid" }, { paymentTermsDays: -1 }, { paymentTermsDays: 366 }, { paymentTermsDays: 1.5 }, { country: "CAN" }, { kind: "NONE" }, { locale: "en_CA" }])("rejects invalid values %j", (value) => {
    expect(contactSchema.safeParse({ ...valid, ...value }).success).toBe(false);
  });
});
