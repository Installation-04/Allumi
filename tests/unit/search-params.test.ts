import { describe, expect, it } from "vitest";
import { searchText } from "@/app/_lib/search-params";

describe("searchText (query-string values)", () => {
  it("reads a plain value and trims it", () => {
    expect(searchText("  journal_entry ")).toBe("journal_entry");
  });

  it("reads the first of a repeated parameter instead of passing the array on", () => {
    expect(searchText(["a", "b"])).toBe("a");
    expect(searchText([])).toBeUndefined();
  });

  it("drops control characters (PostgreSQL refuses NUL) and empty values", () => {
    expect(searchText("ab\u0000cd")).toBe("abcd");
    expect(searchText("\u0000\u001f")).toBeUndefined();
    expect(searchText("")).toBeUndefined();
    expect(searchText(undefined)).toBeUndefined();
  });

  it("caps the length", () => {
    expect(searchText("x".repeat(500))).toHaveLength(200);
    expect(searchText("123456789012345678901", 18)).toHaveLength(18);
  });
});
