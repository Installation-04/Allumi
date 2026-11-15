import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { compareVersions } from "@/modules/updates/domain/releases";
import { earlierReleaseNotes, installedReleaseNotes } from "@/modules/updates/domain/notes";

const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), "allumi-release-notes-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const catalog = () => JSON.parse(readFileSync("release-notes.json", "utf8"));
const checker = resolve("scripts/check-release-notes.mjs");
function check(value: unknown, version = "0.4.0-alpha.62") {
 const root = fixture(), source = join(root, "notes.json");writeFileSync(source, JSON.stringify(value));
 return spawnSync(process.execPath, [checker, version, source, resolve("docs")], { encoding: "utf8" });
}

it("looks up the exact installed version in the chosen language without substituting another release", () => {
 expect(installedReleaseNotes("v0.4.0-alpha.61", "en")?.title).toContain("Supplier credits");
 expect(installedReleaseNotes("0.4.0-alpha.61", "fr-CA")?.title).toContain("Crédits fournisseurs");
 expect(installedReleaseNotes("0.4.0-alpha.61", "unknown")).toEqual(installedReleaseNotes("0.4.0-alpha.61", "fr-CA"));
 for (const version of ["dev", "0.4.0-alpha.999", "__proto__", "constructor", "v0.4.0-alpha.61/path", "0.4.0-alpha.61\n"]) expect(installedReleaseNotes(version, "en")).toBeNull();
 expect(earlierReleaseNotes("0.4.0-alpha.61", "en")).toEqual([]);
 expect(earlierReleaseNotes("0.4.0-alpha.62", "en").map(entry => entry.version)).toEqual(["0.4.0-alpha.61"]);
 expect(earlierReleaseNotes("dev", "en")).toEqual([]);
 expect(earlierReleaseNotes("0.4.0", "en").length).toBeLessThanOrEqual(5);
 const stableHistory=earlierReleaseNotes("0.4.0","en");
 for(let i=0;i<stableHistory.length;i++){expect(compareVersions(stableHistory[i]!.version,"0.4.0")).toBeLessThan(0);if(i>0)expect(compareVersions(stableHistory[i-1]!.version,stableHistory[i]!.version)).toBeGreaterThan(0);}
});

it("validates bilingual notes and every local guide with no npm dependency", () => {
 const result=check(catalog());expect(result.status,result.stderr).toBe(0);
 expect(check(catalog(), "999999.999999.999999").status).toBe(1);
 const notes=catalog();delete notes["0.4.0-alpha.62"].en;expect(check(notes).status).toBe(1);
});

it("rejects empty or unbounded notes, malformed catalogs, unsafe guide slugs and missing guides", () => {
 const mutate=(fn:(note:Record<string,unknown>)=>void)=>{const notes=catalog();fn(notes["0.4.0-alpha.62"].en);expect(check(notes).status).toBe(1);};
 mutate(note=>{note.title=" ";});mutate(note=>{note.added=[];note.improved=[];note.fixed=[];});mutate(note=>{note.installation=[];});
 mutate(note=>{note.added=Array.from({length:13},()=>({text:"Change"}));});mutate(note=>{note.added=[{text:"x".repeat(501)}];});
 for(const guide of ["../README","https://example.test","Missing-guide-xyz", "Mise-a-jour#fragment"])mutate(note=>{note.added=[{text:"Change",guide}];});
 mutate(note=>{note.added=[{text:"Change\u0000"}];});mutate(note=>{note.html="<script>bad()</script>";});
 for(const value of [null,[],{"__invalid-version":catalog()["0.4.0-alpha.62"]}])expect(check(value).status).toBe(1);
});

it("blocks the official release before changing files or creating commits/tags when notes are missing", () => {
 const root=fixture();mkdirSync(join(root,"scripts"));
 cpSync("scripts/release.sh",join(root,"scripts/release.sh"));cpSync(checker,join(root,"scripts/check-release-notes.mjs"));
 writeFileSync(join(root,"release-notes.json"),"{}\n");const changelog="## [Non publié]\n\n- A change\n";writeFileSync(join(root,"CHANGELOG.md"),changelog);
 const git=(...args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git("init","-b","main");git("config","user.name","Fixture");git("config","user.email","fixture@example.test");git("add",".");git("commit","-m","fixture");const head=git("rev-parse","HEAD");
 const result=spawnSync("bash",["scripts/release.sh","0.4.0-alpha.62"],{cwd:root,encoding:"utf8"});
 expect(result.status).toBe(1);expect(result.stderr,JSON.stringify(result)).toContain("Missing bilingual release notes");
 expect(readFileSync(join(root,"CHANGELOG.md"),"utf8")).toBe(changelog);expect(git("rev-parse","HEAD")).toBe(head);expect(git("tag","--list")).toBe("");expect(git("status","--porcelain")).toBe("");
});
