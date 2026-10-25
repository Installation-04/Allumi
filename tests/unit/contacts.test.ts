import { describe, expect, it } from "vitest";
import { ANONYMIZATION_REASONS, ANONYMIZED_NAME, PERSONAL_COLUMNS, RETAINED_COLUMNS, anonymizeSchema, contactSchema } from "@/modules/contacts";

describe("contact validation", () => {
  const valid = { kind: "CUSTOMER", displayName: " Atelier ", country: " ca ", email: " " };
  it("normalizes optional fields and country", () => {
    expect(contactSchema.parse(valid)).toMatchObject({ displayName: "Atelier", country: "CA", email: null, paymentTermsDays: 30 });
  });
  it.each([{ displayName: " " }, { email: "invalid" }, { paymentTermsDays: -1 }, { paymentTermsDays: 366 }, { paymentTermsDays: 1.5 }, { country: "CAN" }, { kind: "NONE" }, { locale: "en_CA" }])("rejects invalid values %j", (value) => {
    expect(contactSchema.safeParse({ ...valid, ...value }).success).toBe(false);
  });
});

describe("contact anonymization rules", () => {
  it("takes a reason from a fixed list and an explicit confirmation, never free text", () => {
    for (const reason of ANONYMIZATION_REASONS) expect(anonymizeSchema.parse({ reason, confirm: "yes" })).toEqual({ reason, confirm: "yes" });
    for (const value of [{}, { reason: "SUBJECT_REQUEST" }, { confirm: "yes" }, { reason: "SUBJECT_REQUEST", confirm: "on" }, { reason: "SUBJECT_REQUEST", confirm: true }, { reason: "Marie l'a demandé", confirm: "yes" }, { reason: "", confirm: "yes" }]) {
      expect(anonymizeSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("keeps the personal and the retained columns apart, and never touches an accounting key", () => {
    expect(PERSONAL_COLUMNS.filter((name) => (RETAINED_COLUMNS as readonly string[]).includes(name))).toEqual([]);
    // the database refuses to redact these (audit_redact); the list must not even ask
    const accounting = ["id", "company_id", "debit_cents", "credit_cents", "amount_cents", "total_cents", "subtotal_cents", "tax_total_cents", "status", "account_id", "entry_date"];
    expect(PERSONAL_COLUMNS.filter((name) => accounting.includes(name))).toEqual([]);
    // what identifies a person: names, contact details, address, free text, registration numbers
    for (const name of ["display_name", "legal_name", "email", "phone", "address_line1", "postal_code", "notes", "gst_number", "qst_number"]) expect(PERSONAL_COLUMNS).toContain(name);
    expect(ANONYMIZED_NAME).toBe("Contact anonymisé");
  });
});
