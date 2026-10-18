import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A value exported from a "use client" file is a client reference on the server: interpolated into a class name it
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
