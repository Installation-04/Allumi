import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two kinds of module have a boundary that the compiler only checks at build time:
 * - a "use server" file may only export async functions (Next refuses to build a page that imports anything else);
 * - a value exported from a "use client" file is a client reference on the server: interpolated into a class name it
 * prints the reference instead of the string (the tables lost their borders that way). Only components and hooks
 * (functions) may be exported from a client module; constants go to a plain module.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("server action files", () => {
  const serverFiles = sourceFiles("src").filter((file) => /^\s*(["'])use server\1/.test(readFileSync(file, "utf8").slice(0, 200)));

  it("finds the action files of the application", () => {
    expect(serverFiles.length).toBeGreaterThan(3);
  });

  it.each(serverFiles)("%s exports only async functions and types", (file) => {
    const source = readFileSync(file, "utf8");
    const exported = [...source.matchAll(/^export\s+(?:const|let|var|class|enum)\s+([A-Za-z0-9_$]+)/gm)].map(([, name]) => name);
    const syncFunctions = [...source.matchAll(/^export\s+function\s+([A-Za-z0-9_$]+)/gm)].map(([, name]) => name);
    expect([...exported, ...syncFunctions]).toEqual([]);
  });
});

describe("client modules", () => {
  const clientFiles = sourceFiles("src").filter((file) => /^\s*(["'])use client\1/.test(readFileSync(file, "utf8").slice(0, 200)));

  it("finds the client modules of the application", () => {
    expect(clientFiles.length).toBeGreaterThan(3);
  });

  it.each(clientFiles)("%s exports only functions and types", (file) => {
    const source = readFileSync(file, "utf8");
    const constants = [...source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(.*)$/gm)]
      // a function or arrow function is a component or a hook: fine
      .filter(([, , value]) => !/^(?:async\s+)?(?:function\b|\(|[A-Za-z0-9_$]+\s*=>)/.test(value ?? ""))
      .map(([, name]) => name);
    expect(constants).toEqual([]);
  });
});
