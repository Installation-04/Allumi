import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path);
const text = (path: string) => readFileSync(path, "utf8");

/** Width and height from the IHDR chunk of a PNG. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Directory of an .ico file: each entry's declared size and the PNG it points to. */
function icoEntries(file: Buffer) {
  expect(file.readUInt16LE(0)).toBe(0);
  expect(file.readUInt16LE(2)).toBe(1);
  return Array.from({ length: file.readUInt16LE(4) }, (_, index) => {
    const at = 6 + 16 * index;
    const declared = file.readUInt8(at) || 256;
    const length = file.readUInt32LE(at + 8);
    const offset = file.readUInt32LE(at + 12);
    return { declared, png: file.subarray(offset, offset + length) };
  });
}

const PNGS: [string, number][] = [
  ["public/icons/allumi-180.png", 180],
  ["public/icons/allumi-192.png", 192],
  ["public/icons/allumi-512.png", 512],
  ["public/icons/allumi-maskable-512.png", 512],
];

describe("logo files", () => {
  it.each(PNGS)("%s is a %i px square PNG", (path, size) => {
    expect(pngSize(read(path))).toEqual({ width: size, height: size });
  });

  it.each([
    ["public/favicon.ico", [16, 32, 48]],
    ["desktop/icon.ico", [16, 24, 32, 48, 64, 128, 256]],
  ] as const)("%s holds every size, each really that size", (path, sizes) => {
    const entries = icoEntries(read(path));
    expect(entries.map((entry) => entry.declared)).toEqual([...sizes]);
    for (const { declared, png } of entries) expect(pngSize(png)).toEqual({ width: declared, height: declared });
  });

  it("the Windows installer icon has the 256 px image electron-builder requires", () => {
    expect(icoEntries(read("desktop/icon.ico")).some((entry) => entry.declared === 256)).toBe(true);
  });

  it("the master SVG is a self-contained drawing: no script, no handler, no external reference", () => {
    const svg = text("public/icons/allumi.svg");
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain("<title>Allumi</title>");
    expect(svg).not.toMatch(/<script|<foreignObject|<image|<use|\son[a-z]+=|xlink:href|javascript:/i);
    expect(svg.replaceAll('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//);
  });

  it("every icon the app references exists in public/", () => {
    const referenced = ["src/app/manifest.ts", "src/app/layout.tsx"].flatMap((file) => text(file).match(/(?<=")\/(?:icons\/[\w.-]+|favicon\.ico)(?=")/g) ?? []);
    expect(referenced).toEqual(expect.arrayContaining(["/icons/allumi.svg", "/favicon.ico", "/icons/allumi-180.png", "/icons/allumi-maskable-512.png"]));
    for (const path of new Set(referenced)) expect(existsSync(`public${path}`), path).toBe(true);
  });

  it("the web manifest declares the sizes of the files it points to, with a maskable icon", () => {
    const manifest = text("src/app/manifest.ts");
    for (const [path, size] of PNGS.filter(([file]) => file.includes("192") || file.includes("512"))) {
      const name = path.replace("public", "");
      expect(manifest, name).toMatch(new RegExp(`src: "${name}", sizes: "${size}x${size}"`));
    }
    expect(manifest).toMatch(/allumi-maskable-512\.png[^}]*purpose: "maskable"/);
  });

  it("the logo shown in the header and sidebar is the same drawing as the icon files", () => {
    const shapes = (source: string) => [...source.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]);
    expect(shapes(text("src/app/_components/logo.tsx"))).toEqual(shapes(text("public/icons/allumi.svg")));
    expect(shapes(text("scripts/build-icons.mjs"))).toEqual(shapes(text("public/icons/allumi.svg")));
  });

  it("the inline logo is decorative and never a gradient (a hidden SVG cannot paint another one's gradient)", () => {
    const logo = text("src/app/_components/logo.tsx");
    expect(logo).toContain('aria-hidden="true"');
    expect(logo).not.toMatch(/<linearGradient|url\(#/);
  });
});
