#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Dependency-free: release.sh must also work in a clean maintainer checkout without node_modules.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [version, source = resolve(root, "release-notes.json"), docs = resolve(root, "docs")] = process.argv.slice(2);
const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-(?:alpha|beta|rc)\.\d{1,6})?$/;
const categories = ["added", "improved", "fixed", "installation"];
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function check(condition, message) { if (!condition) throw new Error(message); }
// Code examples are not wiki navigation. Keep this check usable without npm dependencies.
function wikiLinks(markdown) {
  let fence = null;
  const prose = [];
  for (const line of markdown.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    prose.push(line);
  }
  return prose.join("\n").replace(/(`+)[\s\S]*?\1(?!`)/g, "").matchAll(/(?<!\\)\[\[([^\]]+)\]\]/g);
}
try {
  check(versionPattern.test(version ?? ""), "Invalid release version.");
  const catalog = JSON.parse(readFileSync(source, "utf8"));
  check(isObject(catalog) && Object.keys(catalog).length <= 500, "Invalid release-notes catalog.");
  check(Object.hasOwn(catalog, version), `Missing bilingual release notes for ${version}.`);
  const checkedGuides = new Set();
  for (const [key, entry] of Object.entries(catalog)) {
    check(versionPattern.test(key) && isObject(entry), "Invalid release-notes entry.");
    check(Object.keys(entry).length === 2 && Object.hasOwn(entry, "fr-CA") && Object.hasOwn(entry, "en"), `${key}: both fr-CA and en notes are required.`);
    for (const locale of ["fr-CA", "en"]) {
      const note = entry[locale];
      check(isObject(note) && text(note.title, 150), `${key}/${locale}: a short title is required.`);
      check(Object.keys(note).every(field => field === "title" || categories.includes(field)), `${key}/${locale}: unknown field.`);
      for (const category of categories) {
        const items = note[category];
        check(Array.isArray(items) && items.length <= 12, `${key}/${locale}/${category}: use at most 12 items.`);
        for (const item of items) {
          check(isObject(item) && text(item.text, 500) && Object.keys(item).every(field => ["text", "guide"].includes(field)), `${key}/${locale}/${category}: invalid item.`);
          if (Object.hasOwn(item, "guide")) {
            check(typeof item.guide === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(item.guide), `${key}/${locale}: invalid guide slug.`);
            check(existsSync(resolve(docs, `${item.guide}.md`)), `${key}/${locale}: guide does not exist: ${item.guide}.`);
            // Wiki label syntax is easy to reverse. Repository guides use plain [[Page]] links only.
            if (key === version && !checkedGuides.has(item.guide)) {
              checkedGuides.add(item.guide);
              for (const [, target] of wikiLinks(readFileSync(resolve(docs, `${item.guide}.md`), "utf8"))) {
                check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(target), `${key}/${locale}: use plain [[Page]] wiki links in ${item.guide}.`);
                check(existsSync(resolve(docs, `${target}.md`)), `${key}/${locale}: wiki target does not exist: ${target}.`);
              }
            }
          }
        }
      }
      check(note.added.length + note.improved.length + note.fixed.length > 0, `${key}/${locale}: describe at least one change.`);
      check(note.installation.length > 0, `${key}/${locale}: explain installation requirements, including when none apply.`);
    }
  }
  console.log(`Bilingual release notes and guide links verified for ${version}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid release notes.");
  process.exitCode = 1;
}
