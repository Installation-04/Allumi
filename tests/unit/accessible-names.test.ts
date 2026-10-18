import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr-CA.json";

/**
 * WCAG 2.5.3 (label in name): a button whose accessible name (aria-label) says more than its visible text must still
 * contain that text, or a person who speaks the visible label to a voice-control tool gets no match.
 */
const PAIRS: [namespace: "fiscal" | "accounts", visible: string, accessible: string][] = [
  ["fiscal", "lock", "lockNamed"],
  ["fiscal", "reopen", "reopenNamed"],
  ["fiscal", "close", "closeNamed"],
  ["fiscal", "reopenYear", "reopenYearNamed"],
  ["accounts", "delete", "deleteNamed"],
  ["accounts", "deactivate", "deactivateNamed"],
  ["accounts", "activate", "activateNamed"],
  ["accounts", "edit", "editNamed"],
];

describe("accessible names of buttons", () => {
  for (const [locale, messages] of [["fr-CA", fr], ["en", en]] as const) {
    it.each(PAIRS)(`${locale}: %s.%s is contained in %s`, (namespace, visible, accessible) => {
      const group = messages[namespace] as Record<string, string>;
      expect(group[accessible]?.toLowerCase(), `${namespace}.${accessible}`).toContain(group[visible]?.toLowerCase());
    });
  }
});
