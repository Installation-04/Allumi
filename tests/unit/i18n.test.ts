import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr-CA.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") acc[`${prefix}${key}`] = value;
    else Object.assign(acc, flatten(value, `${prefix}${key}.`));
    return acc;
  }, {});
}

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]).sort();

describe("message catalogs", () => {
  const french = flatten(fr);
  const english = flatten(en);

  it("have exactly the same keys", () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(french).sort());
  });

  it("have no empty message", () => {
    for (const [key, message] of [...Object.entries(french), ...Object.entries(english)]) expect(message.trim(), key).not.toBe("");
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(french)) expect(placeholders(english[key] ?? ""), key).toEqual(placeholders(french[key] ?? ""));
  });

  it("have a message for every database rule code", () => {
    for (let n = 1; n <= 11; n++) expect(french[`errors.AL${String(n).padStart(3, "0")}`]).toBeTruthy();
  });
});
