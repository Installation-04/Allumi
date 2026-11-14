import { expect, it } from "vitest";
import { estimateTransitionAllowed } from "@/modules/sales/domain/estimate";
it("only accepts or delivers unexpired quotes, and never changes terminal states", () => {
  expect(estimateTransitionAllowed("DRAFT", "SENT", "2026-11-14", "2026-11-14")).toBe(true);
  expect(estimateTransitionAllowed("DRAFT", "SENT", "2026-11-13", "2026-11-14")).toBe(false);
  expect(estimateTransitionAllowed("SENT", "ACCEPTED", "2026-11-13", "2026-11-14")).toBe(false);
  expect(estimateTransitionAllowed("SENT", "DECLINED", "2026-11-13", "2026-11-14")).toBe(true);
  for (const state of ["DECLINED", "CANCELLED", "CONVERTED"]) for (const next of ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CANCELLED"]) expect(estimateTransitionAllowed(state, next, "2999-01-01", "2026-11-14")).toBe(false);
});
