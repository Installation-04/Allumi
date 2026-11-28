import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { smtpReceiver } from "../support/smtp";
import { mkdirSync, readFileSync } from "node:fs";
import * as updateFiles from "node:fs/promises";
import { join } from "node:path";
import { devices, expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import pg from "pg";
import { e2eUrls } from "./db";

const relay=smtpReceiver();
test.beforeAll(async()=>{await relay.listen(Number(process.env.E2E_PORT??3100)+1);});
test.afterAll(async()=>{
 await relay.close();
 if(process.env.E2E_UPDATE_DIR)await updateFiles.rm(process.env.E2E_UPDATE_DIR,{recursive:true,force:true});
});

const VERSION = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const RELEASE_NOTES = JSON.parse(readFileSync("release-notes.json", "utf8")) as Record<string, Record<"fr-CA" | "en", Record<"added" | "improved" | "fixed" | "installation", { text: string }[]>>>;

const EMAIL = "admin@exemple.test";
const PASSWORD = "une phrase de passe très longue 2026";
// The administration scenario follows setup and reuses its authenticated browser cookies only.
test.describe.configure({ mode: "serial" });
let updateCookies: Awaited<ReturnType<BrowserContext["cookies"]>>;

/** Optional wiki references from the isolated, fictional browser-test company only. */
async function captureReference(page: Page, name: string, mobileHeading?: string | Locator, fullPage?: boolean, focusAll = false, contentOnly = false) {
  if (process.env.ALLUMI_SCREENSHOTS !== "1") return;
  // One prefix, or several separated by commas.
  if (process.env.ALLUMI_SCREENSHOT_PREFIX && !process.env.ALLUMI_SCREENSHOT_PREFIX.split(",").some((prefix) => name.startsWith(prefix))) return;
  mkdirSync("docs/images", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (mobileHeading && (process.env.E2E_MOBILE === "1" || focusAll)) {
    const heading = typeof mobileHeading === "string" ? page.getByRole("heading", { name: mobileHeading, exact: true }) : mobileHeading;
    await expect(heading, `reference ${name}: ${mobileHeading}`).toBeVisible();
    await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
  }
  const options = { scale: "css" as const, path: `docs/images/${name}-${process.env.E2E_MOBILE === "1" ? "mobile" : "desktop"}.png`, animations: "disabled" as const };
  if (contentOnly && mobileHeading && typeof mobileHeading !== "string") await mobileHeading.locator("..").screenshot(options);
  else await page.screenshot({ ...options, fullPage: fullPage ?? process.env.E2E_MOBILE !== "1" });
}

/** The recovery codes list, in either language; the page also lists the signed-in devices. */
const recoveryCodeItems = (page: Page) => page.getByRole("list", { name: /^(Codes de récupération|Recovery codes)$/ }).getByRole("listitem");

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}


/** Everything the browser refuses because of the Content-Security-Policy, across every context the journey opens. */
const cspViolations: string[] = [];
function watchCsp(context: BrowserContext): BrowserContext {
  context.on("console", (message) => {
    if (/content security policy|refused to (?:execute|load|apply|connect|frame)/i.test(message.text())) cspViolations.push(`${message.location().url || "(page)"} — ${message.text()}`);
  });
  return context;
}
const newWatchedContext = async (browser: Browser) => watchCsp(await browser.newContext());

/** Strict script policy, checked on the real response: fresh nonce, no unsafe-inline, every script stamped with it. */
async function expectNonceCsp(page: Page, path: string) {
  const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];
  const [first, second] = [await page.request.get(path), await page.request.get(path)];
  const policy = first.headers()["content-security-policy"] ?? "";
  const nonce = nonceOf(policy);
  expect(nonce, "nonce in the policy").toBeTruthy();
  expect(nonceOf(second.headers()["content-security-policy"] ?? ""), "a new nonce for every response").not.toBe(nonce);
  const scriptSrc = policy.split(";").map((directive) => directive.trim()).find((directive) => directive.startsWith("script-src")) ?? "";
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/);
  // Allumi is served over plain HTTP: this directive would make the browser ask for everything over https.
  expect(policy).not.toContain("upgrade-insecure-requests");
  expect(policy).toContain("frame-ancestors 'none'");
  const html = await first.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag, "every script carries the response's nonce").toContain(`nonce="${nonce}"`);
  expect(html).not.toMatch(/\son[a-z]+="/);
}

test("setup, sign-in, two-factor enrollment and sign-in with a code", async ({ page, browser }) => {
  // This complete journey covers setup, MFA, accounting, both locales and optional reference captures.
  test.setTimeout(300_000);
  cspViolations.length = 0;
  watchCsp(page.context());
  await expectNonceCsp(page, "/setup");
  // Install metadata must be public, including before the first session.
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  expect(await manifestResponse.json()).toMatchObject({ name: 'Allumi', display: 'standalone', start_url: '/' });
  // Security headers also protect the standalone server without a reverse proxy.
  for (const path of ["/connexion", "/api/health", "/icons/allumi-180.png", "/icons/allumi.svg", "/favicon.ico"]) {
    const response = await page.request.get(path);
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
  }
  // Fresh instance: everything leads to /setup.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Bienvenue dans Allumi" })).toBeVisible();
  await expect(page.getByText(`Version ${VERSION}`)).toBeVisible();

  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/allumi-180.png');
  // The tab icon is served to visitors without a session, and the logo in the header is the drawn mark.
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/icons/allumi.svg');
  expect((await page.request.get('/icons/allumi.svg')).headers()['content-type']).toContain('image/svg+xml');
  expect((await page.request.get('/favicon.ico')).status()).toBe(200);
  expect((await page.request.get('/icons/allumi-maskable-512.png')).status()).toBe(200);
  expect((await (await page.request.get('/manifest.webmanifest')).json()).icons).toContainEqual(expect.objectContaining({ purpose: 'maskable', sizes: '512x512' }));
  await expect(page.locator('header svg[aria-hidden="true"]').first()).toBeVisible();
  await captureReference(page, "premier-demarrage");

  await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");
  await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");
  await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");
  await page.getByLabel("Ton nom").fill("Alex Exemple");
  await page.getByLabel("Courriel").fill(EMAIL);
  await page.getByLabel("Langue de l'interface").selectOption("en");
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);

  // A mismatched confirmation is the commonest mistake: the form must keep everything that was chosen,
  // selects included (a silent reset to January would misconfigure the fiscal year).
  await page.getByLabel("Confirmation du mot de passe").fill("autre chose");
  await page.getByRole("button", { name: "Créer l'entreprise et commencer" }).click();
  await expect(page.getByText("Les mots de passe ne correspondent pas.")).toBeVisible();
  await expect(page.getByLabel("Nom de l'entreprise")).toHaveValue("Atelier Exemple inc.");
  await expect(page.getByLabel("Premier mois de l'exercice financier")).toHaveValue("4");
  await expect(page.getByLabel("Langue de l'interface")).toHaveValue("en");

  // Back to French for the rest of the journey, and the right confirmation.
  await page.getByLabel("Langue de l'interface").selectOption("fr-CA");
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer l'entreprise et commencer" }).click();

  // Signed in on the company dashboard.
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Atelier Exemple inc." })).toBeVisible();
  await expect(page.getByText("Ton rôle : Admin")).toBeVisible();

  await expect(page.getByTestId("dashboard-assets")).toContainText("0,00");
  await expect(page.getByText("Un nouveau départ pour vos livres")).toBeVisible();
  await expectNoPageOverflow(page);
  const companyNavigation = page.getByRole("navigation", { name: "Navigation de l'entreprise", exact: true });
  await expect(companyNavigation.getByRole("link", { name: "Tableau de bord", exact: true })).toHaveAttribute("aria-current", "page");
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await expect.poll(async () => {
      const box = await companyNavigation.boundingBox();
      const height = await page.evaluate(() => window.innerHeight);
      return box !== null && Math.abs(box.y + box.height - height) <= 1;
    }).toBe(true);
  }

  // /setup is disabled for good: a visitor without a session is sent to the sign-in page...
  const visitor = await newWatchedContext(browser);
  const visitorPage = await visitor.newPage();
  await visitorPage.goto("/setup");
  await expect(visitorPage).toHaveURL(/\/connexion$/);
  await visitor.close();
  // ...and a signed-in user to the dashboard.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);

  // Cookie is httpOnly (no script access).
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith("allumi_session"));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  // Enable two-factor authentication.
  await page.goto("/compte/securite");
  await page.getByRole("button", { name: "Activer la 2FA" }).click();
  const manualKey = await page.locator("code").first().innerText();
  const totp = new TOTP({ secret: Secret.fromBase32(manualKey), digits: 6, period: 30 });
  // Fixed instant: the replay check below must not depend on which 30-second window the test runs in.
  const enrolledAt = Date.now();
  await page.getByLabel("Code à 6 chiffres").fill(totp.generate({ timestamp: enrolledAt }));
  // A stolen session cookie is not enough to enroll a device: the account password is asked too.
  await page.getByLabel("Mot de passe", { exact: true }).fill("mauvais mot de passe");
  await page.getByRole("button", { name: "Confirmer et activer" }).click();
  await expect(page.getByText("Mot de passe ou code incorrect.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codes de récupération" })).toBeHidden();
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Code à 6 chiffres").fill(totp.generate({ timestamp: enrolledAt }));
  await page.getByRole("button", { name: "Confirmer et activer" }).click();
  await expect(page.getByRole("heading", { name: "Codes de récupération" })).toBeVisible();
  const recoveryCodes = await recoveryCodeItems(page).allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);

  // The codes are shown once: switching the language while they are on screen must not lose them.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeVisible();
  await expect(recoveryCodeItems(page)).toHaveText(recoveryCodes);
  await page.getByRole("button", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Codes de récupération" })).toBeVisible();

  // Sign out (the session cookie is really gone from the browser), then sign in again: password alone is not enough.
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith("allumi_session"))).toBeUndefined();
  await page.getByLabel("Courriel").fill(EMAIL);
  await page.getByLabel("Mot de passe").fill("mauvais mot de passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Courriel ou mot de passe incorrect, ou compte temporairement verrouillé.")).toBeVisible();

  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/connexion\/2fa$/);

  // A protected page stays closed until the second factor is done.
  await page.goto("/compte/securite");
  await expect(page).toHaveURL(/\/connexion\/2fa$/);

  await expectNoPageOverflow(page);
  await captureReference(page, "connexion-deux-etapes");

  // The code that enabled 2FA cannot be replayed (rejected whether or not its window is still open)...
  await page.getByLabel("Code à 6 chiffres").fill(totp.generate({ timestamp: enrolledAt }));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page.getByText("Code invalide ou déjà utilisé.")).toBeVisible();

  // ...while a recovery code works.
  await page.getByLabel("Code à 6 chiffres").fill(recoveryCodes[0] ?? "");
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);

  await test.step("securityJourney", () => securityJourney(page, browser, recoveryCodes));
  await test.step("ledgerJourney", () => ledgerJourney(page, totp));
  await test.step("contactsJourney", () => contactsJourney(page, recoveryCodes[3] ?? ""));
  await test.step("catalogJourney", () => catalogJourney(page));
  await test.step("companyJourney", () => companyJourney(page));
  await test.step("draftsJourney", () => draftsJourney(page));
  await page.goto('/versions');
  await expect(page.getByRole('heading', { name: 'Versions et mises à jour' })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, 'versions');
  const news=page.getByRole("region",{name:`Nouveautés de la version ${VERSION}`,exact:true});
  expect(RELEASE_NOTES[VERSION]).toBeDefined();
  for (const [category, heading] of [["added", "Nouveautés"], ["improved", "Améliorations"], ["fixed", "Corrections"], ["installation", "Installation"]] as const) {
    const items = RELEASE_NOTES[VERSION]!["fr-CA"][category];
    await expect(news.getByRole("heading", { name: heading, exact: true })).toHaveCount(items.length ? 1 : 0);
    for (const item of items) await expect(news.getByRole("listitem").getByText(item.text, { exact: true })).toBeVisible();
  }
  await expect(news.getByRole("link",{name:"Notes complètes de la release sur GitHub",exact:true})).toHaveAttribute("href",`https://github.com/Installation-04/Allumi/releases/tag/v${VERSION}`);
  await expectNoPageOverflow(page);await captureReference(page,"nouveautes-versions",`Nouveautés de la version ${VERSION}`);
  await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  const englishNews=page.getByRole("region",{name:`What’s new in version ${VERSION}`,exact:true});
  for (const [category, heading] of [["added", "New features"], ["improved", "Improvements"], ["fixed", "Fixes"], ["installation", "Installation"]] as const) {
    const items = RELEASE_NOTES[VERSION]!.en[category];
    await expect(englishNews.getByRole("heading", { name: heading, exact: true })).toHaveCount(items.length ? 1 : 0);
    for (const item of items) await expect(englishNews.getByRole("listitem").getByText(item.text, { exact: true })).toBeVisible();
  }
  if(VERSION==="0.4.0-alpha.62"){await englishNews.locator("summary",{hasText:"Earlier documented versions"}).click();await expect(englishNews.getByText("Version 0.4.0-alpha.61",{exact:true})).toBeVisible();}
  await expectNoPageOverflow(page);await captureReference(page,"nouveautes-versions-en-dark",`What’s new in version ${VERSION}`);
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
  await page.goto('/');
  await openSection(page, "Ventes");
  await expect(page.getByRole("heading", { name: "Ventes", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "À venir — non disponible" })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "espace-ventes");
  if ((page.viewportSize()?.width ?? 1280) >= 1024) {
    const sidebar = page.getByRole("navigation", { name: "Navigation de l'entreprise", exact: true });
    const tabs = page.getByRole("navigation", { name: "Sections comptables", exact: true });
    await expect(sidebar.getByRole("link", { name: "Brouillons de factures", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Ventes", exact: true })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Brouillons de factures", exact: true }).click();
    await expect(tabs.getByRole("link", { name: "Brouillons de factures", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.getByRole("link", { name: "Ventes", exact: true })).toHaveAttribute("aria-current", "page");
    await captureReference(page, "navigation-contextuelle");
    await sidebar.getByRole("link", { name: "Ventes", exact: true }).click();
  } else await captureReference(page, "navigation-contextuelle");
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    const nav = page.getByRole("navigation", { name: "Navigation de l'entreprise", exact: true });
    await nav.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Paie", exact: true })).toBeVisible();
    await captureReference(page, "menu-complet");
    await page.keyboard.press("Escape");
    await expect(nav.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
    await expect(nav.getByRole("button", { name: "Menu", exact: true })).toHaveAttribute("aria-expanded", "false");
  }

  // English interface.
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("Your role: Admin")).toBeVisible();
  await captureReference(page, "dashboard-en");
  await test.step("appearanceJourney", () => appearanceJourney(page));
  await test.step("postingJourney", () => postingJourney(page));
  const paidInvoiceUrl = await test.step("creditPostingJourney", () => creditPostingJourney(page));
  await test.step("paymentsJourney", () => paymentsJourney(page, paidInvoiceUrl));
  await test.step("integrationsJourney", () => integrationsJourney(page));
  await test.step("onlinePaymentsJourney", () => onlinePaymentsJourney(page, paidInvoiceUrl));
  await test.step("bankImportJourney", () => bankImportJourney(page));
  await test.step("bankMatchingJourney", () => bankMatchingJourney(page));
  await test.step("bankReconciliationJourney", () => bankReconciliationJourney(page));
  await test.step("financialStatementsJourney", () => financialStatementsJourney(page));
  await test.step("generalLedgerJourney", () => generalLedgerJourney(page));
  await test.step("receivablesAgingJourney", () => receivablesAgingJourney(page));
  await test.step("supplierBillsJourney", () => supplierBillsJourney(page));
  await test.step("paidExpensesJourney", () => paidExpensesJourney(page));
  await test.step("taxSummaryJourney", () => taxSummaryJourney(page));
  await test.step("cashMovementsJourney", () => cashMovementsJourney(page));
  await test.step("bankDepositsJourney", () => bankDepositsJourney(page));
  const availableCreditUrl = await test.step("customerBalancesJourney", () => customerBalancesJourney(page, paidInvoiceUrl));
  await test.step("paymentHistoryJourney", () => paymentHistoryJourney(page));
  const nextInvoiceUrl = await test.step("creditApplicationsJourney", () => creditApplicationsJourney(page, availableCreditUrl));
  await test.step("invoiceModulePermissionsJourney", () => invoiceModulePermissionsJourney(page, nextInvoiceUrl));
  const accountReceiptUrl = await test.step("onAccountReceiptJourney", () => onAccountReceiptJourney(page, nextInvoiceUrl));
  await test.step("receiptRefundJourney", () => receiptRefundJourney(page, accountReceiptUrl));
  const settingsBase = new URL(page.url()).pathname.match(/^\/c\/[^/]+/)?.[0];
  expect(settingsBase).toBeTruthy();
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await page.goto(`${settingsBase}/parametres`);
  await expect(page.getByRole("heading", { name: "Paramètres et administration", exact: true })).toBeVisible();
  const settings = page.locator(".workspace-content");
  await expect(settings.getByRole("link", { name: "Utilisateurs et permissions", exact: true })).toBeVisible();
  await expect(settings.getByRole("link", { name: "Serveur, sauvegardes et journaux", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "parametres-administration");
  await test.step("membersJourney", () => membersJourney(page, browser));
  updateCookies = await page.context().cookies();
  // Nothing in the whole journey (both locales, every form, the security pages, a second browser) was blocked.
  expect(cspViolations, "Content-Security-Policy violations").toEqual([]);
});

test("server update request, automatic progress and completion without a host deployment", async ({ page }) => {
  test.setTimeout(90_000);
  cspViolations.length = 0;
  watchCsp(page.context());
  await page.context().addCookies(updateCookies);
  await test.step("serverUpdateJourney", () => serverUpdateJourney(page));
  expect(cspViolations, "Content-Security-Policy violations").toEqual([]);
});

test("supplier statement, complete CSV and print view in both locales", async ({ page }) => {
  test.setTimeout(90_000);
  cspViolations.length=0;
  watchCsp(page.context());
  await page.context().addCookies(updateCookies);
  await page.goto("/");
  if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
  const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];
  expect(company).toBeTruthy();
  await page.goto(`${company}/contacts`);
  await page.getByRole("link",{name:/Atelier Boréal/}).first().click();
  await expectNoPageOverflow(page);
  await page.getByRole("link",{name:"Relevé de compte fournisseur",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Relevé de compte fournisseur",exact:true})).toBeVisible();
  await page.getByLabel("Du",{exact:true}).fill("2026-07-15");
  await page.getByLabel("Au",{exact:true}).fill("2026-07-19");
  await page.getByRole("button",{name:"Afficher le relevé",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Atelier Boréal",exact:true})).toBeVisible();
  const content=page.locator(".workspace-content"),summary=content.locator("dl").first();
  await expect(content.getByRole("status")).toContainText("6 mouvements");
  for(const label of ["Débits","Crédits"])await expect(summary.getByText(label,{exact:true}).locator("..").locator("dd")).toContainText("193,72");
  await expect(summary.getByText("Solde final",{exact:true}).locator("..").locator("dd")).toContainText("0,00");
  await expect(content).not.toContainText("Facture fournisseur de référence");
  await expectNoPageOverflow(page);await captureReference(page,"releve-fournisseur","Atelier Boréal");
  const statementUrl=page.url(),csvHref=await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href");
  const csv=await page.request.get(csvHref!);
  expect(csv.status()).toBe(200);expect(csv.headers()["cache-control"]).toBe("private, no-store");
  expect(csv.headers()["content-disposition"]).toContain("supplier_statement_2026-07-15_2026-07-19.csv");
  const text=await csv.text();expect(text).toContain("Facture fournisseur A-00001");
  expect(text).toContain("FOUR-2026-001");
  expect(text).not.toMatch(/Facture fournisseur de référence|Retour partiel de fournitures|Correction de la pièce|journalEntryId|[a-f0-9]{8}-[a-f0-9]{4}-/);
  await page.getByRole("link",{name:"Vue imprimable complète",exact:true}).click();
  await expect(page.getByRole("button",{name:"Imprimer / PDF",exact:true})).toBeVisible();
  await expect(content.locator('a[href*="/journal/"]')).toHaveCount(0);
  await page.emulateMedia({media:"print"});
  await expect(page.locator(".workspace-header")).toBeHidden();await expect(page.getByRole("table")).toBeVisible();
  await page.emulateMedia({media:"screen"});await page.goto(statementUrl);
  await page.getByRole("button",{name:"English",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Supplier account statement",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await expectNoPageOverflow(page);await captureReference(page,"releve-fournisseur-en-dark","Atelier Boréal");
  const english=await page.request.get((await page.getByRole("link",{name:"Export CSV",exact:true}).getAttribute("href"))!);
  expect(english.status()).toBe(200);expect(await english.text()).toContain("Bill A-00001");
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
  await page.getByRole("button",{name:"Français",exact:true}).click();
  for(const suffix of ["?contact=invalid","?contact=invalid&contact=","/export?contact=invalid","/export?contact=&contact=invalid","?du=2026-02-30&au=2026-03-01","?du=2026-01-01&du=2026-01-02&au=2026-02-01","?imprimer=1&imprimer=1"])expect((await page.request.get(`${company}/releves-fournisseurs${suffix}`)).status()).toBe(404);
  expect(cspViolations,"Content-Security-Policy violations").toEqual([]);
});

test("global company search, advanced filters and direct document links in both locales", async ({ page }) => {
  test.setTimeout(90_000);
  cspViolations.length=0;watchCsp(page.context());
  await page.context().addCookies(updateCookies);await page.goto("/");
  if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
  const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
  const header=page.getByRole("search",{name:"Recherche dans l’entreprise",exact:true});
  await header.getByRole("combobox",{name:"Terme recherché",exact:true}).fill("FOUR-2026-001");
  await header.getByRole("button",{name:"Recherche dans l’entreprise",exact:true}).click();
  const content=page.locator(".workspace-content");
  await expect(content.getByRole("heading",{name:"Recherche dans l’entreprise",exact:true})).toBeVisible();
  const results=content.getByRole("list",{name:"Résultats de recherche",exact:true});
  await expect(results.getByRole("link",{name:"A-00001",exact:true})).toBeVisible();
  await results.getByRole("link",{name:"A-00001",exact:true}).click();
  await expect(page).toHaveURL(/\/achats\/validees\/[0-9a-f-]{36}$/);
  await page.goto(`${company}/recherche?type=BILL&du=2026-07-15&au=2026-07-19&statut=VOID`);
  await expect(content.getByRole("status")).toContainText("1 résultat");
  await expect(results.getByRole("link",{name:"A-00001",exact:true})).toBeVisible();
  const amount=await results.locator("p.font-semibold").innerText();
  const frenchFilters=page.getByRole("form",{name:"Filtres de recherche",exact:true});
  await frenchFilters.getByText(/Filtres avancés/).click();
  await frenchFilters.getByLabel("Montant exact (CAD)",{exact:true}).fill(amount);await frenchFilters.getByRole("button",{name:"Rechercher",exact:true}).click();
  await expect(content.getByRole("status")).toContainText("1 résultat");
  await expectNoPageOverflow(page);await captureReference(page,"recherche-globale","Recherche dans l’entreprise");
  await page.getByRole("button",{name:"English",exact:true}).click();
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await expect(content.getByRole("heading",{name:"Search company data",exact:true})).toBeVisible();
  await expect(content.getByRole("list",{name:"Search results",exact:true}).getByRole("link",{name:"A-00001",exact:true})).toBeVisible();
  await expectNoPageOverflow(page);await captureReference(page,"recherche-globale-en-dark","Search company data");
  const filters=page.getByRole("form",{name:"Search filters",exact:true});
  await filters.getByText(/Advanced filters/).click();
  await filters.getByLabel("Type",{exact:true}).selectOption("CONTACT");
  await filters.getByLabel("Status",{exact:true}).selectOption("");
  await filters.getByLabel("Exact amount (CAD)",{exact:true}).fill("");
  await filters.getByLabel("From",{exact:true}).fill("");await filters.getByLabel("To",{exact:true}).fill("");
  await filters.getByLabel("Search term",{exact:true}).fill("Atelier Boréal");
  await filters.getByRole("button",{name:"Search",exact:true}).click();
  await expect(content.getByRole("list",{name:"Search results",exact:true}).getByRole("link",{name:"Atelier Boréal",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();
  for(const suffix of ["?type=INVALID","?type=BILL&type=INVOICE","?q=a&q=b","?montant=-1","?du=2026-02-30","?du=2026-08-01&au=2026-07-01","?page=101"])expect((await page.request.get(`${company}/recherche${suffix}`)).status()).toBe(404);
  expect(cspViolations,"Content-Security-Policy violations").toEqual([]);
});

test("official GST/HST and QST sources, reviewed import and local tax code",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
 await page.goto(`${company}/taxes`);await page.getByRole("link",{name:"Sources fiscales officielles",exact:true}).click();
 await page.getByLabel("Province ou territoire",{exact:true}).selectOption("QC");await page.getByLabel("Date de référence",{exact:true}).fill("2026-07-15");await page.getByRole("button",{name:"Consulter les taux",exact:true}).click();
 const content=page.locator(".workspace-content");await expect(content.getByRole("heading",{name:"ARC · TPS/TVH",exact:true})).toBeVisible();await expect(content.getByRole("heading",{name:"Revenu Québec · TVQ",exact:true})).toBeVisible();
 await expect(content.getByText("9,975 %",{exact:true}).first()).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"sources-fiscales","Taux standards · Québec · 2026-07-15");
 await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expect(content.getByRole("heading",{name:"CRA · GST/HST",exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"sources-fiscales-en-dark","Standard rates · Quebec · 2026-07-15");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();
 await page.getByLabel("Code local",{exact:true}).fill("QC-EXT");
 for(const [label,code] of [["TPS/TVH à remettre","2100"],["TPS/TVH récupérable (facultatif)","1200"],["TVQ à remettre","2110"],["TVQ récupérable (facultatif)","1210"]]) {
   const field=page.getByLabel(label!,{exact:true});const options=await field.locator("option").allTextContents();
   const match=options.find(text=>text.startsWith(code!+" "));expect(match,`Account ${code}`).toBeTruthy();await field.selectOption({label:match!});
 }
 const confirmation=page.getByRole("checkbox",{name:/J’ai vérifié la province/});await expect(confirmation).not.toBeChecked();await expect(confirmation).toHaveAttribute("required","");await confirmation.check();await page.getByRole("button",{name:"Créer le code et ses taxes",exact:true}).click();
 await expect(content.getByRole("status").filter({hasText:"Le code fiscal QC-EXT et ses taux officiels ont été créés."})).toHaveText("Le code fiscal QC-EXT et ses taux officiels ont été créés.");await expect(content.getByRole("heading",{name:/^QC-EXT —/})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"code-fiscal-importe","QC-EXT — TPS et TVQ · QC");
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();try {const result=await db.query("SELECT after FROM audit_log WHERE company_id=$1 AND action='tax.official_import' ORDER BY id DESC LIMIT 1",[company!.split("/")[2]]);expect(result.rows[0]?.after.province).toBe("QC");expect(result.rows[0]?.after.sources).toHaveLength(2);}finally{await db.end();}
 for(const suffix of ["?province=XX","?province=QC&province=ON","?date=2012-01-01","?date=2026-02-30","?charger=2"])expect((await page.request.get(`${company}/sources-fiscales${suffix}`)).status()).toBe(404);
 expect(cspViolations).toEqual([]);
});

/** Browser-only demonstration of the file hand-off: no host agent, Docker process or deployment is started. */
async function serverUpdateJourney(page: Page) {
 const directory=process.env.E2E_UPDATE_DIR;
 expect(directory,"isolated update fixture directory supplied by Playwright").toBeTruthy();
 const release=(JSON.parse(readFileSync(new URL("./fixtures/update-releases.json",import.meta.url),"utf8")) as {tag_name:string}[])[0]!.tag_name;
 const file=(name:string)=>join(directory!,name);
 expect(await updateFiles.readdir(directory!)).toEqual([]);
 await page.goto("/administration/serveur");
 const panel=page.getByRole("region",{name:"Mises à jour du serveur",exact:true});
 await expect(panel.getByText(`Nouvelle version : ${release}`,{exact:true})).toBeVisible();
 await expect(panel.getByText("Agent configuré. Son service doit être actif sur le serveur.",{exact:true})).toBeVisible();
 const confirm=panel.getByLabel("J’ai sauvegardé mon travail. La mise à jour créera une sauvegarde et interrompra temporairement le service pour tous les utilisateurs.",{exact:true});
 await expect(confirm).not.toBeChecked();
 await expect(confirm).toHaveAttribute("required","");
 await expect(panel.getByRole("link",{name:"Notes de version",exact:true})).toHaveAttribute("href",`https://github.com/Installation-04/Allumi/releases/tag/${release}`);
 await expectNoPageOverflow(page);await captureReference(page,"serveur-mise-a-jour-disponible","Mises à jour du serveur");
 await confirm.check();
 await panel.getByRole("button",{name:"Mettre à jour le serveur",exact:true}).click();
 await expect(panel.getByText("Demande en attente de traitement par l’agent du serveur.",{exact:true})).toBeVisible();
 const raw=await updateFiles.readFile(file("request.json"),"utf8");
 const request=JSON.parse(raw) as {version:string;actor:string;requestedAt:string;requestId:string};
 expect(Object.keys(request).sort()).toEqual(["actor","requestId","requestedAt","version"]);
 expect(request.version).toBe(release);
 expect(request.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
 expect(Number.isFinite(Date.parse(request.requestedAt))).toBe(true);
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 try{const user=await db.query("SELECT id FROM app_user WHERE email=$1",[EMAIL]);expect(request.actor).toBe(user.rows[0]?.id);}finally{await db.end();}
 expect((await updateFiles.stat(file("request.json"))).mode&0o777).toBe(0o600);
 expect(await updateFiles.readdir(directory!)).toEqual(["request.json"]);
 await expectNoPageOverflow(page);await captureReference(page,"serveur-mise-a-jour-attente","Mises à jour du serveur");
 // Publish synthetic status atomically, exactly as a separate agent would. The test never starts that agent.
 const status=async(state:"running"|"success",stage:"backup"|"complete")=>{
  await updateFiles.writeFile(file(".status-fixture"),JSON.stringify({state,stage,target:release,fromVersion:VERSION,requestId:request.requestId,requestedAt:request.requestedAt,updatedAt:new Date().toISOString()}),{mode:0o600});
  await updateFiles.rename(file(".status-fixture"),file("status.json"));
 };
 await status("running","backup");
 await expect(panel.getByText("Mise à jour en cours.",{exact:true})).toBeVisible();
 await expect(panel.getByText("Sauvegarde avant mise à jour",{exact:true})).toBeVisible();
 // The automatic status endpoint must remain private and avoid a second GitHub release request.
 const progress=await page.request.get("/administration/serveur/mises-a-jour/etat");
 expect(progress.status()).toBe(200);expect(progress.headers()["cache-control"]).toContain("no-store");
 expect(await progress.json()).toMatchObject({currentVersion:VERSION,status:{state:"running",stage:"backup",target:release,requestId:request.requestId}});
 expect(await updateFiles.readFile(file("request.json"),"utf8")).toBe(raw);
 await status("success","complete");
 // Completion normally consumes the request. Keep the simulated agent's operation limited to these two files.
 await updateFiles.unlink(file("request.json"));
 await expect(panel.getByText("La dernière mise à jour a réussi.",{exact:true})).toBeVisible();
 await expect(panel.getByText("Opération terminée",{exact:true})).toBeVisible();
 await expect(panel.getByText(`Version serveur : ${VERSION}`,{exact:true})).toBeVisible();
 expect(await updateFiles.readdir(directory!)).toEqual(["status.json"]);
 await expectNoPageOverflow(page);await captureReference(page,"serveur-mise-a-jour-terminee","Mises à jour du serveur");
 await page.getByRole("button",{name:"English",exact:true}).click();
 const englishPanel=page.getByRole("region",{name:"Server updates",exact:true});
 await expect(englishPanel.getByText("The last update succeeded.",{exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"serveur-mise-a-jour-en-dark","Server updates");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();
 await expect(panel.getByText("La dernière mise à jour a réussi.",{exact:true})).toBeVisible();
}

/** Today in the company's time zone (the application uses America/Toronto), as YYYY-MM-DD. */
const todayInToronto = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

/**
 * Two days of the current month that no other journey writes in (they write on the 1st, the 2nd to the 6th and today): the
 * 20th and the 21st, or the 7th and the 8th when today is later than the 15th. The report journeys put their entries there.
 */
const reportDays = (): [string, string] => {
  const today = todayInToronto();
  const [first, second] = Number(today.slice(8, 10)) <= 15 ? ["20", "21"] : ["07", "08"];
  return [`${today.slice(0, 7)}-${first}`, `${today.slice(0, 7)}-${second}`];
};

/** A link of the company navigation (the dashboard cards carry the same names). */
const openSection = async (page: Page, name: string) => {
  const nav = page.getByRole("navigation", { name: "Navigation de l'entreprise", exact: true });
  const link = nav.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) {
    if ((page.viewportSize()?.width ?? 1280) < 1024) await nav.getByRole("button", { name: "Menu", exact: true }).click();
    else await nav.getByRole("searchbox", { name: "Rechercher une section", exact: true }).fill(name);
  }
  await link.click();
};

/** The accounting engine through the screens: chart, entry, reversal, trial balance, period lock, audit trail. */
async function ledgerJourney(page: Page, totp: TOTP) {
  // The starter chart is there since /setup; add an account.
  await openSection(page, "Plan comptable");
  await expect(page.getByRole("heading", { name: "Plan comptable" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Banque – compte courant" })).toBeVisible();
  await captureReference(page, "plan-comptable");
  await expectNoPageOverflow(page);
  // A petty-cash account: an asset, not the form's default type.
  await page.getByLabel("Code", { exact: true }).fill("1999");
  await page.getByLabel("Nom (français)").fill("Caisse secondaire");
  await page.getByLabel("Nom (anglais)").fill("Petty cash");
  await page.getByLabel("Type", { exact: true }).selectOption("ASSET");
  await page.getByLabel("Sous-type").selectOption({ label: "Encaisse" });
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByRole("cell", { name: "1999", exact: true })).toBeVisible();
  // The form is back to its defaults, and the subtypes offered are those of the type it shows (not of the one chosen before).
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("EXPENSE");
  await expect(page.getByLabel("Sous-type")).toContainText("Charges d'exploitation");
  await expect(page.getByLabel("Sous-type")).not.toContainText("Encaisse");

  // A refused account (this code exists) keeps the type that was chosen, and the subtypes that go with it.
  await page.getByLabel("Code", { exact: true }).fill("1999");
  await page.getByLabel("Nom (français)").fill("Doublon");
  await page.getByLabel("Nom (anglais)").fill("Duplicate");
  await page.getByLabel("Type", { exact: true }).selectOption("LIABILITY");
  await expect(page.getByLabel("Sous-type")).toContainText("Carte de crédit");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByText("Ce code de compte existe déjà.")).toBeVisible();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("LIABILITY");
  await expect(page.getByLabel("Sous-type")).toContainText("Carte de crédit");
  await expect(page.getByLabel("Nom (français)")).toHaveValue("Doublon");

  // Accounts can be renamed; the type stays.
  await page.getByRole("link", { name: "Modifier le compte 1999" }).click();
  await expect(page.getByRole("heading", { name: "Modifier le compte 1999" })).toBeVisible();
  await page.getByLabel("Nom (français)").fill("Caisse secondaire (atelier)");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("cell", { name: /Caisse secondaire \(atelier\)/ })).toBeVisible();

  // An unbalanced entry is flagged on screen and refused with the rule's message.
  await openSection(page, "Journal");
  await page.getByRole("link", { name: "Nouvelle écriture" }).click();
  // Wait for the destination form: App Router may retain the outgoing route during navigation.
  const entryForm = page.locator("form").filter({ has: page.getByRole("combobox", { name: "Ligne 1 – Compte", exact: true }) });
  await expect(entryForm).toBeVisible();
  const entryControls = entryForm.locator('select, input:not([type="hidden"])');
  await expect(entryControls).toHaveCount(11);
  // Entry controls must fit the viewport, including small phones, without hiding overflow.
  const originalViewport = page.viewportSize();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const control of await entryControls.all()) {
      await expect(control).toBeVisible();
      await expect.poll(async () => {
        const box = await control.boundingBox();
        return box !== null && box.x >= 0 && box.x + box.width <= width && box.height >= 44;
      }).toBe(true);
    }
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  await expect(page.getByLabel("Ligne 3 – Compte")).toBeFocused();
  await page.getByRole("button", { name: /.*ligne 3/i }).click();
  await expect(page.getByRole("button", { name: "Ajouter une ligne" })).toBeFocused();
  const firstOfMonth = `${todayInToronto().slice(0, 7)}-01`;
  await page.getByLabel("Date", { exact: true }).fill(firstOfMonth);
  await page.getByLabel("Type d'écriture").selectOption("OPENING_BALANCE");
  await page.getByLabel("Description").fill("Capital de départ");
  await page.getByLabel("Ligne 1 – Compte").selectOption({ label: "1000 – Banque – compte courant" });
  await page.getByLabel("Ligne 1 – Débit").fill("1 000,00");
  await page.getByLabel("Ligne 2 – Compte").selectOption({ label: "3000 – Capital-actions" });
  await page.getByLabel("Ligne 2 – Crédit").fill("1000");
  await expect(page.getByText("L'écriture est équilibrée.")).toBeVisible();
  await captureReference(page, "nouvelle-ecriture");
  await page.getByLabel("Ligne 2 – Crédit").fill("900,00");
  await expect(page.getByText(/Écart : 100,00/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
  await expect(page.getByText("Les débits et les crédits ne sont pas égaux.")).toBeVisible();
  // A refusal must not wipe the form (React resets it after every action): the kind, the memo, the date and the
  // accounts are still what was typed, or an entry fixed in haste would be posted as another kind.
  await expect(page.getByLabel("Type d'écriture")).toHaveValue("OPENING_BALANCE");
  await expect(page.getByLabel("Description")).toHaveValue("Capital de départ");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(firstOfMonth);
  await expect(page.getByLabel("Ligne 1 – Compte")).toHaveValue(/.+/);
  await expect(page.getByLabel("Ligne 1 – Débit")).toHaveValue("1 000,00");

  // Balanced: posted, numbered, shown.
  await page.getByLabel("Ligne 2 – Crédit").fill("1000");
  await expect(page.getByText("L'écriture est équilibrée.")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
  await expect(page.getByRole("heading", { name: "Écriture J-00001" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /3000 – Capital-actions/ })).toBeVisible();

  const postedEntryUrl = page.url();
  await page.goto("/");
  await expect(page.getByTestId("dashboard-assets")).toContainText("1 000,00");
  await expect(page.getByTestId("dashboard-liabilities")).toContainText("0,00");
  await expect(page.getByRole("link", { name: /Capital de départ/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "tableau-de-bord");
  const dashboardViewport = page.viewportSize();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoPageOverflow(page);
  }
  if (dashboardViewport) await page.setViewportSize(dashboardViewport);
  await openSection(page, "Journal");
  await captureReference(page, "journal");
  await expectNoPageOverflow(page);
  await openSection(page, "Balance de vérification");
  await captureReference(page, "balance");
  await expectNoPageOverflow(page);
  await page.goto(postedEntryUrl);

  // Reversal: a mirror entry, nothing is deleted.
  await page.getByRole("button", { name: "Contre-passer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Écriture J-00002" })).toBeVisible();
  await expect(page.getByText("Contre-passation de l'écriture J-00001")).toBeVisible();

  // The trial balance balances, with the accounting equation.
  await openSection(page, "Balance de vérification");
  await expect(page.getByText("La balance est équilibrée")).toBeVisible();
  await expect(page.getByText("Équation comptable vérifiée")).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("dashboard-assets")).toContainText("0,00");

  // Locking the period of today closes it to new entries.
  await openSection(page, "Exercices");
  await captureReference(page, "exercices");
  await expectNoPageOverflow(page);
  const monthStart = `${todayInToronto().slice(0, 7)}-01`;
  await page.locator("tr", { hasText: `${monthStart} →` }).getByRole("button", { name: "Verrouiller" }).click();
  await expect(page.locator("tr", { hasText: `${monthStart} →` }).getByText("Verrouillée")).toBeVisible();
  await openSection(page, "Journal");
  await page.getByRole("link", { name: "Nouvelle écriture" }).click();
  await page.getByLabel("Ligne 1 – Compte").selectOption({ label: "1000 – Banque – compte courant" });
  await page.getByLabel("Ligne 1 – Débit").fill("5");
  await page.getByLabel("Ligne 2 – Compte").selectOption({ label: "3000 – Capital-actions" });
  await page.getByLabel("Ligne 2 – Crédit").fill("5");
  await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
  await expect(page.getByText("Cette période est verrouillée.")).toBeVisible();

  // Reopening the past asks for the owner's authenticator code typed now, and a reason.
  await openSection(page, "Exercices");
  const row = page.locator("tr", { hasText: `${monthStart} →` });
  await row.getByLabel(/Motif pour rouvrir la période/).fill("Correction demandée par la comptable");
  await row.getByLabel(/Code de vérification pour rouvrir la période/).fill("000000");
  await row.getByRole("button", { name: "Rouvrir" }).click();
  await expect(page.getByText("Le code de vérification est invalide ou déjà utilisé.")).toBeVisible();
  // the reason survives the refusal; the one-time code does not come back
  await expect(row.getByLabel(/Motif pour rouvrir la période/)).toHaveValue("Correction demandée par la comptable");
  await expect(row.getByLabel(/Code de vérification pour rouvrir la période/)).toHaveValue("");
  // a code of the next 30-second step: later than the one that enrolled the authenticator
  await row.getByLabel(/Code de vérification pour rouvrir la période/).fill(totp.generate({ timestamp: Date.now() + 30_000 }));
  await row.getByRole("button", { name: "Rouvrir" }).click();
  await expect(row.getByText("Ouverte")).toBeVisible();

  // The audit trail knows about everything, written by the database.
  await openSection(page, "Piste d'audit");
  await expect(page.getByRole("heading", { name: "Piste d'audit" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "row.insert" }).first()).toBeVisible();
  await expect(page.getByText("journal_entry").first()).toBeVisible();
  await captureReference(page, "audit");
  await expectNoPageOverflow(page);
}

async function contactsJourney(page: Page, recoveryCode: string) {
  await openSection(page, "Contacts");
  await page.getByRole("link", { name: "Nouveau contact" }).click();
  await page.getByLabel("Nom affiché").fill("Atelier Boréal");
  await page.getByLabel("Type de contact").selectOption("BOTH");
  await page.getByLabel("Courriel", { exact: true }).fill("bonjour@boreal.example");
  await page.getByLabel("Téléphone", { exact: true }).fill("514 555-0142");
  await page.getByLabel("Délai de paiement (jours)").fill("-1");
  await page.getByRole("button", { name: "Créer le contact" }).click();
  await expect(page.locator("form").getByRole("alert").filter({ hasText: "Vérifiez les champs du contact" })).toBeVisible();
  await expect(page.getByLabel("Nom affiché")).toHaveValue("Atelier Boréal");
  await expect(page.getByLabel("Type de contact")).toHaveValue("BOTH");
  await page.getByLabel("Délai de paiement (jours)").fill("30");
  await page.getByRole("button", { name: "Créer le contact" }).click();
  await expect(page.getByRole("heading", { name: "Atelier Boréal" })).toBeVisible();
  await captureReference(page, "contact-form");
  await page.getByLabel("Téléphone", { exact: true }).fill("514 555-0199");
  await page.getByRole("button", { name: "Enregistrer le contact" }).click();
  await expect(page.getByLabel("Téléphone", { exact: true })).toHaveValue("514 555-0199");
  await page.getByRole("button", { name: "Archiver le contact" }).click();
  await expect(page.getByRole("button", { name: "Restaurer le contact" })).toBeVisible();
  await page.getByRole("link", { name: "Retour aux contacts" }).click();
  await expect(page.getByRole("link", { name: /Atelier Boréal/ })).toHaveCount(0);
  await page.getByRole("combobox", { name: /État/ }).selectOption("ARCHIVED");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await page.getByRole("link", { name: /Atelier Boréal/ }).click();
  await page.getByRole("button", { name: "Restaurer le contact" }).click();
  await expect(page.getByRole("button", { name: "Archiver le contact" })).toBeVisible();
  await openSection(page, "Contacts");
  await expect(page.getByRole("link", { name: /Atelier Boréal/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "contacts");
  await test.step("anonymizeJourney", () => anonymizeJourney(page, recoveryCode));
}

/** The attempts at a one-time code are counted per user (8 per 15 minutes) and the journey has used most of them. */
async function resetCodeAttempts() {
  const db = new pg.Client({ connectionString: e2eUrls().owner });
  await db.connect();
  try { await db.query("DELETE FROM rate_limit"); } finally { await db.end(); }
}

/**
 * Law 25: the owner erases a person from the directory. It needs a code typed now (a wrong one changes nothing),
 * clears the record and leaves no trace of the person in the audit trail, which says who erased and why.
 */
async function anonymizeJourney(page: Page, recoveryCode: string) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const email = "marie.tremblay@erasure.example";
  const phone = "514 555-0177";
  await page.goto(`${company}/contacts/nouveau`);
  await page.getByLabel("Nom affiché").fill("Marie Tremblay");
  await page.getByLabel("Courriel", { exact: true }).fill(email);
  await page.getByLabel("Téléphone", { exact: true }).fill(phone);
  await page.getByLabel("Notes").fill("Préfère être jointe le soir.");
  await page.getByRole("button", { name: "Créer le contact" }).click();
  await expect(page.getByRole("heading", { name: "Marie Tremblay" })).toBeVisible();
  const contactUrl = page.url();
  const trail = async () => {
    await page.goto(`${company}/audit?objet=contact`);
    await expect(page.getByRole("heading", { name: "Piste d'audit" })).toBeVisible();
    return (await page.locator("body").textContent()) ?? "";
  };
  // the audit trail does hold the person before the erasure (so the later check can fail)
  expect(await trail()).toContain(email);

  await page.goto(contactUrl);
  const erase = page.locator("details").filter({ hasText: "Anonymiser ce contact (Loi 25)" });
  await erase.getByText("Anonymiser ce contact (Loi 25)").click();
  await expect(erase.getByText("Les documents comptables sont conservés")).toBeVisible();
  await captureReference(page, "contact-anonymiser");
  await expectNoPageOverflow(page);
  const submit = async (code: string) => {
    await erase.getByLabel("Motif").selectOption("SUBJECT_REQUEST");
    await erase.getByLabel("Code de vérification").fill(code);
    await erase.getByLabel("Je comprends que l’effacement est définitif.").check();
    await erase.getByRole("button", { name: "Anonymiser définitivement" }).click();
  };
  await resetCodeAttempts();
  await submit("000000");
  await expect(erase.getByRole("alert").filter({ hasText: "invalide ou déjà utilisé" })).toBeVisible();
  await expect(erase.getByLabel("Motif")).toHaveValue("SUBJECT_REQUEST");
  await expect(page).toHaveURL(contactUrl);
  expect(await trail()).toContain(email);

  await page.goto(contactUrl);
  await erase.getByText("Anonymiser ce contact (Loi 25)").click();
  await submit(recoveryCode);
  await expect(page).toHaveURL(/\/contacts\?anonymized=1$/);
  await expect(page.getByRole("status").filter({ hasText: "Contact anonymisé" })).toBeVisible();
  await page.goto(`${company}/contacts?status=ALL&q=Tremblay`);
  await expect(page.getByRole("link", { name: /Marie Tremblay/ })).toHaveCount(0);
  expect((await page.goto(contactUrl))?.status()).toBe(404);

  const after = await trail();
  for (const secret of [email, phone, "Marie", "Tremblay", "jointe le soir"]) expect(after, secret).not.toContain(secret);
  await expect(page.getByRole("cell", { name: "contact.anonymize" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "privacy.redact" })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.goto(company);
}


async function appearanceJourney(page: Page) {
  const companyUrl = page.url();
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(await manifestResponse.json()).toMatchObject({ lang: "en", description: "Free accounting software for Quebec and Canada" });
  await page.emulateMedia({ colorScheme: "light" });
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole("combobox", { name: "Appearance", exact: true }).focus();
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectNoPageOverflow(page);
  await captureReference(page, "dashboard-en-dark");

  await page.goto(`${companyUrl}/contacts`);
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Atelier Boréal/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "contacts-en-dark");
  await page.getByRole("link", { name: "New contact", exact: true }).click();
  await expect(page.getByLabel("Payment terms (days)")).toBeVisible();
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "contact-form-en-dark");

  await page.goto(`${companyUrl}/comptes`);
  await expect(page.getByRole("heading", { name: "Chart of accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Petty cash", exact: true })).toBeVisible();
  await captureReference(page, "accounts-en-dark");
  await expectNoPageOverflow(page);

  for (const [route, heading] of [["catalogue", "Products and services"], ["taxes", "Taxes and rates"], ["entreprise", "Company"], ["factures", "Invoice drafts"]]) {
    await page.goto(`${companyUrl}/${route}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await captureReference(page, `${route}-en-dark`);
  }

  // Explicit light wins even when the device is dark; system follows changes live.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(lightBackground);
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(darkBackground);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(lightBackground);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Apparence", exact: true })).toHaveValue("system");
}

async function catalogJourney(page: Page) {
  await openSection(page, "Taxes");
  const taxForm = page.getByRole("heading", { name: "Créer une taxe", exact: true }).locator("..");
  for (const [code, name, rate, payable, recoverable] of [["TPS", "GST", "5", "2100", "1200"], ["TVQ", "QST", "9,975", "2110", "1210"]]) {
    await taxForm.getByLabel("Code", { exact: true }).fill(code!);
    await taxForm.getByLabel("Nom français").fill(code!);
    await taxForm.getByLabel("Nom anglais").fill(name!);
    await taxForm.getByLabel("Taux (%)").fill(rate!);
    await taxForm.getByLabel("Date d’effet").fill("2020-01-01");
    await taxForm.getByLabel("Compte de taxe à payer").selectOption({ label: `${payable} — ${code} à payer` });
    await taxForm.getByLabel("Compte de taxe récupérable").selectOption({ label: `${recoverable} — ${code} à recevoir` });
    await taxForm.getByRole("button", { name: "Créer une taxe", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${code} — ${code}`, exact: true })).toBeVisible();
  }
  const codeForm = page.getByRole("heading", { name: "Créer un code de taxe", exact: true }).locator("..");
  await codeForm.getByLabel("Code", { exact: true }).fill("TPS+TVQ");
  await codeForm.getByLabel("Nom français").fill("Taxes Québec");
  await codeForm.getByLabel("Nom anglais").fill("Quebec taxes");
  await codeForm.getByLabel("Première taxe").selectOption({ label: "TPS — TPS" });
  await codeForm.getByLabel("Deuxième taxe").selectOption({ label: "TVQ — TVQ" });
  await codeForm.getByRole("button", { name: "Créer un code de taxe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TPS+TVQ — Taxes Québec", exact: true })).toBeVisible();
  const preview = page.getByRole("region", { name: "Simuler une ligne" });
  await preview.getByLabel("Code de taxe par défaut").selectOption({ label: "TPS+TVQ" });
  await expect(preview.getByRole("status")).toContainText("114,98");
  await preview.getByLabel("Date du calcul").fill("2019-01-01");
  await expect(preview.getByRole("status")).toContainText("Choisissez un code");
  await preview.getByLabel("Date du calcul").fill("2026-01-01");
  await expectNoPageOverflow(page);
  const future = page.getByRole("heading", { name: "Planifier un taux futur", exact: true }).locator("..");
  await future.getByLabel("Taxe", { exact: true }).selectOption({ label: "TPS — TPS" });
  await future.getByLabel("Taux (%)").fill("6");
  await future.getByLabel("Date d’effet").fill("2990-01-01");
  await future.getByRole("button", { name: "Planifier un taux futur", exact: true }).click();
  await expect(page.getByText("6 % · 2990-01-01 → sans date de fin", { exact: true })).toBeVisible();
  await captureReference(page, "taxes");
  await openSection(page, "Produits et services");
  await page.getByRole("link", { name: "Nouvel article" }).click();
  await page.getByLabel("Nom de l’article").fill("Consultation comptable");
  await page.getByLabel("Code", { exact: true }).fill("CONS");
  await page.getByLabel("Prix unitaire (CAD)").fill("125,123456");
  await page.getByLabel("Code de taxe par défaut").selectOption({ label: "TPS+TVQ — Taxes Québec" });
  await page.getByRole("button", { name: "Enregistrer l’article" }).click();
  await expect(page.getByRole("heading", { name: "Consultation comptable" })).toBeVisible();
  await page.getByRole("button", { name: "Archiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restaurer", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restaurer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archiver", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Retour au catalogue" }).click();
  await expect(page.getByText(/125[,.]123456/)).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "catalogue");
}

async function companyJourney(page: Page) {
  await openSection(page, "Entreprise");
  await page.getByLabel("Nom légal", { exact: true }).fill("Atelier Exemple inc.");
  await page.getByLabel("Adresse", { exact: true }).fill("123 rue Exemple");
  await page.getByLabel("Ville", { exact: true }).fill("Montréal");
  await page.getByLabel("Code postal", { exact: true }).fill("h2x1y4");
  await page.getByLabel("Numéro de TPS/TVH", { exact: true }).fill("invalid");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Adresse", { exact: true })).toHaveValue("123 rue Exemple");
  await page.getByLabel("Numéro de TPS/TVH", { exact: true }).fill("123 456 789 rt 0001");
  await page.getByLabel("Numéro de TVQ", { exact: true }).fill("1234567890 tq 0001");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Réglages enregistrés.");
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Numéro de TPS/TVH", { exact: true })).toHaveValue("123456789RT0001");
  await expect(page.getByLabel("Code postal", { exact: true })).toHaveValue("H2X 1Y4");
  await expectNoPageOverflow(page);
  await captureReference(page, "entreprise");
}

async function draftsJourney(page: Page) {
  await openSection(page, "Brouillons de factures");
  await page.getByRole("link", { name: "Nouveau brouillon", exact: true }).click();
  await page.getByLabel("Client", { exact: true }).selectOption({ label: "Atelier Boréal" });
  await page.getByLabel("Référence", { exact: true }).fill("PROJET-2026-001");
  await page.getByLabel("Date de facture", { exact: true }).fill("2019-06-01");
  await page.getByLabel("Date d’échéance", { exact: true }).fill("2026-07-01");
  const first = page.getByRole("group", { name: "Ligne 1", exact: true });
  await first.getByLabel("Article du catalogue").selectOption({ label: "Consultation comptable" });
  await first.getByLabel("Prix unitaire (CAD)").fill("100");
  await first.getByLabel("Compte de revenus").selectOption({ label: "4000 — Revenus de services" });
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Un taux fiscal manque");
  await expect(first.getByLabel("Prix unitaire (CAD)")).toHaveValue("100");
  await expect(first.getByLabel("Article du catalogue").locator("option:checked")).toHaveText("Consultation comptable");
  await expect(first.getByLabel("Compte de revenus").locator("option:checked")).toHaveText("4000 — Revenus de services");
  await expect(first.getByLabel("Code de taxe").locator("option:checked")).toHaveText("TPS+TVQ");
  await page.getByLabel("Date de facture", { exact: true }).fill("2026-06-01");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByRole("heading", { name: "PROJET-2026-001", exact: true })).toBeVisible();
  await expect(page.getByText(/Total:.*114,98/)).toBeVisible();
  const draftUrl = page.url();
  await page.getByRole("link", { name: "Modifier le brouillon" }).click();
  await page.getByRole("group", { name: "Ligne 1", exact: true }).getByLabel("Quantité").fill("2");
  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  const second = page.getByRole("group", { name: "Ligne 2", exact: true });
  await second.getByLabel("Description").fill("Préparation du dossier");
  await second.getByLabel("Prix unitaire (CAD)").fill("10");
  await second.getByLabel("Compte de revenus").selectOption({ label: "4000 — Revenus de services" });
  await second.getByLabel("Code de taxe").selectOption({ label: "TPS+TVQ" });
  await captureReference(page, "facture-formulaire");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page).toHaveURL(draftUrl);
  await expect(page.getByText(/Total:.*241,45/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Préparation du dossier" })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "facture-brouillon");
  await page.getByRole("link", { name: "Retour aux brouillons" }).click();
  await expectNoPageOverflow(page);
  await captureReference(page, "factures");
}

async function postingJourney(page: Page) {
  await openSection(page, "Brouillons de factures");
  await page.getByRole("link", { name: /PROJET-2026-001/ }).click();
  await page.locator("summary", { hasText: "Valider la facture" }).click();
  await page.getByLabel("Date comptable", { exact: true }).fill("2026-05-01");
  await page.getByLabel("Je confirme les montants et la validation définitive.").check();
  await page.getByRole("button", { name: "Valider la facture", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await page.getByLabel("Date comptable", { exact: true }).fill("2026-06-01");
  await page.getByLabel("Je confirme les montants et la validation définitive.").check();
  await captureReference(page, "validation-facture");
  await page.getByRole("button", { name: "Valider la facture", exact: true }).click();
  await expect(page.getByRole("heading", { name: "F-00001", exact: true })).toBeVisible();
  await expect(page.getByText(/Total:.*241,45/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Modifier le brouillon" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Facture comptabilisée", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "facture-validee");

  const invoiceEmail=page.getByRole("region",{name:"Envoi par courriel",exact:true});
  await expect(invoiceEmail.getByText("Aucune tentative d’envoi.", {exact:true})).toBeVisible();
  await invoiceEmail.locator("summary").click();
  await invoiceEmail.getByLabel("Adresse du destinataire",{exact:true}).fill("client@example.test");
  await invoiceEmail.getByLabel("J’ai vérifié le destinataire et je confirme cet envoi.",{exact:true}).check();
  await invoiceEmail.getByRole("button",{name:"Confirmer et envoyer",exact:true}).click();
  await expect(invoiceEmail.getByText("Accepté par le serveur SMTP — livraison non confirmée",{exact:true})).toBeVisible();
  expect(relay.messages).toHaveLength(1);
  expect(relay.messages[0]).toContain("client@example.test");
  expect(relay.messages[0]).toContain("multipart/alternative");
  await expectNoPageOverflow(page);
  await captureReference(page,"courriel-facture","Envoi par courriel");

  const salesEvidence=page.getByRole("region", { name:"Justificatifs", exact:true });
  await salesEvidence.getByLabel("Fichier justificatif", { exact:true }).setInputFiles({name:"bon-client.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=","base64")});
  await salesEvidence.getByRole("button", { name:"Ajouter le justificatif",exact:true }).click();
  const salesLink=salesEvidence.getByRole("link", { name:"bon-client.png",exact:true });
  await expect(salesLink).toBeVisible();
  expect(await salesLink.getAttribute("href")).toContain("/justificatifs-ventes/");
  const salesDownload=await page.request.get((await salesLink.getAttribute("href"))!);
  expect(salesDownload.status()).toBe(200);
  expect(salesDownload.headers()["content-disposition"]).toContain("attachment;");
  expect(salesDownload.headers()["cache-control"]).toContain("no-store");
  expect((await salesDownload.body()).length).toBe(68);
  await expectNoPageOverflow(page);
  await captureReference(page,"justificatif-client","Justificatifs");
  const printSourceUrl = page.url();
  await page.getByRole("link", { name: "Version imprimable", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Facture F-00001", exact: true })).toBeVisible();
  await expect(page.locator(".invoice-paper")).toContainText("241,45");
  await expectNoPageOverflow(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".workspace-header")).toBeHidden();
  await expect(page.locator(".print-controls")).toBeHidden();
  await expect(page.locator(".invoice-paper")).toBeVisible();
  await captureReference(page, "facture-imprimable");
  await page.emulateMedia({ media: "screen" });
  await page.goto(printSourceUrl);

  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("dark");
  await expect(page.getByText("Posted invoice", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "facture-validee-en-dark");
  const invoiceUrl = page.url();
  await page.getByRole("link", { name: "View journal entry" }).click();
  await expect(page.getByRole("heading", { name: "Entry J-00003", exact: true })).toBeVisible();
  await page.goto(invoiceUrl);
  const creditUrl = await creditDraftJourney(page);
  await page.goto(invoiceUrl);
  await page.locator("summary", { hasText: "Void invoice" }).click();
  await page.getByLabel("Reversal date", { exact: true }).fill("2026-05-01");
  await page.getByLabel("Reason", { exact: true }).fill("Duplicate invoice");
  await page.getByLabel("I confirm permanently voiding this invoice.").check();
  await page.getByRole("button", { name: "Void invoice", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Duplicate invoice");
  await page.getByLabel("Reversal date", { exact: true }).fill("2026-07-02");
  await page.getByLabel("I confirm permanently voiding this invoice.").check();
  await page.getByRole("button", { name: "Void invoice", exact: true }).click();
  await expect(page.getByText("Voided invoice", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Void invoice", exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await captureReference(page, "facture-annulee-en-dark");
  await page.getByRole("link", { name: "View reversal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Entry J-00004", exact: true })).toBeVisible();
  await page.goto(invoiceUrl);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await page.getByRole("combobox", { name: "Apparence", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("Facture annulée", { exact: true })).toBeVisible();
  await captureReference(page, "facture-annulee");
  await page.goto(creditUrl);
  await expect(page.getByRole("status")).toContainText("n’est plus validée");
  await expect(page.getByRole("link", { name: "Modifier l’avoir", exact: true })).toHaveCount(0);
  await page.locator("summary", { hasText: "Supprimer le brouillon d’avoir" }).click();
  await page.getByLabel("Je confirme la suppression de ce brouillon d’avoir.").check();
  await page.getByRole("button", { name: "Supprimer le brouillon d’avoir", exact: true }).click();
  await expect(page.getByText(/Aucun brouillon d’avoir/)).toBeVisible();
  await page.goto(invoiceUrl);
  await page.getByRole("link", { name: "Factures validées", exact: true }).click();
  await expect(page.getByRole("link", { name: /F-00001/ })).toContainText("Facture annulée");
}

async function creditDraftJourney(page: Page) {
  await page.getByRole("link", { name: "Prepare a credit note", exact: true }).click();
  await page.getByLabel("Credit note date", { exact: true }).fill("2026-07-01");
  await page.getByLabel("Credit note reason", { exact: true }).fill("Partial service adjustment");
  await page.getByLabel("Consultation comptable", { exact: true }).fill("201");
  await page.getByRole("button", { name: "Save credit note draft", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Credit note reason", { exact: true })).toHaveValue("Partial service adjustment");
  await expect(page.getByLabel("Consultation comptable", { exact: true })).toHaveValue("201");
  await page.getByLabel("Consultation comptable", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Save credit note draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Draft credit note", exact: true })).toBeVisible();
  await expect(page.getByText(/Total:.*57.49/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Préparation du dossier" })).toHaveCount(0);
  const url = page.url();
  await page.reload();
  await expectNoPageOverflow(page);
  await captureReference(page, "avoir-brouillon-en-dark");
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await page.getByRole("combobox", { name: "Apparence", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Modifier l’avoir", exact: true }).click();
  await expect(page.getByLabel("Consultation comptable", { exact: true })).toHaveValue("50.00");
  await page.getByLabel("Motif de l’avoir", { exact: true }).fill("Ajustement partiel du service");
  await captureReference(page, "avoir-formulaire");
  await page.getByRole("button", { name: "Enregistrer le brouillon d’avoir", exact: true }).click();
  await expect(page).toHaveURL(url);
  await expectNoPageOverflow(page);
  await captureReference(page, "avoir-brouillon");
  await page.getByRole("link", { name: "Brouillons d’avoirs", exact: true }).click();
  await expect(page.getByRole("link", { name: /Ajustement partiel du service/ })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  return url;
}

async function creditPostingJourney(page: Page): Promise<string> {
  await openSection(page,"Brouillons de factures");
  await page.getByRole("link",{name:"Nouveau brouillon",exact:true}).click();
  await page.getByLabel("Client",{exact:true}).selectOption({label:"Atelier Boréal"});
  await page.getByLabel("Date de facture",{exact:true}).fill("2026-06-01");
  await page.getByLabel("Date d’échéance",{exact:true}).fill("2026-07-01");
  const line=page.getByRole("group",{name:"Ligne 1",exact:true});
  await line.getByLabel("Article du catalogue").selectOption({label:"Consultation comptable"});
  await line.getByLabel("Prix unitaire (CAD)").fill("100");
  await line.getByLabel("Compte de revenus").selectOption({label:"4000 — Revenus de services"});
  await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();
  await page.locator("summary",{hasText:"Valider la facture"}).click();
  await page.getByLabel("Date comptable",{exact:true}).fill("2026-06-01");
  await page.getByLabel("Je confirme les montants et la validation définitive.").check();
  await page.getByRole("button",{name:"Valider la facture",exact:true}).click();
  await expect(page.getByRole("heading",{name:"F-00002",exact:true})).toBeVisible();
  const invoiceUrl=page.url();
  await page.getByRole("link",{name:"Préparer un avoir",exact:true}).click();
  await page.getByLabel("Date de l’avoir",{exact:true}).fill("2026-06-02");
  await page.getByLabel("Motif de l’avoir",{exact:true}).fill("Ajustement du service");
  await page.getByLabel("Consultation comptable",{exact:true}).fill("25");
  await page.getByRole("button",{name:"Enregistrer le brouillon d’avoir",exact:true}).click();
  await page.locator("summary",{hasText:"Valider l’avoir"}).click();
  await page.getByLabel("Date comptable",{exact:true}).fill("2026-06-01");
  await page.getByLabel("Je confirme les montants et le traitement choisi pour cet avoir.").check();
  await page.getByRole("button",{name:"Valider l’avoir",exact:true}).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await page.getByLabel("Date comptable",{exact:true}).fill("2026-06-02");
  await page.getByLabel("Je confirme les montants et le traitement choisi pour cet avoir.").check();
  await captureReference(page,"validation-avoir");
  await page.getByRole("button",{name:"Valider l’avoir",exact:true}).click();
  await expect(page.getByRole("heading",{name:"AV-00001",exact:true})).toBeVisible();
  await expect(page.getByText(/Total:.*28,74/)).toBeVisible();
  await expect(page.getByRole("link",{name:"Modifier l’avoir",exact:true})).toHaveCount(0);
  const creditUrl=page.url();await page.reload();await expectNoPageOverflow(page);await captureReference(page,"avoir-valide");
  await page.goto(invoiceUrl);await expect(page.getByText(/Solde restant:.*86,24/)).toBeVisible();
  await expect(page.getByRole("link",{name:/AV-00001/})).toBeVisible();
  await captureReference(page,"facture-avec-avoir");
  await page.goto(creditUrl);
  await page.getByRole("button",{name:"English",exact:true}).click();
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await expect(page.getByRole("combobox",{name:"Appearance",exact:true})).toHaveValue("dark");
  await expect(page.getByText("Posted credit note",{exact:true})).toBeVisible();
  await expectNoPageOverflow(page);await captureReference(page,"avoir-valide-en-dark");
  await page.getByRole("link",{name:"View journal entry",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Entry J-00006",exact:true})).toBeVisible();
  await page.goto(creditUrl);
  await page.locator("summary",{hasText:"Void credit note"}).click();
  await page.getByLabel("Reversal date",{exact:true}).fill("2026-06-01");
  await page.getByLabel("Reason",{exact:true}).fill("Incorrect adjustment");
  await page.getByLabel("I confirm permanently voiding this credit note.").check();
  await page.getByRole("button",{name:"Void credit note",exact:true}).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await page.getByLabel("Reversal date",{exact:true}).fill("2026-06-03");
  await page.getByLabel("I confirm permanently voiding this credit note.").check();
  await page.getByRole("button",{name:"Void credit note",exact:true}).click();
  await expect(page.getByText("Voided credit note",{exact:true})).toBeVisible();
  await expect(page.getByText("Unapplied on 2026-06-03",{exact:true})).toBeVisible();
  await expect(page.locator("summary",{hasText:"Void credit note"})).toHaveCount(0);
  await expectNoPageOverflow(page);await captureReference(page,"avoir-annule-en-dark");
  await page.getByRole("button",{name:"Français",exact:true}).click();
  await page.getByRole("combobox",{name:"Apparence",exact:true}).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  await captureReference(page,"avoir-annule");
  await page.goto(invoiceUrl);await expect(page.getByText(/Solde restant:.*114,98/)).toBeVisible();
  await page.goto(creditUrl);
  await page.getByRole("button",{name:"English",exact:true}).click();
  await page.getByRole("link",{name:"Posted credit notes",exact:true}).click();
  await expect(page.getByRole("link",{name:/AV-00001/})).toBeVisible();
  await page.getByRole("button",{name:"Français",exact:true}).click();
  await page.getByRole("combobox",{name:"Apparence",exact:true}).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  return invoiceUrl;
}

/**
 * Payments received on the posted invoice F-00002 (open balance 114,98 $ after its credit note was voided): a refused
 * overpayment that keeps what was typed, two partial payments, a void that restores the balance, and the list in both
 * languages.
 */
async function paymentsJourney(page: Page, invoiceUrl: string) {
  const alert = (text: string) => page.locator("form").getByRole("alert").filter({ hasText: text });
  const bank = "1000 · Banque – compte courant";
  const fill = async (amount: string, date: string, method = "EFT", reference = "") => {
    await page.getByLabel("Montant reçu", { exact: true }).fill(amount);
    await page.getByLabel("Date de réception", { exact: true }).fill(date);
    await page.getByLabel("Compte de réception", { exact: true }).selectOption({ label: bank });
    await page.getByLabel("Mode de paiement", { exact: true }).selectOption(method);
    if (reference) await page.getByLabel(/^Référence/).fill(reference);
  };
  await page.goto(invoiceUrl);
  await expect(page.getByText("Non payée", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucun encaissement appliqué à cette facture.")).toBeVisible();
  await page.locator("summary", { hasText: "Enregistrer un encaissement" }).click();
  // the form proposes the whole balance, in the language's own notation
  await expect(page.getByLabel("Montant reçu", { exact: true })).toHaveValue("114,98");
  await expectNoPageOverflow(page);
  await captureReference(page, "encaissement-formulaire");

  // more than the balance: refused, and what was typed stays
  await fill("200", "2026-06-15", "CHEQUE", "Chèque 1042");
  await page.getByRole("button", { name: "Enregistrer l’encaissement", exact: true }).click();
  await expect(alert("Le montant dépasse le solde restant")).toBeVisible();
  await expect(page.getByLabel("Montant reçu", { exact: true })).toHaveValue("200");
  await expect(page.getByLabel("Mode de paiement", { exact: true })).toHaveValue("CHEQUE");
  await expect(page.getByLabel(/^Référence/)).toHaveValue("Chèque 1042");

  // a first, partial payment
  await fill("50", "2026-06-15", "CHEQUE", "Chèque 1042");
  await page.getByRole("button", { name: "Enregistrer l’encaissement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Encaissement E-00001", exact: true })).toBeVisible();
  await expect(page.getByText("Chèque 1042", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /50,00.*F-00002/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "encaissement");
  await page.goto(invoiceUrl);
  await expect(page.getByText("Partiellement payée", { exact: true })).toBeVisible();
  await expect(page.getByText(/Solde restant:.*64,98/)).toBeVisible();
  await expect(page.getByRole("link", { name: "E-00001", exact: true })).toBeVisible();

  // the rest: the invoice is paid and the form is gone
  await page.locator("summary", { hasText: "Enregistrer un encaissement" }).click();
  await expect(page.getByLabel("Montant reçu", { exact: true })).toHaveValue("64,98");
  await fill("64,98", "2026-06-20");
  await page.getByRole("button", { name: "Enregistrer l’encaissement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Encaissement E-00002", exact: true })).toBeVisible();
  const secondUrl = page.url();
  await page.goto(invoiceUrl);
  await expect(page.getByText("Payée", { exact: true })).toBeVisible();
  await expect(page.getByText("Cette facture est payée en entier.")).toBeVisible();
  await expect(page.locator("summary", { hasText: "Enregistrer un encaissement" })).toHaveCount(0);
  await captureReference(page, "facture-payee");

  // voiding the second payment: a date before it is refused, then it restores the balance and keeps the reason
  await page.goto(secondUrl);
  await page.locator("summary", { hasText: "Annuler cet encaissement" }).click();
  await page.getByLabel("Date d’annulation", { exact: true }).fill("2026-06-10");
  await page.getByLabel("Motif (obligatoire, 500 caractères au plus)", { exact: true }).fill("Chèque sans provision");
  await page.getByLabel("Je confirme l’annulation définitive de cet encaissement.").check();
  await page.getByRole("button", { name: "Annuler l’encaissement", exact: true }).click();
  await expect(alert("égale ou postérieure à l’encaissement")).toBeVisible();
  await expect(page.getByLabel("Motif (obligatoire, 500 caractères au plus)", { exact: true })).toHaveValue("Chèque sans provision");
  await page.getByLabel("Date d’annulation", { exact: true }).fill("2026-06-25");
  await page.getByLabel("Je confirme l’annulation définitive de cet encaissement.").check();
  await page.getByRole("button", { name: "Annuler l’encaissement", exact: true }).click();
  await expect(page.getByText("Annulé le 2026-06-25")).toBeVisible();
  await expect(page.getByText("Motif : Chèque sans provision")).toBeVisible();
  await expect(page.locator("summary", { hasText: "Annuler cet encaissement" })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await captureReference(page, "encaissement-annule");
  await page.goto(invoiceUrl);
  await expect(page.getByText("Partiellement payée", { exact: true })).toBeVisible();
  await expect(page.getByText(/Solde restant:.*64,98/)).toBeVisible();
  await expect(page.getByRole("link", { name: "E-00002", exact: true })).toHaveCount(0);

  // the list, from the Sales area, in both languages
  await openSection(page, "Ventes");
  await page.getByRole("link", { name: "Encaissements", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Encaissements", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /E-00001/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /E-00002.*Annulé/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "encaissements");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payments received", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /E-00002.*Voided/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Encaissements", exact: true })).toBeVisible();
}

/**
 * Seeds a Stripe connection and its imported transactions straight into the browser-test database. The live service
 * cannot be reached from a test (the server calls it, not the browser), and the sync itself is covered with fakes in
 * the integration tests; what is left to prove here is what a person sees and does.
 */
async function seedStripeConnection(companyId: string) {
  const db = new pg.Client({ connectionString: e2eUrls().owner });
  await db.connect();
  try {
    const account = (await db.query("SELECT id FROM account WHERE company_id = $1 AND subtype = 'BANK' ORDER BY code LIMIT 1", [companyId])).rows[0].id as string;
    const user = (await db.query("SELECT id FROM app_user WHERE email = $1", [EMAIL])).rows[0].id as string;
    const connection = (await db.query(
      `INSERT INTO integration_connection (id, company_id, provider, label, account_id, status, credentials_hint, import_from, created_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, 'STRIPE', 'Stripe boutique', $2, 'ACTIVE', 'ab12', '2026-01-01', $3, now()) RETURNING id`, [companyId, account, user])).rows[0].id as string;
    // Not a real ciphertext: a sync must refuse it with a message, before it calls anybody.
    await db.query("INSERT INTO integration_credential (id, company_id, connection_id, credentials_enc, updated_at) VALUES (gen_random_uuid(), $1, $2, decode('0102030405060708090a0b0c0d0e0f10', 'hex'), now())", [companyId, connection]);
    const row = (external: string, date: string, net: number, gross: number, fee: number, type: string, description: string, kind: string, extra: Record<string, unknown> = {}) =>
      db.query(
        `INSERT INTO bank_transaction (id, company_id, account_id, txn_date, amount_cents, description, external_id, dedupe_key, connection_id, currency, source_type, gross_cents, fee_cents, provider_details, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3::date, $4::bigint, $5, $6, $6, $7, 'CAD', $8, $9::bigint, $10::bigint, $11::jsonb, now())`,
        [companyId, account, date, net, description, `stripe:${external}`, connection, type, gross, fee, JSON.stringify({ kind, ...extra })]);
    await row("txn_e2e_1", "2026-06-10", 9680, 10000, 320, "charge", "Facture F-00002", "PAYMENT", { reference: "F-00002" });
    await row("txn_e2e_2", "2026-06-12", -5000, -5000, 0, "refund", "Remboursement", "REFUND");
    await row("txn_e2e_3", "2026-06-15", -4680, -4680, 0, "payout", "STRIPE PAYOUT", "PAYOUT");
    await row("txn_e2e_4", "2026-06-16", 2060, 2000, -60, "charge", "Frais au signe inhabituel", "PAYMENT", { unusualFeeSign: true });
    return connection;
  } finally {
    await db.end();
  }
}

/**
 * Integrations: the connections page, a connection's page, the transaction inbox, what a form refuses (and never
 * gives back), the message for keys that cannot be read, setting a transaction aside, disconnecting, both languages.
 */
async function integrationsJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const connectionId = await seedStripeConnection(company.slice(3));
  const alert = (text: string) => page.locator("form").getByRole("alert").filter({ hasText: text });

  await page.goto(company);
  await openSection(page, "Banque et transactions");
  await page.getByRole("link", { name: "Intégrations", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Intégrations", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Stripe boutique/ })).toContainText("4 transactions");
  await expectNoPageOverflow(page);
  await captureReference(page, "integrations");

  // what a form refuses, and never gives back: a publishable key, then a date in the future
  await page.locator("summary", { hasText: "Connecter Stripe" }).click();
  const stripe = page.locator("details", { hasText: "Connecter Stripe" });
  await stripe.getByLabel("Nom de la connexion").fill("Stripe essai");
  await stripe.getByLabel("Clé d’API Stripe").fill(`pk_live_${"a".repeat(30)}`);
  await stripe.getByRole("button", { name: "Vérifier les clés et connecter", exact: true }).click();
  await expect(alert("Vérifiez le nom, le compte, la date et les clés")).toBeVisible();
  await expect(stripe.getByLabel("Nom de la connexion")).toHaveValue("Stripe essai");
  await expect(stripe.getByLabel("Clé d’API Stripe")).toHaveValue(""); // the key is never sent back
  await stripe.getByLabel("Importer à partir du").fill("2099-01-01");
  await stripe.getByLabel("Clé d’API Stripe").fill(`sk_live_${"a1B2c3D4e5".repeat(3)}`);
  await stripe.getByRole("button", { name: "Vérifier les clés et connecter", exact: true }).click();
  await expect(alert("Choisissez un jour réel")).toBeVisible();
  await expect(stripe.getByLabel("Clé d’API Stripe")).toHaveValue("");
  const paypal = page.locator("details", { hasText: "Connecter PayPal" });
  await page.locator("summary", { hasText: "Connecter PayPal" }).click();
  await paypal.getByLabel("Environnement").selectOption("sandbox");
  await paypal.getByLabel("Identifiant client PayPal").fill("trop-court");
  await paypal.getByLabel("Secret client PayPal").fill("court");
  await paypal.getByRole("button", { name: "Vérifier les clés et connecter", exact: true }).click();
  await expect(alert("Vérifiez le nom, le compte, la date et les clés")).toBeVisible();
  await expect(paypal.getByLabel("Environnement")).toHaveValue("sandbox");
  await expect(paypal.getByLabel("Identifiant client PayPal")).toHaveValue("trop-court");
  await expect(paypal.getByLabel("Secret client PayPal")).toHaveValue("");

  // the connection's page; keys that cannot be read are refused before any call, and the failure stays on the page
  await page.goto(`${company}/integrations/${connectionId}`);
  await expect(page.getByRole("heading", { name: "Stripe boutique", exact: true })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("…ab12", { exact: true })).toBeVisible();
  await expect(page.getByText("Jamais", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "integration-connexion");
  await page.getByRole("button", { name: "Synchroniser maintenant", exact: true }).click();
  await expect(alert("Les clés enregistrées sont illisibles")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "La dernière synchronisation a échoué. Les clés enregistrées sont illisibles" })).toBeVisible();
  await page.locator("summary", { hasText: "Remplacer les clés" }).click();
  await page.getByLabel("Clé d’API Stripe").fill("pas une clé");
  await page.getByRole("button", { name: "Vérifier et remplacer", exact: true }).click();
  await expect(alert("Vérifiez le nom, le compte, la date et les clés")).toBeVisible();

  // the inbox: net amount, gross and fee, the flag, setting a transaction aside and bringing it back
  await page.getByRole("link", { name: /4 transactions/ }).click();
  await expect(page.getByRole("heading", { name: "Transactions bancaires", exact: true })).toBeVisible();
  await expect(page.getByText("4 transactions", { exact: true })).toBeVisible();
  const first = page.locator("li").filter({ hasText: "Facture F-00002" });
  await expect(first).toContainText("96,80");
  await expect(first).toContainText("Brut 100,00 $ · Frais 3,20 $");
  await expect(first).toContainText("Référence : F-00002");
  await expect(page.locator("li").filter({ hasText: "Remboursement" })).toContainText("-50,00");
  await expect(page.getByRole("note").filter({ hasText: "le signe des frais est inhabituel" })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "transactions-importees");
  await page.getByRole("button", { name: "Mettre de côté : Facture F-00002", exact: true }).click();
  await expect(first).toContainText("Mise de côté");
  await page.getByRole("combobox", { name: /^État/ }).selectOption("EXCLUDED");
  await page.getByRole("button", { name: "Filtrer", exact: true }).click();
  await expect(page.getByText("1 transaction", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remettre à traiter : Facture F-00002", exact: true }).click();
  await expect(page.getByText("Aucune transaction", { exact: true })).toBeVisible();

  // disconnecting keeps what was imported and takes the key away
  await page.goto(`${company}/integrations/${connectionId}`);
  await page.locator("summary", { hasText: "Déconnecter" }).click();
  await expect(page.getByLabel("Je confirme la déconnexion.")).toHaveAttribute("required", ""); // the browser refuses an unconfirmed submit
  await page.getByLabel("Je confirme la déconnexion.").check();
  await page.getByRole("button", { name: "Déconnecter le service", exact: true }).click();
  await expect(page.getByText("Déconnectée", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Synchroniser maintenant", exact: true })).toHaveCount(0);
  await expect(page.getByText("…ab12")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /4 transactions/ })).toBeVisible();

  // English
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("link", { name: "Back to integrations" })).toBeVisible();
  await page.getByRole("link", { name: /4 transactions/ }).click();
  await expect(page.getByRole("heading", { name: "Bank transactions", exact: true })).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "STRIPE PAYOUT" })).toContainText("Payout");
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transactions bancaires", exact: true })).toBeVisible();
}

/**
 * Seeds a Stripe connection whose keys cannot be read, and, on demand, a live payment link on an invoice. The service
 * is called by the server, not by the browser, so a test cannot reach it; what is left to prove here is what a person
 * sees and does: the choice of the fee account, the refusal that keeps a link pending, the live link and its address,
 * a payment under review, cancelling, both languages.
 */
async function seedOnlineConnection(companyId: string) {
  const db = new pg.Client({ connectionString: e2eUrls().owner });
  await db.connect();
  try {
    const account = (await db.query("SELECT id FROM account WHERE company_id = $1 AND subtype = 'BANK' ORDER BY code LIMIT 1", [companyId])).rows[0].id as string;
    const user = (await db.query("SELECT id FROM app_user WHERE email = $1", [EMAIL])).rows[0].id as string;
    const connection = (await db.query(
      `INSERT INTO integration_connection (id, company_id, provider, label, account_id, status, credentials_hint, import_from, created_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, 'STRIPE', 'Stripe en ligne', $2, 'ACTIVE', 'cd34', '2026-01-01', $3, now()) RETURNING id`, [companyId, account, user])).rows[0].id as string;
    await db.query("INSERT INTO integration_credential (id, company_id, connection_id, credentials_enc, updated_at) VALUES (gen_random_uuid(), $1, $2, decode('0102030405060708090a0b0c0d0e0f10', 'hex'), now())", [companyId, connection]);
    return connection;
  } finally {
    await db.end();
  }
}

async function seedPaymentLink(companyId: string, connectionId: string, invoiceId: string, state: "ACTIVE" | "REVIEW") {
  const db = new pg.Client({ connectionString: e2eUrls().owner });
  await db.connect();
  try {
    const user = (await db.query("SELECT id FROM app_user WHERE email = $1", [EMAIL])).rows[0].id as string;
    const id = (await db.query(
      `INSERT INTO payment_link (id, company_id, invoice_id, connection_id, amount_cents, created_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 6498, $4, now()) RETURNING id`, [companyId, invoiceId, connectionId, user])).rows[0].id as string;
    await db.query("UPDATE payment_link SET status = 'ACTIVE', external_price_id = 'price_e2e', external_id = 'plink_e2e', url = 'https://buy.stripe.com/test_e2e', updated_at = now() WHERE id = $1", [id]);
    if (state === "REVIEW") await db.query("UPDATE payment_link SET status = 'REVIEW', review_reason = 'payments.exceeds', updated_at = now() WHERE id = $1", [id]);
    return id;
  } finally {
    await db.end();
  }
}

async function onlinePaymentsJourney(page: Page, invoiceUrl: string) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const invoiceId = new URL(invoiceUrl, page.url()).pathname.split("/").at(-1) ?? "";
  const connectionId = await seedOnlineConnection(company.slice(3));
  const alert = (text: string) => page.locator("form").getByRole("alert").filter({ hasText: text });
  const panel = page.getByRole("region", { name: "Paiement en ligne", exact: true });

  // no fee account yet: the invoice offers no link, and says what to do
  await page.goto(invoiceUrl);
  await expect(panel).toContainText("Aucune connexion Stripe n’est prête");
  await expect(panel.getByRole("link", { name: "Aller aux intégrations" })).toBeVisible();

  // the owner chooses where Stripe's fees are booked
  await page.goto(`${company}/integrations/${connectionId}`);
  await expect(page.getByRole("heading", { name: "Paiement en ligne des factures", exact: true })).toBeVisible();
  await expect(page.getByText("Non choisi", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vérifier les paiements en ligne", exact: true })).toHaveCount(0);
  await page.getByLabel("Compte des frais de traitement").selectOption({ label: "6010 · Frais bancaires" });
  await page.getByRole("button", { name: "Enregistrer le compte", exact: true }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("6010 · Frais bancaires", { exact: true }).first()).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "paiement-en-ligne-connexion", "Paiement en ligne des factures");
  // nothing to look at yet: no call, and the page says so
  await page.getByRole("button", { name: "Vérifier les paiements en ligne", exact: true }).click();
  await expect(page.getByText("Vérification terminée : aucun nouveau paiement.")).toBeVisible();

  // a link needs the keys too: refused, and the link stays pending with the reason so it can be resumed
  await page.goto(invoiceUrl);
  await expect(panel).toBeVisible();
  await panel.locator("summary", { hasText: "Créer un lien de paiement" }).click();
  await expect(panel.getByText(/Le lien vaut pour le solde actuel, 64,98/)).toBeVisible();
  await panel.getByRole("button", { name: "Créer le lien", exact: true }).click();
  await expect(alert("Les clés enregistrées sont illisibles")).toBeVisible();
  await page.goto(invoiceUrl);
  await expect(panel.getByText(/^En préparation · /)).toBeVisible();
  await expect(panel).toContainText("Ce lien n’a pas pu être créé chez Stripe");
  await expect(panel).toContainText("Les clés enregistrées sont illisibles");
  await expect(panel.getByRole("button", { name: "Reprendre la création", exact: true })).toBeVisible();
  await expect(panel.locator("summary", { hasText: "Créer un lien de paiement" })).toHaveCount(0); // one live link per invoice
  await expectNoPageOverflow(page);
  await panel.getByRole("button", { name: "Annuler le lien", exact: true }).click();
  await expect(panel.getByText("Lien annulé.")).toBeVisible();
  await expect(panel.getByText(/^Annulé · /)).toBeVisible();

  // a live link: its address, the buttons, and no second link; the check is refused without readable keys
  const linkId = await seedPaymentLink(company.slice(3), connectionId, invoiceId, "ACTIVE");
  await page.goto(invoiceUrl);
  await expect(panel.getByText(/^Prêt à payer · /)).toBeVisible();
  await expect(panel.getByRole("link", { name: "https://buy.stripe.com/test_e2e" })).toHaveAttribute("href", "https://buy.stripe.com/test_e2e");
  await expect(panel.getByRole("link", { name: "https://buy.stripe.com/test_e2e" })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(panel.locator("summary", { hasText: "Créer un lien de paiement" })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await captureReference(page, "paiement-en-ligne-facture", "Paiement en ligne");
  await panel.getByRole("button", { name: "Vérifier le paiement", exact: true }).click();
  await expect(alert("Les clés enregistrées sont illisibles")).toBeVisible();

  // a payment that could not be booked: the reason, and nothing was recorded
  const db = new pg.Client({ connectionString: e2eUrls().owner });
  await db.connect();
  try {
    await db.query("UPDATE payment_link SET status = 'REVIEW', review_reason = 'payments.exceeds', updated_at = now() WHERE id = $1", [linkId]);
  } finally {
    await db.end();
  }
  await page.goto(invoiceUrl);
  await expect(panel.getByText(/^À vérifier · /)).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText("Allumi n’a rien enregistré : Le montant dépasse le solde restant de la facture.");
  await expect(page.getByText(/Solde restant:.*64,98/)).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "paiement-en-ligne-a-verifier", "Paiement en ligne");
  await panel.getByRole("button", { name: "Fermer ce signalement", exact: true }).click();
  await expect(panel.getByText("Lien annulé.")).toBeVisible();

  // English
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("region", { name: "Online payment", exact: true })).toContainText("Create a payment link");
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(panel).toBeVisible();
}

const file = (name: string, text: string, mimeType = "text/csv") => ({ name, mimeType, buffer: Buffer.from(text, "utf-8") });

/**
 * Bank statements: the import page with its preview and the choice of columns, a French CSV with two amount columns,
 * what is refused (a wrong decimal separator, the same file twice, another currency), statements that overlap, an
 * OFX file, setting a line aside, both languages, and no overflow.
 */
async function bankImportJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const alert = (text: string) => page.locator("form").getByRole("alert").filter({ hasText: text });
  const bank = "1000 · Banque – compte courant";
  const upload = async (name: string, text: string, mimeType?: string) => page.getByLabel(/^(Fichier du relevé|Statement file)/).setInputFiles(file(name, text, mimeType));

  await page.goto(`${company}/transactions`);
  await expect(page.getByRole("heading", { name: "Transactions bancaires", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Importer un relevé", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Importer un relevé", exact: true })).toBeVisible();
  await page.getByLabel("Compte du plan comptable").selectOption({ label: bank });
  await expectNoPageOverflow(page);

  // a French statement: the columns are recognised and the preview shows what will be read
  const statement = "Date;Description;Retrait;Dépôt;Solde\n15/10/2026;ACHAT BOUTIQUE LÉVESQUE;12,30;;987,70\n16/10/2026;PAIE OCTOBRE;;1 500,00;2 487,70\n17/10/2026;ABONNEMENT LOGICIEL;29,99;;2 457,71\n";
  await upload("releve-octobre.csv", statement);
  await expect(page.getByText("Format détecté : CSV")).toBeVisible();
  await expect(page.getByText(/3 transactions du 2026-10-15 au 2026-10-17 · entrées 1\s500,00\s\$ · sorties 42,29\s\$/)).toBeVisible();
  await expect(page.getByText(/2026-10-15 · ACHAT BOUTIQUE LÉVESQUE/)).toBeVisible();
  await expect(page.getByLabel("Ordre de la date")).toHaveValue("DMY");
  await expect(page.getByLabel("Séparateur décimal")).toHaveValue(",");
  await expect(page.getByLabel("Montants")).toHaveValue("split");
  await expectNoPageOverflow(page);
  await captureReference(page, "releves-import", "Importer un relevé");

  // a wrong choice shows at once, row by row, and the import is refused while any row is unreadable
  await page.getByLabel("Séparateur décimal").selectOption(".");
  await expect(page.locator("form").getByRole("alert").filter({ hasText: "3 lignes sont illisibles" })).toBeVisible();
  await expect(page.locator("form").getByRole("alert")).toContainText("Ligne 2 : montant illisible");
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(alert("Certaines lignes du fichier sont illisibles")).toBeVisible();
  await page.getByLabel("Séparateur décimal").selectOption(",");
  await expect(page.locator("form").getByRole("alert")).toHaveCount(1); // only the refusal of the form remains until the next attempt

  // the import: the new lines, in exact amounts, on the transactions page
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transactions bancaires", exact: true })).toBeVisible();
  await expect(page.getByText("Import terminé : 3 nouvelles transactions.")).toBeVisible();
  const purchase = page.locator("li").filter({ hasText: "ACHAT BOUTIQUE LÉVESQUE" });
  await expect(purchase).toContainText("-12,30");
  await expect(purchase).toContainText("Relevé : releve-octobre.csv");
  await expect(page.locator("li").filter({ hasText: "PAIE OCTOBRE" })).toContainText("1 500,00");
  await expectNoPageOverflow(page);
  await captureReference(page, "releves-transactions");

  // the same file twice is refused; an overlapping one adds only what is new
  await page.getByRole("link", { name: "Importer un relevé", exact: true }).first().click();
  await page.getByLabel("Compte du plan comptable").selectOption({ label: bank });
  await upload("releve-octobre-bis.csv", statement);
  await expect(page.getByLabel("Ordre de la date")).toHaveValue("DMY"); // the columns of the last import are remembered
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(alert("Ce fichier a déjà été importé sur ce compte")).toBeVisible();
  await upload("releve-octobre-suite.csv", statement + "18/10/2026;REMBOURSEMENT;;45,00;2 502,71\n");
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(page.getByText("Import terminé : 1 nouvelle transaction.")).toBeVisible();
  await expect(page.getByText("3 lignes étaient déjà connues et n’ont pas été touchées.")).toBeVisible();

  // OFX: the bank's ids, the signs as written, the closing balance; another currency is refused
  const ofx = (currency: string, id: string) => `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>${currency}\n<BANKACCTFROM><BANKID>1<ACCTID>00123456789<ACCTTYPE>CHECKING</BANKACCTFROM>\n<BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261019120000<TRNAMT>-75.10<FITID>${id}1<NAME>EPICERIE METRO</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261020<TRNAMT>200.00<FITID>${id}2<NAME>VIREMENT RECU</STMTTRN>\n</BANKTRANLIST>\n<LEDGERBAL><BALAMT>2627.61<DTASOF>20261020</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n`;
  await page.getByRole("link", { name: "Importer un relevé", exact: true }).first().click();
  await page.getByLabel("Compte du plan comptable").selectOption({ label: bank });
  await upload("releve.ofx", ofx("USD", "U"), "application/x-ofx");
  await expect(page.getByText("Format détecté : OFX")).toBeVisible();
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(alert("Ce relevé n’est pas en dollars canadiens")).toBeVisible();
  await upload("releve-cad.ofx", ofx("CAD", "C"), "application/x-ofx");
  await expect(page.getByText(/Devise CAD · compte se terminant par 6789 · solde de clôture déclaré 2\s627,61\s\$ au 2026-10-20/)).toBeVisible();
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(page.getByText("Import terminé : 2 nouvelles transactions.")).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "EPICERIE METRO" })).toContainText("-75,10");
  await expect(page.locator("li").filter({ hasText: "EPICERIE METRO" })).toContainText("Relevé : releve-cad.ofx");

  // setting a line aside and bringing it back, and the filters
  await page.getByRole("button", { name: "Mettre de côté : ABONNEMENT LOGICIEL", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: "ABONNEMENT LOGICIEL" })).toContainText("Mise de côté");
  await page.getByLabel("Recherche", { exact: true }).fill("abonnement");
  await page.getByRole("button", { name: "Filtrer", exact: true }).click();
  await expect(page.getByText("1 transaction", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remettre à traiter : ABONNEMENT LOGICIEL", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: "ABONNEMENT LOGICIEL" })).toContainText("À traiter");

  // English
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bank transactions", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Import a statement", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Import a statement", exact: true })).toBeVisible();
  await page.getByLabel("Chart of accounts account").selectOption({ index: 0 }); // the account names are in English now
  await upload("statement.csv", "Date,Description,Amount\n2026-11-02,COFFEE,-4.50\n2026-11-03,REFUND,10.00\n");
  await expect(page.getByText(/2 transactions from 2026-11-02 to 2026-11-03 · money in \$10\.00 · money out \$4\.50/)).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Importer un relevé", exact: true })).toBeVisible();
}

/**
 * Matching statement lines to the journal: the likely entry offered in the list and matched with one click, undone,
 * several lines ticked against one deposit with the running total, a line recorded against another account, a transfer
 * between two accounts, the entry of a bank line in the journal, both languages, and no overflow. The dates are the
 * current month's, the one period the journey keeps open.
 */
async function bankMatchingJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const month = todayInToronto().slice(0, 7);
  const iso = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  const french = (day: number) => `${String(day).padStart(2, "0")}/${month.slice(5, 7)}/${month.slice(0, 4)}`;
  const bank = "1000 · Banque – compte courant";
  const cash = "1999 · Caisse secondaire (atelier)";
  const row = (text: string) => page.locator("li.rounded").filter({ has: page.getByRole("heading", { name: text, exact: true }) }); // the card of a line, not the entries listed in another
  const money = (text: string) => new RegExp(text.replace(/ /g, "\\s").replace(/\$/g, "\\$"));

  // three entries made by hand: a deposit, and a sale with its fee
  const post = async (day: number, memo: string, debit: string, credit: string, amount: string) => {
    await page.goto(`${company}/journal/nouvelle`);
    await page.getByLabel("Date", { exact: true }).fill(iso(day));
    await page.getByLabel("Description").fill(memo);
    await page.getByLabel("Ligne 1 – Compte").selectOption({ label: debit });
    await page.getByLabel("Ligne 1 – Débit").fill(amount);
    await page.getByLabel("Ligne 2 – Compte").selectOption({ label: credit });
    await page.getByLabel("Ligne 2 – Crédit").fill(amount);
    await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
    await expect(page.getByRole("heading", { name: /^Écriture J-\d{5}$/ })).toBeVisible();
  };
  await post(2, "Dépôt client Atelier", "1000 – Banque – compte courant", "4000 – Revenus de services", "1500,00");
  await post(3, "Vente Stripe", "1000 – Banque – compte courant", "4000 – Revenus de services", "100,00");
  await post(3, "Frais Stripe", "6010 – Frais bancaires", "1000 – Banque – compte courant", "3,00");

  // the statements: four lines at the bank, one at the petty cash
  const upload = async (name: string, text: string) => page.getByLabel(/^(Fichier du relevé|Statement file)/).setInputFiles(file(name, text));
  const header = "Date;Description;Retrait;Dépôt;Solde\n";
  await page.goto(`${company}/transactions/importer`);
  await page.getByLabel("Compte du plan comptable").selectOption({ label: bank });
  await upload("releve-courant.csv", `${header}${french(2)};DEPOT CLIENT ATELIER;;1 500,00;1 500,00\n${french(3)};DEPOT STRIPE;;97,00;1 597,00\n${french(4)};FRAIS DE COMPTE;15,00;;1 582,00\n${french(5)};PAIEMENT CARTE;250,00;;1 332,00\n${french(6)};DEPOT INCONNU;;10,00;1 342,00\n`);
  await expect(page.getByText("Format détecté : CSV")).toBeVisible();
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(page.getByText("Import terminé : 5 nouvelles transactions.")).toBeVisible();
  await page.goto(`${company}/transactions/importer`);
  await page.getByLabel("Compte du plan comptable").selectOption({ label: cash });
  await upload("releve-caisse.csv", `${header}${french(5)};VIREMENT CAISSE;;250,00;250,00\n`);
  await page.getByRole("button", { name: "Importer le relevé", exact: true }).click();
  await expect(page.getByText("Import terminé : 1 nouvelle transaction.")).toBeVisible();

  // the likely entry is offered on the line: same account, same amount, near in date
  await page.goto(`${company}/transactions`);
  const deposit = row("DEPOT CLIENT ATELIER");
  await expect(deposit).toContainText("Écriture probable :");
  await expect(deposit).toContainText("Dépôt client Atelier");
  await expect(row("DEPOT INCONNU")).not.toContainText("Écriture probable");
  await expectNoPageOverflow(page);
  await page.goto(`${company}/transactions?q=DEPOT`); // three cards for the reference picture
  await captureReference(page, "appariement-liste", "Transactions bancaires");
  await page.goto(`${company}/transactions`);
  await page.getByRole("button", { name: "Apparier à l’écriture probable : DEPOT CLIENT ATELIER", exact: true }).click();
  await expect(deposit).toContainText("Rapprochée");
  await expect(deposit).toContainText("Appariée à");
  await expect(deposit).not.toContainText("Écriture probable");
  // undone, it waits again and the entry is offered again
  await page.getByRole("button", { name: "Défaire l’appariement : DEPOT CLIENT ATELIER", exact: true }).click();
  await expect(deposit).toContainText("À traiter");
  await expect(deposit).toContainText("Écriture probable :");
  await page.getByRole("button", { name: "Apparier à l’écriture probable : DEPOT CLIENT ATELIER", exact: true }).click();
  await expect(deposit).toContainText("Rapprochée");

  // a deposit made of two entries: the running total shows how far off the ticked lines are
  await page.getByRole("link", { name: "Traiter : DEPOT STRIPE", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DEPOT STRIPE", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Apparier à des écritures existantes", exact: true })).toBeVisible();
  const progress = page.getByRole("status").filter({ hasText: "Transaction" });
  await expect(progress).toContainText("Aucune ligne cochée");
  await page.getByRole("checkbox", { name: /Vente Stripe/ }).check();
  await expect(progress).toContainText(money("1 ligne cochée · Total 100,00 $"));
  await expect(progress).toContainText(money("Écart -3,00 $"));
  await captureReference(page, "appariement-detail", "Apparier à des écritures existantes");
  await page.getByRole("button", { name: "Apparier les lignes cochées", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Le total des lignes cochées n’est pas le montant de la transaction." })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Vente Stripe/ })).toBeChecked(); // a refusal keeps what was ticked
  await page.getByRole("checkbox", { name: /Frais Stripe/ }).check();
  await expect(progress).toContainText("Le total correspond");
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Apparier les lignes cochées", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appariée à", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^J-\d{5}$/ })).toHaveCount(2);
  await expect(page.getByText(/Vente Stripe/)).toBeVisible();
  await expect(page.getByText(/Frais Stripe/)).toBeVisible();

  // a line recorded against another account: money out debits the expense, credits the bank
  await page.goto(`${company}/transactions`);
  await expect(page.getByRole("link", { name: "Règles bancaires", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Traiter : FRAIS DE COMPTE", exact: true }).click();
  await page.getByRole("link", { name: "Créer une règle à partir de cette opération", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Règles bancaires", exact: true })).toBeVisible();
  await expect(page.getByLabel("Contient le texte", { exact: true })).toHaveValue("FRAIS DE COMPTE");
  await expect(page.getByLabel("Sens de l’opération", { exact: true })).toHaveValue("OUT");
  await expect(page.getByLabel("Catégorie comptable", { exact: true })).toHaveValue("");
  await page.getByLabel("Nom de la règle", { exact: true }).fill("Frais bancaires récurrents");
  await page.getByLabel("Contient le texte", { exact: true }).fill("FRAIS DE COMPTE");
  await page.getByLabel("Compte bancaire", { exact: true }).selectOption({ label: bank });
  await page.getByLabel("Catégorie comptable", { exact: true }).selectOption({ label: "6010 · Frais bancaires" });
  await page.getByLabel("Montant minimum CAD (facultatif)", { exact: true }).fill("10,00");
  await page.getByLabel("Montant maximum CAD (facultatif)", { exact: true }).fill("20,00");
  await page.getByRole("button", { name: "Enregistrer la règle", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Modifier la règle", exact: true })).toBeVisible();
  await expect(page.getByText(/1 correspondance\(s\) parmi/)).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "regles-bancaires-gestion", "Modifier la règle");
  await page.getByRole("button", { name: "Mettre en pause : Frais bancaires récurrents", exact: true }).click();
  await expect(page.getByText("Cette règle est en pause : aucune suggestion n’est proposée.")).toBeVisible();
  await page.getByRole("button", { name: "Activer : Frais bancaires récurrents", exact: true }).click();
  await expect(page.getByText(/1 correspondance\(s\) parmi/)).toBeVisible();
  await page.getByLabel("Priorité (0 à 10 000)", { exact: true }).fill("20");
  await page.getByLabel("Compte bancaire", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Enregistrer la règle", exact: true }).click();
  await expect(page.getByText(/^Active · 20 · 6010/)).toBeVisible();
  await expect(page.getByLabel("Compte bancaire", { exact: true })).toHaveValue("");
  await expect(page.getByText(/1 correspondance\(s\) parmi/)).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bank rules", exact: true })).toBeVisible();
  await expect(page.getByLabel("Minimum CAD amount (optional)", { exact: true })).toHaveValue("10.00");
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoPageOverflow(page);
  await captureReference(page, "regles-bancaires-en-dark", "Edit rule");
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Règles bancaires", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /FRAIS DE COMPTE/, exact: false }).click();
  await expect(page.getByText(/Argent payé : l’écriture crédite 1000 · Banque – compte courant et débite le compte choisi/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Catégorisation suggérée", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "regles-bancaires-suggestion", "Catégorisation suggérée");
  await page.getByRole("button", { name: "Confirmer et comptabiliser : Frais bancaires récurrents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appariée à", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^J-\d{5}$/ }).click();
  await expect(page.getByRole("heading", { name: /^Écriture J-\d{5}$/ })).toBeVisible();
  await expect(page.getByText("FRAIS DE COMPTE").first()).toBeVisible();
  await expect(page.getByText("Cette écriture a été faite à partir d’une transaction bancaire.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contre-passer l'écriture" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /6010 – Frais bancaires/ })).toBeVisible();

  // a transfer: the card payment and the deposit it made are two lines of one entry
  await page.goto(`${company}/transactions`);
  await page.getByRole("link", { name: "Traiter : PAIEMENT CARTE", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Virement entre vos comptes", exact: true })).toBeVisible();
  await expect(page.getByText(/VIREMENT CAISSE/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le virement avec : VIREMENT CAISSE", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appariée à", exact: true })).toBeVisible();
  await page.goto(`${company}/transactions`);
  await expect(row("PAIEMENT CARTE")).toContainText("Rapprochée");
  await expect(row("VIREMENT CAISSE")).toContainText("Rapprochée");
  await expect(page.getByText("À traiter", { exact: true })).toHaveCount(1); // only DEPOT INCONNU is left
  await expectNoPageOverflow(page);

  // the books agree: every line moved the same amount on both sides
  await openSection(page, "Balance de vérification");
  await expect(page.getByText("La balance est équilibrée")).toBeVisible();

  // English, on the one line left
  await page.goto(`${company}/transactions`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("link", { name: "Deal with: DEPOT INCONNU", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Match to existing entries", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Record in the books", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transfer between your accounts", exact: true })).toBeVisible();
  await expect(page.getByText("Money received: the entry debits 1000 · Bank – chequing", { exact: false })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apparier à des écritures existantes", exact: true })).toBeVisible();
}

/**
 * Reconciling the bank account against a statement: the card of the account, starting with the statement's day and
 * balance, the lines matched to statement lines ticked in one click, the running difference and the unsaved warning,
 * completing only at a zero difference, the freeze it puts on the matches, reopening with a reason, English, and no
 * overflow. It follows the matching journey, whose five matched lines (1 500,00 + 100,00 − 3,00 − 15,00 − 250,00) are
 * the 1 332,00 the statement says.
 */
async function bankReconciliationJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const month = todayInToronto().slice(0, 7);
  const day = `${month}-06`;
  const money = (text: string) => new RegExp(text.replace(/ /g, "\\s").replace(/\$/g, "\\$"));
  const card = page.locator("li").filter({ has: page.getByRole("heading", { name: "1000 · Banque – compte courant", exact: true }) });
  const figures = page.locator("dl");
  const figure = (term: string, amount: string) => new RegExp(`${term}\\s*${amount.replace(/ /g, "\\s").replace(/\$/g, "\\$")}`); // a term and its figure sit side by side in the list

  await page.goto(`${company}/rapprochement`);
  await expect(page.getByRole("heading", { name: "Rapprochement bancaire", exact: true })).toBeVisible();
  await expect(card).toContainText("Aucun rapprochement terminé pour ce compte.");
  await expectNoPageOverflow(page);
  // a statement whose day does not exist is refused, and what was typed stays
  await card.getByLabel("Date de fin du relevé").fill(day);
  await card.getByLabel("Solde final du relevé").fill("1 332,00 plus");
  await card.getByRole("button", { name: "Commencer un rapprochement : 1000 Banque – compte courant", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Vérifiez le compte, la date du relevé et son solde" })).toBeVisible();
  await expect(card.getByLabel("Solde final du relevé")).toHaveValue("1 332,00 plus");
  await card.getByLabel("Solde final du relevé").fill("1 332,00");
  await card.getByRole("button", { name: "Commencer un rapprochement : 1000 Banque – compte courant", exact: true }).click();

  // the sheet: nothing counted yet, so the whole balance is left to explain
  await expect(page.getByRole("heading", { name: `Rapprochement de 1000 · Banque – compte courant au ${day}`, exact: true })).toBeVisible();
  await expect(figures).toContainText(figure("Solde du relevé", "1 332,00 $"));
  await expect(figures).toContainText(figure("Écart", "1 332,00 $"));
  await expect(page.getByText("On peut terminer quand l’écart enregistré est nul")).toBeVisible();
  await expect(page.getByRole("button", { name: "Terminer le rapprochement", exact: true })).toHaveCount(0);

  // the lines the statement already proves are ticked in one click
  await page.getByRole("button", { name: "Pointer les 5 lignes appariées à des transactions", exact: true }).click();
  await expect(figures).toContainText(figure("Écart", "0,00 $"));
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(5);
  await expect(page.getByRole("status").filter({ hasText: "Compté" })).toContainText("L’écart est nul");
  await expectNoPageOverflow(page);
  await captureReference(page, "rapprochement-feuille", "Pointer les lignes du relevé");

  // unticking a line shows the difference at once, and warns that it is not saved; saving takes completing away
  const fee = page.getByRole("checkbox", { name: /PAIEMENT CARTE/ });
  await fee.uncheck();
  await expect(page.getByRole("status").filter({ hasText: "Compté" })).toContainText(money("Écart -250,00 $"));
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le pointage", exact: true }).click();
  await expect(page.getByText("Pointage enregistré.", { exact: true })).toBeVisible();
  await expect(page.getByText(/On peut terminer quand l’écart enregistré est nul/)).toContainText(money("écart actuel : -250,00 $"));
  await fee.check();
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le pointage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Terminer le rapprochement", exact: true })).toBeVisible();
  await expect(page.getByText("L’écart est nul : le pointage enregistré donne le solde du relevé.")).toBeVisible();

  // completed: frozen, listed with its lines, and its matches cannot be undone
  await page.getByRole("button", { name: "Terminer le rapprochement", exact: true }).click();
  await expect(page.getByText(/^Terminé · \d{4}-\d{2}-\d{2}$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lignes comptées par ce rapprochement", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "✓" })).toHaveCount(5);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Rouvrir", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "rapprochement-termine", "Lignes comptées par ce rapprochement");
  const sheet = page.url();
  await page.goto(`${company}/transactions?q=DEPOT CLIENT`);
  const deposit = page.locator("li.rounded").filter({ has: page.getByRole("heading", { name: "DEPOT CLIENT ATELIER", exact: true }) });
  await expect(deposit).toContainText("pointée par un rapprochement");
  await expect(deposit.getByRole("button", { name: /Défaire l’appariement/ })).toHaveCount(0);
  await page.goto(`${company}/rapprochement`);
  await expect(card).toContainText(money("Dernier rapprochement terminé : " + day + " · 1 332,00 $"));
  await expect(card.getByRole("button", { name: /Commencer un rapprochement/ })).toBeVisible();
  await captureReference(page, "rapprochement-liste", "Rapprochement bancaire");

  // reopened with a reason (ten characters at least), it can be changed again, and the matches are free
  await page.goto(sheet);
  await page.getByLabel("Motif de la réouverture").fill("court");
  await page.getByRole("button", { name: "Rouvrir ce rapprochement", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Écrivez le motif de la réouverture" })).toBeVisible();
  await expect(page.getByLabel("Motif de la réouverture")).toHaveValue("court");
  await page.getByLabel("Motif de la réouverture").fill("Une ligne avait été oubliée au relevé");
  await page.getByRole("button", { name: "Rouvrir ce rapprochement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pointer les lignes du relevé", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(5);
  await page.goto(`${company}/transactions?q=DEPOT CLIENT`);
  await expect(deposit.getByRole("button", { name: /Défaire l’appariement/ })).toBeVisible();
  await page.goto(sheet);
  await page.getByRole("button", { name: "Terminer le rapprochement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lignes comptées par ce rapprochement", exact: true })).toBeVisible();

  // English
  await page.goto(`${company}/rapprochement`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bank reconciliation", exact: true })).toBeVisible();
  await expect(page.locator("li").filter({ has: page.getByRole("heading", { name: "1000 · Bank – chequing", exact: true }) })).toContainText("Last completed reconciliation");
  await page.getByRole("link", { name: day, exact: true }).first().click();
  await expect(page.getByRole("heading", { name: `Reconciliation of 1000 · Bank – chequing at ${day}`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reopen", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Rapprochement de 1000 · Banque – compte courant au ${day}`, exact: true })).toBeVisible();
}

/** Browser printing uses exactly the report already rendered under accounting permissions. */
async function checkStatementPrint(page: Page, name: string, comparison = false) {
  const report = page.locator(".statement-print");
  const balances = await report.locator("table").innerText();
  const tips=report.locator(".print-controls details");
  await tips.locator("summary").click();await expect(tips.locator("p")).toBeVisible();
  await tips.locator("summary").click();await expect(tips.locator("p")).toBeHidden();
  await page.evaluate(() => {
    delete document.documentElement.dataset.printRequested;
    window.print = () => { document.documentElement.dataset.printRequested = "true"; };
  });
  await page.getByRole("button", {name: /^(Imprimer \/ PDF|Print \/ PDF)$/}).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");
  if (process.env.E2E_MOBILE === "1") await captureReference(page, name);
  await page.emulateMedia({media:"print"});
  await expect(page.locator(".workspace-header")).toBeHidden();
  await expect(page.locator(".workspace-sidebar")).toBeHidden();
  await expect(page.locator("nav:visible")).toHaveCount(0);
  for (const control of await report.locator(".print-controls").all()) await expect(control).toBeHidden();
  await expect(report.locator(".statement-print-heading")).toContainText("Atelier Exemple inc.");
  await expect(report.locator(".statement-print-heading")).toContainText("CAD");
  expect(await report.locator("table").innerText()).toBe(balances);
  expect(await page.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await report.getByRole("heading",{level:1}).evaluate(el=>getComputedStyle(el).color)).toBe("rgb(0, 0, 0)");
  if (process.env.E2E_MOBILE !== "1") {
    const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
    expect(pdf.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.length).toBeGreaterThan(3000);
    const boxes=[...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\]/g)];
    expect(boxes.length).toBeGreaterThan(0);for(const box of boxes)expect(Number(box[1])>Number(box[2])).toBe(comparison);
    await captureReference(page,name);
  }
  await page.emulateMedia({media:"screen"});
  await expect(page.getByRole("button",{name:/^(Imprimer \/ PDF|Print \/ PDF)$/})).toBeVisible();
}

/**
 * The income statement and the balance sheet: entries made by hand on two days of the current month
 * (a window no other journey writes in), the statement of exactly those days with every subtotal, the fiscal year
 * shortcut, a bad address falling back to a sensible period, the CSV files (UTF-8 byte-order mark, the language's
 * delimiter and decimal mark, a hostile account name defused), the balance sheet and its check, both languages, and
 * no overflow. Both comparison reports also verify signed differences, bilingual CSV and identical-date balances.
 */
async function financialStatementsJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const [from, to] = reportDays();
  const post = async (date: string, memo: string, debit: string, credit: string, amount: string) => {
    await page.goto(`${company}/journal/nouvelle`);
    await page.getByLabel("Date", { exact: true }).fill(date);
    await page.getByLabel("Description").fill(memo);
    await page.getByLabel("Ligne 1 – Compte").selectOption({ label: debit });
    await page.getByLabel("Ligne 1 – Débit").fill(amount);
    await page.getByLabel("Ligne 2 – Compte").selectOption({ label: credit });
    await page.getByLabel("Ligne 2 – Crédit").fill(amount);
    await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
    await expect(page.getByRole("heading", { name: /^Écriture J-\d{5}$/ })).toBeVisible();
  };
  await post(from, "Vente de services", "1000 – Banque – compte courant", "4000 – Revenus de services", "1 000,00");
  await post(from, "Frais du compte", "6010 – Frais bancaires", "1000 – Banque – compte courant", "25,00");
  await post(to, "Achat de marchandises", "5000 – Coût des marchandises vendues", "1000 – Banque – compte courant", "400,00");
  await post(to, "Intérêts reçus", "1000 – Banque – compte courant", "4910 – Revenus d'intérêts", "5,00");

  // the income statement of exactly those days
  await page.goto(`${company}/resultats?${new URLSearchParams({ du: from, au: to })}`);
  await expect(page.getByRole("heading", { name: "État des résultats", exact: true })).toBeVisible();
  await expect(page.getByText(`Période du ${from} au ${to}.`)).toBeVisible();
  const row = (label: string | RegExp) => page.getByRole("row").filter({ hasText: label });
  const amount = (text: string) => new RegExp(text.replace(/ /g, "\\s").replace(/\$/g, "\\$"));
  await expect(row(/4000 – Revenus de services/)).toContainText(amount("1 000,00 $"));
  await expect(row(/5000 – Coût des marchandises vendues/)).toContainText(amount("400,00 $"));
  await expect(row(/^Bénéfice brut/)).toContainText(amount("600,00 $"));
  await expect(row(/6010 – Frais bancaires/)).toContainText(amount("25,00 $"));
  await expect(row(/^Bénéfice d’exploitation/)).toContainText(amount("575,00 $"));
  await expect(row(/4910 – Revenus d'intérêts/)).toContainText(amount("5,00 $"));
  await expect(row(/^Résultat net/)).toContainText(amount("580,00 $"));
  await expectNoPageOverflow(page);
  await captureReference(page, "rapport-resultats", "État des résultats");
  await checkStatementPrint(page,"impression-resultats");
  // a fiscal year in one click, and a bad address that does not break the page
  const fiscalYear = page.getByRole("link", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).first();
  const [yearStart, yearEnd] = ((await fiscalYear.textContent()) ?? "").split(" → ");
  await fiscalYear.click();
  await expect(page.getByText(`Période du ${yearStart} au ${yearEnd}.`)).toBeVisible();
  await page.goto(`${company}/resultats?du=${to}&au=${from}`);
  await expect(page.getByRole("heading", { name: "État des résultats", exact: true })).toBeVisible();
  await expect(page.getByText(`Période du ${to} au ${from}.`)).toHaveCount(0);
  await page.goto(`${company}/resultats?du=pas-une-date`);
  await expect(page.getByText(/^Période du \d{4}-\d{2}-\d{2} au \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();

  // the CSV file: French spreadsheets split on semicolons and read the comma as the decimal mark
  await page.goto(`${company}/resultats?${new URLSearchParams({ du: from, au: to })}`);
  const href = await page.getByRole("link", { name: "Exporter en CSV", exact: true }).getAttribute("href");
  const file = await page.request.get(href ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("text/csv");
  expect(file.headers()["content-disposition"]).toContain(`etat-des-resultats_${from}_${to}.csv`);
  expect(file.headers()["cache-control"]).toContain("no-store");
  const csv = await file.text();
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain("\r\n4000;Revenus de services;1000,00\r\n");
  expect(csv).toContain(";Résultat net;580,00\r\n");

  await page.getByRole("link",{name:"Comparer des périodes",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Comparaison de l’état des résultats",exact:true})).toBeVisible();
  await page.getByLabel("Début de la référence",{exact:true}).fill(from);await page.getByLabel("Fin de la référence",{exact:true}).fill(from);
  await page.getByRole("button",{name:"Comparer",exact:true}).click();
  const comparedNet=page.getByRole("row").filter({hasText:/^Résultat net/});
  await expect(comparedNet.getByRole("cell").nth(0)).toContainText(amount("580,00 $"));await expect(comparedNet.getByRole("cell").nth(1)).toContainText(amount("975,00 $"));await expect(comparedNet.getByRole("cell").nth(2)).toContainText(amount("-395,00 $"));await expect(comparedNet.getByRole("cell").nth(3)).toContainText("-40,51 %");
  await expectNoPageOverflow(page);await captureReference(page,"resultats-comparatifs","Montants comparés");
  await checkStatementPrint(page,"impression-resultats-comparatifs",true);
  const comparisonFile=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);expect(comparisonFile.status()).toBe(200);expect(comparisonFile.headers()["cache-control"]).toContain("no-store");
  const comparisonCsv=await comparisonFile.text();expect(comparisonCsv.charCodeAt(0)).toBe(0xfeff);expect(comparisonCsv).toContain(";Résultat net;580,00;975,00;-395,00;-40,51");
  await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.getByRole("heading",{name:"Income statement comparison",exact:true})).toBeVisible();
  const comparisonEn=await page.request.get((await page.getByRole("link",{name:"Export as CSV",exact:true}).getAttribute("href"))!);expect(await comparisonEn.text()).toContain(",Net income,580.00,975.00,-395.00,-40.51");
  await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Comparaison de l’état des résultats",exact:true})).toBeVisible();

  // the balance sheet at the end of those days: it balances whatever the other journeys wrote
  await page.goto(`${company}/bilan?au=${to}`);
  await expect(page.getByRole("heading", { name: "Bilan", exact: true })).toBeVisible();
  await expect(page.getByText(`Situation au ${to}.`)).toBeVisible();
  await expect(row(/1000 – Banque – compte courant/)).toBeVisible();
  await expect(row(/^Total de l’actif/)).toBeVisible();
  await expect(row(/^Résultat de l’exercice en cours/)).toBeVisible();
  await expect(page.getByText("Le bilan est équilibré : l’actif égale le passif plus les capitaux propres.")).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "rapport-bilan", "Bilan");
  await checkStatementPrint(page,"impression-bilan");
  const sheetFile = await page.request.get((await page.getByRole("link", { name: "Exporter en CSV", exact: true }).getAttribute("href")) ?? "");
  expect(sheetFile.headers()["content-disposition"]).toContain(`bilan_${to}.csv`);
  expect(await sheetFile.text()).toContain(";Total du passif et des capitaux propres;");
  await page.getByRole("link",{name:"Comparer deux dates",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Comparaison des bilans",exact:true})).toBeVisible();
  await page.getByLabel("Date de référence",{exact:true}).fill(from);await page.getByRole("button",{name:"Comparer",exact:true}).click();
  await expect(page.getByText(`Situation au ${to} comparée au ${from}.`,{exact:true})).toBeVisible();
  await expect(page.getByText(`Le bilan au ${to} est équilibré.`,{exact:true})).toBeVisible();await expect(page.getByText(`Le bilan au ${from} est équilibré.`,{exact:true})).toBeVisible();
  await expect(row(/^Total de l’actif/)).toContainText(/-395,00/);
  await expectNoPageOverflow(page);await captureReference(page,"bilans-comparatifs","Soldes comparés");
  await checkStatementPrint(page,"impression-bilans-comparatifs",true);
  const balanceFile=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);
  expect(balanceFile.status()).toBe(200);expect(balanceFile.headers()["cache-control"]).toContain("no-store");expect(balanceFile.headers()["content-disposition"]).toContain(`bilans-comparatifs_${to}_${from}.csv`);
  const balanceCsv=await balanceFile.text();expect(balanceCsv.charCodeAt(0)).toBe(0xfeff);expect(balanceCsv).toMatch(/;Total de l’actif;[^\r\n]+;-395,00;/);
  await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.getByRole("heading",{name:"Balance sheet comparison",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await checkStatementPrint(page,"impression-bilan-en-dark",true);
  await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  const balanceEn=await page.request.get((await page.getByRole("link",{name:"Export as CSV",exact:true}).getAttribute("href"))!);expect(await balanceEn.text()).toMatch(/,Total assets,[^\r\n]+,-395.00,/);
  await page.getByLabel("Reference date",{exact:true}).fill(to);await page.getByRole("button",{name:"Compare",exact:true}).click();await expect(row(/^Total assets/).getByRole("cell").nth(2)).toHaveText("$0.00");
  await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Comparaison des bilans",exact:true})).toBeVisible();
  await page.goto(`${company}/bilan?au=2026-02-30`);
  await expect(page.getByText(/^Situation au \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();

  // English: titles, labels and a file with commas and points
  await page.goto(`${company}/resultats?${new URLSearchParams({ du: from, au: to })}`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Income statement", exact: true })).toBeVisible();
  await expect(row(/^Net income/)).toContainText(/580\.00/);
  const english = await page.request.get((await page.getByRole("link", { name: "Export as CSV", exact: true }).getAttribute("href")) ?? "");
  expect(english.headers()["content-disposition"]).toContain(`income-statement_${from}_${to}.csv`);
  expect(await english.text()).toContain("\r\n4000,Service revenue,1000.00\r\n");
  await page.goto(`${company}/bilan?au=${to}`);
  await expect(page.getByRole("heading", { name: "Balance sheet", exact: true })).toBeVisible();
  await expect(page.getByText("The balance sheet balances: assets equal liabilities plus equity.")).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bilan", exact: true })).toBeVisible();
}

/**
 * The general ledger, on the entries the statements journey made: an account with nothing chosen, the ledger of an
 * account over those two days with its opening and closing balances, the entry linked to the journal, a customer's
 * name on a receivable line, the CSV of one account and of every account, both languages, and no overflow.
 */
async function generalLedgerJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const [from, to] = reportDays();
  const amount = (text: string) => new RegExp(text.replace(/ /g, "\\s").replace(/\$/g, "\\$"));

  // nothing chosen: a hint, and the file of every account is one click away
  await page.goto(`${company}/grand-livre?${new URLSearchParams({ du: from, au: to })}`);
  await expect(page.getByRole("heading", { name: "Grand livre", exact: true })).toBeVisible();
  await expect(page.getByText("Choisissez un compte pour voir son grand livre")).toBeVisible();
  await expect(page.getByRole("link", { name: "Exporter tous les comptes en CSV", exact: true })).toBeVisible();

  // the interest account: nothing before, one line in the period
  await page.locator('select[name="compte"]').selectOption({ label: "4910 – Revenus d'intérêts" });
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4910 – Revenus d'intérêts", exact: true })).toBeVisible();
  await expect(page.getByText("1 ligne", { exact: true })).toBeVisible();
  const ledgerRow = (text: string | RegExp) => page.getByRole("row").filter({ hasText: text });
  await expect(ledgerRow(/^Solde d’ouverture/)).toContainText(amount("0,00 $"));
  await expect(ledgerRow(/Intérêts reçus/)).toContainText(amount("5,00 $"));
  await expect(ledgerRow(/^Solde de clôture/)).toContainText(amount("5,00 $"));
  await expectNoPageOverflow(page);
  await captureReference(page, "rapport-grand-livre", "Grand livre");

  // the entry of a line is one click away
  await ledgerRow(/Intérêts reçus/).getByRole("link", { name: /^J-\d{5}$/ }).click();
  await expect(page.getByRole("heading", { name: /^Écriture J-\d{5}$/ })).toBeVisible();
  await page.goBack();

  // the files: one account, and every account
  const one = await page.request.get((await page.getByRole("link", { name: "Exporter ce compte en CSV", exact: true }).getAttribute("href")) ?? "");
  expect(one.status()).toBe(200);
  expect(one.headers()["content-disposition"]).toContain(`grand-livre_4910_${from}_${to}.csv`);
  const oneCsv = await one.text();
  expect(oneCsv.charCodeAt(0)).toBe(0xfeff);
  expect(oneCsv).toContain(`\r\n4910;Revenus d'intérêts;${from};;Solde d’ouverture;;;;0,00\r\n`);
  expect(oneCsv).toMatch(new RegExp(`\\r\\n4910;Revenus d'intérêts;${to};J-\\d{5};Intérêts reçus;;0,00;5,00;5,00\\r\\n`));
  expect(oneCsv).toContain(`;Solde de clôture;;0,00;5,00;5,00\r\n`);
  const all = await page.request.get((await page.getByRole("link", { name: "Exporter tous les comptes en CSV", exact: true }).getAttribute("href")) ?? "");
  expect(all.headers()["content-disposition"]).toContain(`grand-livre_tous-les-comptes_${from}_${to}.csv`);
  const allCsv = await all.text();
  expect(allCsv).toContain("\r\n1000;Banque – compte courant;");
  expect(allCsv).toContain("\r\n4000;Revenus de services;");
  expect(allCsv).toContain("\r\n6010;Frais bancaires;");

  // Invalid or repeated account selection never broadens a file to all accounts.
  const chosenAccount=await page.locator('select[name="compte"]').inputValue();
  for(const bad of ["bad","00000000-0000-7000-8000-999999999999",`${chosenAccount}&compte=bad`]){
    expect((await page.request.get(`${company}/grand-livre?du=${from}&au=${to}&compte=${bad}`)).status()).toBe(404);
    expect((await page.request.get(`${company}/grand-livre/export?du=${from}&au=${to}&compte=${bad}`)).status()).toBe(404);
  }
  // a customer's name on a receivable line, over the whole fiscal year
  await page.getByRole("link", { name: /^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/ }).first().click();
  await expect(page.locator('input[type="date"][name="du"]')).not.toHaveValue(from); // the page is the fiscal year's before the form is used again
  await page.locator('select[name="compte"]').selectOption({ label: "1100 – Comptes clients" });
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1100 – Comptes clients", exact: true })).toBeVisible();
  await expect(ledgerRow(/Atelier Boréal/).first()).toBeVisible();
  await expectNoPageOverflow(page);

  // Filter by journal-line contact, preserving scope in files and fiscal shortcuts.
  const contactFilter=page.getByLabel("Contact",{exact:true});await expect(contactFilter).toBeVisible();
  const contactOption=contactFilter.locator("option").filter({hasText:/^Atelier Boréal(?: · Inactif)?$/});await expect(contactOption).toHaveCount(1);
  await contactFilter.selectOption((await contactOption.getAttribute("value"))!);
  await page.getByRole("button",{name:"Afficher",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Contact : Atelier Boréal."})).toBeVisible();
  const selectedContact=await page.getByLabel("Contact",{exact:true}).inputValue();
  const filteredUrl=page.url();
  for(const title of ["Exporter ce compte en CSV","Exporter tous les comptes en CSV"]){
    const href=(await page.getByRole("link",{name:title,exact:true}).getAttribute("href"))!;
    expect(new URL(href,"http://localhost").searchParams.get("contact")).toBe(selectedContact);
    const file=await page.request.get(href);expect(file.status()).toBe(200);expect(file.headers()["content-disposition"]).toContain("_contact_");expect(file.headers()["cache-control"]).toContain("private");expect(await file.text()).toContain("\r\nContact;Atelier Boréal;;;;;;;\r\n");
  }
  const fiscalHref=(await page.getByRole("link",{name:/^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/}).first().getAttribute("href"))!;
  expect(new URL(fiscalHref,"http://localhost").searchParams.get("contact")).toBe(selectedContact);
  // Searching changes the options without dropping the selected filter.
  await page.getByText("Rechercher un contact",{exact:true}).click();await page.getByLabel("Nom du contact",{exact:true}).fill("no-such-contact");await page.getByRole("button",{name:"Rechercher",exact:true}).click();
  await expect(page.getByLabel("Contact",{exact:true})).toHaveValue(selectedContact);
  await expect(page.getByLabel("Contact",{exact:true}).locator("option")).toHaveCount(2);
  await expectNoPageOverflow(page);await captureReference(page,"grand-livre-contact","Grand livre");
  for(const bad of ["invalid","00000000-0000-7000-8000-999999999999",`${selectedContact}&contact=invalid`]){
    const badUrl=new URL(filteredUrl);badUrl.searchParams.delete("contact");
    const response=await page.request.get(`${badUrl}&contact=${bad}`);expect(response.status()).toBe(404);
    const fileUrl=new URL(badUrl);fileUrl.pathname+="/export";expect((await page.request.get(`${fileUrl}&contact=${bad}`)).status()).toBe(404);
  }
  // English
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "General ledger", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Contact: Atelier Boréal."})).toBeVisible();
  const filteredEn=await page.request.get((await page.getByRole("link",{name:"Export this account as CSV",exact:true}).getAttribute("href"))!);expect(await filteredEn.text()).toContain("\r\nContact,Atelier Boréal,,,,,,,\r\n");
  await expect(ledgerRow(/^Closing balance/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Export all accounts as CSV", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Grand livre", exact: true })).toBeVisible();
}

/** Posted bank/cash movements, a pure transfer, filtered totals, CSV and strict scope URLs. */
async function cashMovementsJourney(page:Page){
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0]??"";
 const [from,to]=reportDays();
 await page.goto(`${company}/journal/nouvelle`);
 await page.getByLabel("Date",{exact:true}).fill(to);await page.getByLabel("Description").fill("Virement de trésorerie");
 await page.getByLabel("Ligne 1 – Compte").selectOption({label:"1999 – Caisse secondaire (atelier)"});await page.getByLabel("Ligne 1 – Débit").fill("40");
 await page.getByLabel("Ligne 2 – Compte").selectOption({label:"1000 – Banque – compte courant"});await page.getByLabel("Ligne 2 – Crédit").fill("40");
 await page.getByRole("button",{name:"Enregistrer l'écriture",exact:true}).click();
 await expect(page.getByRole("heading",{name:/^Écriture J-\d{5}$/})).toBeVisible();
 await openSection(page,"Trésorerie");await page.getByRole("link",{name:"Suivi de trésorerie",exact:true}).first().click();
 await expect(page.getByRole("heading",{name:"Suivi de trésorerie",exact:true})).toBeVisible();
 await page.getByLabel("Du",{exact:true}).fill(from);await page.getByLabel("Au",{exact:true}).fill(to);await page.getByRole("button",{name:"Afficher",exact:true}).click();
 await expect(page.getByText(`Du ${from} au ${to}, dates incluses.`,{exact:true})).toBeVisible();
 const figure=(label:string)=>page.locator("dt").filter({hasText:new RegExp(`^${label}$`)}).locator("xpath=following-sibling::dd[1]");
 await expect(figure("Variation nette")).toContainText(/580,00/);await expect(figure("Virements entrants")).toContainText(/40,00/);await expect(figure("Virements sortants")).toContainText(/40,00/);
 await expect(page.getByText("Les mouvements concordent avec les soldes comptables.",{exact:true})).toBeVisible();
 const details=page.getByRole("table",{name:"Mouvements comptabilisés",exact:true});await expect(details.getByRole("row").filter({hasText:"Virement de trésorerie"})).toHaveCount(2);
 if((page.viewportSize()?.width??0)>=1024)expect(await page.getByRole("table",{name:"Détail par compte",exact:true}).evaluate(el=>el.scrollWidth<=el.parentElement!.clientWidth)).toBe(true);
 await expectNoPageOverflow(page);await captureReference(page,"suivi-tresorerie","Soldes et mouvements");
 const file=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);expect(file.status()).toBe(200);expect(file.headers()["cache-control"]).toContain("private");const csv=await file.text();expect(csv.charCodeAt(0)).toBe(0xfeff);expect(csv).toMatch(/Total;[^;\r\n]+;1005,00;425,00;40,00;40,00;/);expect(csv).toContain("Virement interne pur");
 await page.getByLabel("Compte",{exact:true}).selectOption({label:"1000 – Banque – compte courant"});await page.getByRole("button",{name:"Afficher",exact:true}).click();await expect(figure("Variation nette")).toContainText(/540,00/);
 const accountId=await page.getByLabel("Compte",{exact:true}).inputValue();
 const accountCsv=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);expect(accountCsv.headers()["content-disposition"]).toContain(`suivi-tresorerie_1000_${from}_${to}.csv`);
 for(const bad of ["bad","00000000-0000-7000-8000-999999999999",`${accountId}&compte=bad`]){
  expect((await page.request.get(`${company}/flux-tresorerie?du=${from}&au=${to}&compte=${bad}`)).status()).toBe(404);
  expect((await page.request.get(`${company}/flux-tresorerie/export?du=${from}&au=${to}&compte=${bad}`)).status()).toBe(404);
 }
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.getByRole("heading",{name:"Cash account movements",exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expect(page.getByText("Movements agree with the ledger balances.",{exact:true})).toBeVisible();const en=await page.request.get((await page.getByRole("link",{name:"Export as CSV",exact:true}).getAttribute("href"))!);expect(await en.text()).toContain("Pure internal transfer");await expectNoPageOverflow(page);
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Suivi de trésorerie",exact:true})).toBeVisible();
}

/**
 * The receivables aging, on what the earlier journeys left: invoices F-00001 (241,45 $, voided July 2) and F-00002
 * (114,98 $) of Atelier Boréal, both posted June 1st and due July 1st, payment E-00001 (50,00 $, June 15), payment
 * E-00002 (64,98 $, June 20, voided June 25) and credit note AV-00001 (28,74 $, June 2, voided June 3). The report of
 * past days gives what it was then: before anything, with nothing due, the day a payment void took effect, the due
 * date, and the day after, when the first invoice was voided. Then the details with their links, the CSV
 * file in both languages, and no overflow.
 */
async function receivablesAgingJourney(page: Page) {
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0] ?? "";
  const row = (label: string | RegExp) => page.getByRole("row").filter({ hasText: label });
  const figures = async (label: RegExp) => (await row(label).first().locator("td").allTextContents()).map((text) => text.replace(/\s/g, " "));
  const agrees = page.getByText("Le total concorde avec le solde des comptes clients du grand livre.");
  const money = (...values: string[]) => values.map((value) => `${value} $`);
  const zero = "0,00";

  // from the Reports area
  await openSection(page, "Rapports");
  await page.getByRole("link", { name: "Âge des comptes clients", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Âge des comptes clients", exact: true })).toBeVisible();
  await expect(agrees).toBeVisible(); // whatever day it is today, the aging agrees with the ledger
  await expectNoPageOverflow(page);

  // before anything was posted
  await page.goto(`${company}/age-clients?au=2026-05-31`);
  await expect(page.getByText("Soldes au 2026-05-31.")).toBeVisible();
  await expect(page.getByText("Aucun solde client à cette date.")).toBeVisible();
  await expect(agrees).toBeVisible();

  // both invoices posted, nothing due yet
  await page.goto(`${company}/age-clients?au=2026-06-01`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money("356,43", zero, zero, zero, zero, zero, "356,43"));
  // The credit reduces the historical balance only between its application and its dated release.
  await page.goto(`${company}/age-clients?au=2026-06-02`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money("327,69", zero, zero, zero, zero, zero, "327,69"));
  await expect(agrees).toBeVisible();
  await page.goto(`${company}/age-clients?au=2026-06-03`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money("356,43", zero, zero, zero, zero, zero, "356,43"));
  await expect(agrees).toBeVisible();
  // the last day before the second payment was voided: only the first invoice is still open
  await page.goto(`${company}/age-clients?au=2026-06-24`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money("241,45", zero, zero, zero, zero, zero, "241,45"));
  // the day it was voided, the invoice it had settled is open again, less the first payment
  await page.goto(`${company}/age-clients?au=2026-06-25`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money("306,43", zero, zero, zero, zero, zero, "306,43"));
  // the due date itself: due today is zero days late, not yet in a late column
  await page.goto(`${company}/age-clients?au=2026-07-01`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money("306,43", zero, zero, zero, zero, zero, "306,43"));
  await page.locator("summary").filter({ hasText: "Atelier Boréal" }).locator("span").last().click();
  await expect(row(/F-00001/).getByRole("cell").nth(4)).toHaveText("0");
  await expect(row(/F-00002/)).toContainText(/64,98\s\$/);

  // the day after: one day late; the first invoice was voided that day
  await page.goto(`${company}/age-clients?au=2026-07-02`);
  expect(await figures(/^Atelier Boréal/)).toEqual(money(zero, "64,98", zero, zero, zero, zero, "64,98"));
  expect(await figures(/^Total/)).toEqual(money(zero, "64,98", zero, zero, zero, zero, "64,98"));
  await expect(agrees).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "rapport-age-clients", "Âge des comptes clients");

  // the form moves to another day
  await page.getByLabel("Au", { exact: true }).fill("2026-06-01");
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByText("Soldes au 2026-06-01.")).toBeVisible();
  expect(await figures(/^Atelier Boréal/)).toEqual(money("356,43", zero, zero, zero, zero, zero, "356,43"));
  await page.goto(`${company}/age-clients?au=2026-07-02`);

  // the detail of a customer: each open invoice with its dates and days late, linked to the invoice
  await page.locator("summary").filter({ hasText: "Atelier Boréal" }).locator("span").last().click();
  await expect(row(/F-00001/)).toHaveCount(0); // voided that day
  await expect(row(/F-00002/)).toContainText("2026-06-01");
  await expect(row(/F-00002/)).toContainText("2026-07-01");
  await expect(row(/F-00002/)).toContainText(/64,98\s\$/);
  await expect(row(/F-00002/).getByRole("cell").nth(4)).toHaveText("1");
  await row(/F-00002/).getByRole("link", { name: "F-00002", exact: true }).click();
  await expect(page.getByRole("heading", { name: "F-00002", exact: true })).toBeVisible();
  await page.goBack();

  // the file: one row per open invoice, in its column
  const file = await page.request.get((await page.getByRole("link", { name: "Exporter en CSV", exact: true }).getAttribute("href")) ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("text/csv");
  expect(file.headers()["content-disposition"]).toContain("age-des-comptes-clients_2026-07-02.csv");
  expect(file.headers()["cache-control"]).toContain("no-store");
  const csv = await file.text();
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain("\r\nClient;Pièce;Numéro;Date;Échéance;Jours de retard;Courant;1–30 jours;31–60 jours;61–90 jours;91 jours et plus;Non appliqué;Total\r\n");
  expect(csv).toContain("\r\nAtelier Boréal;Facture;F-00002;2026-06-01;2026-07-01;1;0,00;64,98;0,00;0,00;0,00;0,00;64,98\r\n");
  expect(csv).not.toContain("F-00001");
  expect(csv).toContain("\r\nTotal;;;;;;0,00;64,98;0,00;0,00;0,00;0,00;64,98\r\n");

  // a bad address falls back to today
  await page.goto(`${company}/age-clients?au=2026-13-01`);
  await expect(page.getByText(/^Soldes au \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();

  // English: labels, and a file with commas and points
  await page.goto(`${company}/age-clients?au=2026-07-02`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Receivables aging", exact: true })).toBeVisible();
  await expect(page.getByText("The total agrees with the balance of the receivable accounts in the general ledger.")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "91 days and over", exact: true })).toBeVisible();
  const english = await page.request.get((await page.getByRole("link", { name: "Export as CSV", exact: true }).getAttribute("href")) ?? "");
  expect(english.headers()["content-disposition"]).toContain("receivables-aging_2026-07-02.csv");
  expect(await english.text()).toContain("\r\nAtelier Boréal,Invoice,F-00002,2026-06-01,2026-07-01,1,0.00,64.98,0.00,0.00,0.00,0.00,64.98\r\n");
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Âge des comptes clients", exact: true })).toBeVisible();
}

/**
 * Signs in from another browser. Without a recovery code it stops at the second-factor page, which is enough to
 * prove the password was accepted. Every code typed counts in the limit of 8 per 15 minutes and per account,
 * which the whole journey shares: keep the number of codes used here low.
 */
async function signInElsewhere(page: Page, password: string, recoveryCode?: string) {
  await page.goto("/connexion");
  await page.getByLabel("Courriel").fill(EMAIL);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/connexion\/2fa$/);
  if (recoveryCode === undefined) return;
  await page.getByLabel("Code à 6 chiffres").fill(recoveryCode);
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
}

/** Signed-in devices and password change, with a second browser as the "other device". */
async function securityJourney(page: Page, browser: Browser, recoveryCodes: string[]) {
  const disconnect = page.getByRole("button", { name: /^Déconnecter (?!tous les autres)/ });
  const dashboard = page.url();
  await page.goto("/compte/securite");
  await expect(page.getByRole("heading", { name: "Appareils connectés" })).toBeVisible();
  await expect(page.getByText("Cet appareil")).toBeVisible();
  await expect(disconnect).toHaveCount(0);

  // Another device appears, and disconnecting it really closes its session.
  const other = await newWatchedContext(browser);
  const otherPage = await other.newPage();
  await signInElsewhere(otherPage, PASSWORD, recoveryCodes[1] ?? "");
  await page.reload();
  await expect(disconnect).toHaveCount(1);
  await expectNoPageOverflow(page);
  await captureReference(page, "securite-appareils", "Appareils connectés");
  await disconnect.click();
  await expect(disconnect).toHaveCount(0);
  await otherPage.goto("/compte/securite");
  await expect(otherPage).toHaveURL(/\/connexion$/);

  // Changing the password asks for the current one and applies the policy; the form keeps nothing after a refusal.
  const change = page.getByRole("button", { name: "Changer le mot de passe" });
  const fill = async (current: string, next: string, confirm = next) => {
    await page.getByLabel("Mot de passe actuel").fill(current);
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(next);
    await page.getByLabel("Confirmation du mot de passe").fill(confirm);
    await change.click();
  };
  const NEXT = "une autre phrase de passe 2027";
  await fill("ce n'est pas le bon", NEXT);
  await expect(page.getByText("Le mot de passe actuel est incorrect.")).toBeVisible();
  await fill(PASSWORD, NEXT, "autre chose entièrement");
  await expect(page.getByText("Les mots de passe ne correspondent pas.")).toBeVisible();
  await fill(PASSWORD, "court");
  await expect(page.getByText("Le mot de passe est trop court (au moins 12 caractères).")).toBeVisible();
  await fill(PASSWORD, PASSWORD);
  await expect(page.getByText("Le nouveau mot de passe doit être différent de l'actuel.")).toBeVisible();

  // The other browser signs in again, then loses its session when the password changes; this one keeps its own.
  await signInElsewhere(otherPage, PASSWORD, recoveryCodes[2] ?? "");
  await fill(PASSWORD, NEXT);
  await expect(page.getByText("Mot de passe changé. Les autres appareils ont été déconnectés.")).toBeVisible();
  await expect(page.getByLabel("Mot de passe actuel")).toHaveValue("");
  await captureReference(page, "securite-mot-de-passe", "Mot de passe");
  await otherPage.goto("/compte/securite");
  await expect(otherPage).toHaveURL(/\/connexion$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Appareils connectés" })).toBeVisible();
  await other.close();

  // Back to the password the rest of the journey uses.
  await fill(NEXT, PASSWORD);
  const verifier = await newWatchedContext(browser);
  await signInElsewhere(await verifier.newPage(), PASSWORD);
  await verifier.close();

  // The next journeys start from the company's dashboard.
  await page.goto(dashboard);
}

async function membersJourney(page: Page, browser: Browser) {
  await page.goto("/");
  await page.getByRole("button", { name: "Français", exact: true }).click();
  const company = new URL(page.url()).pathname;
  await page.goto(`${company}/utilisateurs`);
  await expect(page.getByRole("heading", { name: "Utilisateurs et permissions" })).toBeVisible();
  const invite = page.locator("form").filter({ has: page.getByRole("button", { name: "Inviter un utilisateur", exact: true }) });
  await invite.getByLabel("Courriel", { exact: true }).fill("collegue@exemple.test");
  await invite.getByLabel("Rôle", { exact: true }).selectOption("USER");
  await invite.getByText("Permissions par module", { exact: true }).click();
  await invite.getByLabel("Contacts", { exact: true }).selectOption("read");
  await expectNoPageOverflow(page);
  await captureReference(page, "utilisateurs-permissions", "Inviter un utilisateur");
  await invite.getByRole("button", { name: "Inviter un utilisateur", exact: true }).click();
  const code = await page.getByTestId("invitation-code").textContent();
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const context = watchCsp(await browser.newContext({ ...devices[process.env.E2E_MOBILE === "1" ? "Pixel 7" : "Desktop Chrome"], locale: "fr-CA" }));
  const guest = await context.newPage();
  await guest.goto("/invitation");
  await guest.getByLabel("Code d’invitation").fill(code!);
  await guest.getByLabel("Courriel", { exact: true }).fill("collegue@exemple.test");
  await guest.getByLabel("Nom affiché").fill("Collègue Exemple");
  await guest.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await guest.getByRole("button", { name: "Accepter et continuer" }).click();
  await expect(guest).toHaveURL(/\/connexion$/);
  await guest.getByLabel("Courriel", { exact: true }).fill("collegue@exemple.test");
  await guest.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await guest.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(guest.getByText("Ton rôle : Utilisateur")).toBeVisible();
  expect((await guest.goto(`${company}/utilisateurs`))?.status()).toBe(404);
  expect((await guest.goto("/administration/serveur"))?.status()).toBe(404);
  await guest.goto("/versions");await expect(guest.getByRole("region",{name:`Nouveautés de la version ${VERSION}`,exact:true})).toBeVisible();await expect(guest.getByRole("heading",{name:"Mises à jour du serveur",exact:true})).toHaveCount(0);await expectNoPageOverflow(guest);

  const deniedUpdate=await guest.request.get("/administration/serveur/mises-a-jour/etat");
  expect(deniedUpdate.status()).toBe(403);expect(await deniedUpdate.json()).toEqual({error:"forbidden"});
  await guest.goto(`${company}/parametres`);
  const guestSettings = guest.locator(".workspace-content");
  await expect(guestSettings.getByRole("heading", { name: "Paramètres et administration", exact: true })).toBeVisible();
  for (const name of ["Utilisateurs et permissions", "Serveur, sauvegardes et journaux", "Gérer les intégrations"]) await expect(guestSettings.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(guestSettings.getByRole("link", { name: "Sécurité de mon compte", exact: true })).toBeVisible();
  await guest.goto(`${company}/contacts`);
  await expect(guest.getByRole("link", { name: "Nouveau contact", exact: true })).toHaveCount(0);

  await page.reload(); // the invitation code is deliberately not retained on a refreshed page
  await expect(page.getByTestId("invitation-code")).toHaveCount(0);
  const member = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Collègue Exemple" }) });
  await guest.goto(`${company}/espace/banque`);
  await expect(guest.getByRole("link", { name: "Intégrations", exact: true })).toHaveCount(0);
  await expect(guest.locator(".workspace-content").getByRole("link", { name: "Transactions bancaires", exact: true })).toBeVisible();
  await member.getByText("Permissions par module", { exact: true }).click();
  for (const moduleKey of ["catalog", "sales", "accounting", "taxes", "audit"]) await member.locator(`select[name="${moduleKey}"]`).selectOption("none");
  const saveAccess = async () => {
    await Promise.all([
      page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/utilisateurs")),
      member.getByRole("button", { name: "Enregistrer les accès" }).click(),
    ]);
    await page.reload();
  };
  await saveAccess();
  expect((await guest.request.get(`${company}/remboursements-fournisseurs/export`)).status()).toBe(404);
  await guest.goto(`${company}/contacts`);
  for (const route of ["journal", "taxes", "espace/rapports", "espace/ventes", "espace/banque"]) await expect(guest.locator(`a[href="${company}/${route}"]`)).toHaveCount(0);
  if (process.env.E2E_MOBILE === "1") await guest.getByRole("button", { name: "Menu", exact: true }).click();
  await expectNoPageOverflow(guest);
  await captureReference(guest, "navigation-restreinte");
  const navigationSearch = guest.getByRole("searchbox", { name: "Rechercher une section" }).filter({ visible: true });
  await navigationSearch.fill("DEPENSES");
  await expect(guest.getByRole("navigation", { name: "Navigation de l'entreprise" }).getByRole("status").filter({ visible: true })).toHaveText("1 section trouvée");
  await expect(guest.getByRole("link", { name: "Dépenses", exact: true })).toBeVisible();
  await captureReference(guest, "navigation-recherche");
  await navigationSearch.fill("rapports");
  await expect(guest.getByRole("navigation", { name: "Navigation de l'entreprise" }).getByRole("status").filter({ visible: true })).toHaveText("Aucune section trouvée.");
  await guest.getByRole("button", { name: "Effacer la recherche" }).filter({ visible: true }).click();
  await expect(navigationSearch).toHaveValue("");

  for (const area of ["rapports", "ventes", "banque"]) expect((await guest.goto(`${company}/espace/${area}`))?.status()).toBe(404);
  await guest.goto(`${company}/espace/depenses`);
  await expect(guest.locator(`a[href="${company}/catalogue"]`)).toHaveCount(0);
  await expect(guest.locator(`a[href="${company}/journal"]`)).toHaveCount(0);
  await guest.getByRole("button", { name: "English", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
  await expect(guest.locator(`a[href="${company}/espace/rapports"]`)).toHaveCount(0);
  await guest.getByRole("button", { name: "Français", exact: true }).click();
  await member.getByText("Permissions par module", { exact: true }).click();
  for (const moduleKey of ["catalog", "sales", "accounting", "taxes", "audit"]) await member.locator(`select[name="${moduleKey}"]`).selectOption("default");
  await saveAccess();
  await guest.goto(`${company}/espace/rapports`);
  await expect(guest.locator(".workspace-content").getByRole("link", { name: "Âge des comptes clients", exact: true })).toBeVisible();
  await member.getByLabel("Rôle", { exact: true }).selectOption("READ_ONLY");
  await member.getByRole("button", { name: "Enregistrer les accès" }).click();
  await expect(member.getByRole("status")).toBeVisible();
  await guest.goto(company);
  await expect(guest.getByText("Ton rôle : Lecteur")).toBeVisible();
  await member.getByText("Accès global au serveur", { exact: true }).click();
  await member.getByLabel("Votre mot de passe actuel").fill(PASSWORD);
  await member.getByRole("button", { name: "Autoriser l’administration du serveur" }).click();
  await expect(member.getByRole("button", { name: "Retirer l’administration du serveur" })).toBeVisible();
  await guest.goto("/administration/serveur");
  await expect(guest.getByRole("heading", { name: "Administration du serveur" })).toBeVisible();
  await member.getByLabel("Votre mot de passe actuel").fill(PASSWORD);
  await member.getByRole("button", { name: "Retirer l’administration du serveur" }).click();
  await expect(member.getByRole("button", { name: "Autoriser l’administration du serveur" })).toBeVisible();
  expect((await guest.goto("/administration/serveur"))?.status()).toBe(404);
  await captureReference(page, "utilisateurs-membres");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Users and permissions" })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "utilisateurs-en");
  await page.goto("/administration/serveur");
  await expect(page.getByRole("heading", { name: "Server administration" })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "serveur-en");
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administration du serveur" })).toBeVisible();
  await captureReference(page, "serveur");
  await page.goto(`${company}/utilisateurs`);
  await member.getByText("Retirer l’accès", { exact: true }).first().click();
  const remove = member.locator("form").filter({ has: page.getByRole("button", { name: "Retirer l’accès", exact: true }) });
  await remove.getByLabel("Je confirme cette action.").check();
  await remove.getByRole("button", { name: "Retirer l’accès", exact: true }).click();
  await expect(member).toHaveCount(0);
  expect((await guest.goto(company))?.status()).toBe(404);
  await context.close();
}

async function supplierBillsJourney(page: Page) {
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await openSection(page, "Factures fournisseurs");
  await page.getByRole("link", { name: "Nouveau brouillon", exact: true }).click();
  await page.getByLabel("Fournisseur", { exact: true }).selectOption({ label: "Atelier Boréal" });
  await page.getByLabel("Numéro de facture fournisseur", { exact: true }).fill("FOUR-2026-001");
  await page.getByLabel("Date de facture", { exact: true }).fill("2026-07-15");
  await page.getByLabel("Date d’échéance", { exact: true }).fill("2026-08-15");
  const line = page.getByRole("group", { name: "Ligne 1", exact: true });
  await line.getByLabel("Description").fill("Fournitures de bureau");
  await line.getByLabel("Prix unitaire (CAD)").fill("100");
  await line.getByLabel("Compte de charges").selectOption({ label: "6040 — Fournitures de bureau" });
  await line.getByLabel("Code de taxe").selectOption({ label: "TPS+TVQ" });
  await expectNoPageOverflow(page);
  await captureReference(page, "achat-formulaire");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByRole("heading", { name: "FOUR-2026-001", exact: true })).toBeVisible();
  await expect(page.getByText(/Total:.*114,98/)).toBeVisible();
  await page.getByRole("link", { name: "Modifier le brouillon" }).click();
  await page.getByLabel("Note", { exact: true }).fill("Facture fournisseur de référence");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await page.locator("summary", { hasText: "Valider la facture" }).click();
  await page.getByLabel("Je confirme les montants de la pièce et la récupération intégrale des taxes.").check();
  await page.getByRole("button", { name: "Valider la facture", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A-00001", exact: true })).toBeVisible();
  await expect(page.getByText("Facture comptabilisée", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "achat-valide");
  const supplierBillUrl = page.url();
  await purchasePrintJourney(page, supplierBillUrl, false);
  await page.locator("summary", { hasText: "Enregistrer un décaissement" }).click();
  await page.getByLabel("Montant envoyé", { exact: true }).fill("50,00");
  await page.getByLabel("Date de paiement", { exact: true }).fill("2026-07-15");
  await page.getByRole("button", { name: "Enregistrer le décaissement", exact: true }).click();
  await expect(page).toHaveURL(/decaissements\//);
  await expectNoPageOverflow(page);
  await captureReference(page, "paiement-fournisseur");
  await page.locator("summary", { hasText: "Annuler ce décaissement" }).click();
  await page.getByLabel("Date d’annulation", { exact: true }).fill("2026-07-16");
  await page.getByLabel("Motif (obligatoire, 500 caractères au plus)").fill("Correction du règlement de test");
  await page.getByLabel("Je confirme l’annulation définitive de ce décaissement.").check();
  await page.getByRole("button", { name: "Annuler le décaissement", exact: true }).click();
  await expect(page.getByText("Motif : Correction du règlement de test", { exact: true })).toBeVisible();
  await page.goto(supplierBillUrl);
  await expect(page.getByText(/Solde à payer:.*114,98/)).toBeVisible();
  await page.getByRole("link", { name: "Nouveau crédit fournisseur", exact: true }).click();
  await page.getByLabel("Date de l’avoir", { exact: true }).fill("2026-07-17");
  await page.getByLabel("Motif de l’avoir", { exact: true }).fill("Retour partiel de fournitures");
  await page.getByLabel("Fournitures de bureau", { exact: true }).fill("25,00");
  await page.getByRole("button", { name: "Enregistrer le brouillon d’avoir", exact: true }).click();
  await expect(page.getByText(/Total:.*28,74/)).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "credit-fournisseur-brouillon");
  await page.locator("summary", { hasText: "Valider le crédit fournisseur" }).click();
  await page.getByLabel("Date comptable", { exact: true }).fill("2026-07-17");
  await page.getByLabel("Je confirme la validation comptable et le traitement choisi pour ce crédit.").check();
  await page.getByRole("button", { name: "Valider le crédit fournisseur", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A-00002", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "credit-fournisseur-valide");
  const supplierCreditUrl = page.url();
  await purchasePrintJourney(page, supplierCreditUrl, true);
  await page.goto(supplierBillUrl);
  await expect(page.getByText(/Solde à payer:.*86,24/)).toBeVisible();
  const supplierBase=new URL(supplierBillUrl).pathname.split("/achats/")[0];
  await page.goto(`${supplierBase}/age-fournisseurs?au=2026-07-17`);
  await expect(page.getByRole("heading",{name:"Âge des comptes fournisseurs",exact:true})).toBeVisible();
  await expect(page.getByText("Le total concorde avec le solde des comptes fournisseurs du grand livre.",{exact:true})).toBeVisible();
  const apTotal=page.locator("tfoot tr");await expect(apTotal).toContainText(/86,24\s*\$/);
  await page.locator("details summary").first().locator("span").last().click();
  await expect(page.getByRole("link",{name:"A-00001",exact:true})).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page,"rapport-age-fournisseurs","Âge des comptes fournisseurs");
  const apFile=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);
  expect(apFile.status()).toBe(200);expect(apFile.headers()["cache-control"]).toContain("no-store");
  const apCsv=await apFile.text();expect(apCsv.charCodeAt(0)).toBe(0xfeff);expect(apCsv).toContain("Fournisseur;Pièce;");expect(apCsv).toContain(";Facture fournisseur;A-00001;");expect(apCsv).toContain("86,24");
  await page.getByLabel("Au",{exact:true}).fill("2026-07-15");await page.getByRole("button",{name:"Afficher",exact:true}).click();
  await expect(page.getByText("Soldes au 2026-07-15.",{exact:true})).toBeVisible();await expect(page.locator("tfoot tr")).toContainText(/64,98\s*\$/);
  await page.getByRole("button",{name:"English",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Payables aging",exact:true})).toBeVisible();
  const apEn=await page.request.get((await page.getByRole("link",{name:"Export as CSV",exact:true}).getAttribute("href"))!);
  expect(apEn.headers()["content-disposition"]).toContain("payables-aging_2026-07-15.csv");expect(await apEn.text()).toContain(",Supplier bill,A-00001,");
  await page.getByRole("button",{name:"Français",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Âge des comptes fournisseurs",exact:true})).toBeVisible();
  await page.goto(supplierCreditUrl);
  await page.locator("summary", { hasText: "Annuler l’avoir" }).click();
  await page.getByLabel("Date de contre-passation", { exact: true }).fill("2026-07-18");
  await page.getByLabel("Motif", { exact: true }).fill("Correction du crédit de test");
  await page.getByLabel("Je confirme l’annulation définitive de cet avoir.").check();
  await page.getByRole("button", { name: "Annuler l’avoir", exact: true }).click();
  await expect(page.getByText("Avoir annulé", { exact: true })).toBeVisible();

  await page.goto(supplierBillUrl);
  await expect(page.getByText(/Solde à payer:.*114,98/)).toBeVisible();


  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supplier", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await page.locator("summary", { hasText: "Annuler la facture" }).click();
  await page.getByLabel("Date de contre-passation", { exact: true }).fill("2026-07-19");
  await page.getByLabel("Motif", { exact: true }).fill("Correction de la pièce de test");
  await page.getByLabel("Je confirme l’annulation définitive de cette facture.").check();
  await page.getByRole("button", { name: "Annuler la facture", exact: true }).click();
  await expect(page.getByText("Facture annulée", { exact: true })).toBeVisible();
}

async function paidExpensesJourney(page: Page) {
  await openSection(page, "Dépenses payées");
  await page.getByRole("link", { name: "Nouvelle dépense payée", exact: true }).click();
  await page.getByLabel("Fournisseur", { exact: true }).selectOption({ label: "Atelier Boréal" });
  await page.getByLabel("Numéro de facture fournisseur", { exact: true }).fill("DEP-2026-001");
  await page.getByLabel("Date de dépense", { exact: true }).fill("2026-07-20");
  await page.getByLabel("Compte de paiement", { exact: true }).selectOption({ label: "1000 — Banque – compte courant" });
  await page.getByLabel("Mode de paiement", { exact: true }).selectOption("EFT");
  const line = page.getByRole("group", { name: "Ligne 1", exact: true });
  await line.getByLabel("Description", { exact: true }).fill("Fournitures déjà payées");
  await line.getByLabel("Prix unitaire (CAD)").fill("100");
  await line.getByLabel("Compte de charges").selectOption({ label: "6040 — Fournitures de bureau" });
  await line.getByLabel("Code de taxe").selectOption({ label: "TPS+TVQ" });
  await page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DEP-2026-001", exact: true })).toBeVisible();
  await expect(page.getByText(/Total:.*114,98/)).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "depense-payee-brouillon");
  const evidence = page.getByRole("region", { name: "Justificatifs", exact: true });
  await evidence.getByLabel("Fichier justificatif", { exact: true }).setInputFiles({ name: "faux.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>not a PDF</html>") });
  await evidence.getByRole("button", { name: "Ajouter le justificatif", exact: true }).click();
  await expect(evidence.getByRole("alert")).toContainText("Choisissez un PDF");
  await evidence.getByLabel("Fichier justificatif", { exact: true }).setInputFiles({ name: "recu-test.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=", "base64") });
  await evidence.getByRole("button", { name: "Ajouter le justificatif", exact: true }).click();
  await expect(evidence.getByRole("link", { name: "recu-test.png", exact: true })).toBeVisible();

  await page.locator("summary", { hasText: "Valider la dépense" }).click();
  await page.getByLabel("Je confirme les montants de la pièce et la récupération intégrale des taxes.").check();
  await page.getByRole("button", { name: "Valider la dépense", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A-00003", exact: true })).toBeVisible();
  await expect(page.getByText("Dépense comptabilisée", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "depense-payee-validee");
  await expect(evidence.getByRole("button", { name: "Retirer du brouillon", exact: true })).toHaveCount(0);
  const attachmentUrl=await evidence.getByRole("link", { name: "recu-test.png", exact: true }).getAttribute("href");
  const response=await page.request.get(attachmentUrl!);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-disposition"]).toContain("attachment;");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await response.body()).length).toBe(68);
  const downloadEvent=page.waitForEvent("download");
  await evidence.getByRole("link", { name: "recu-test.png", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("recu-test.png");
  await expectNoPageOverflow(page);
  await captureReference(page, "justificatif-depense", "Justificatifs");

  await page.locator("summary", { hasText: "Annuler la dépense" }).click();
  await page.getByLabel("Date de contre-passation", { exact: true }).fill("2026-07-21");
  await page.getByLabel("Motif", { exact: true }).fill("Correction de la dépense de test");
  await page.getByLabel("Je confirme l’annulation définitive de cette dépense.").check();
  await page.getByRole("button", { name: "Annuler la dépense", exact: true }).click();
  await expect(page.getByText("Dépense annulée", { exact: true })).toBeVisible();
}

async function taxSummaryJourney(page:Page){
 const company=new URL(page.url()).pathname.match(/^\/c\/[^/]+/)![0];
 await page.goto(`${company}/sommaire-taxes?du=2026-07-15&au=2026-07-15`);
 await expect(page.getByRole("heading",{name:"Sommaire TPS/TVQ et autres taxes",exact:true})).toBeVisible();
 await expect(page.getByText("Les mouvements concordent avec les comptes de taxes du grand livre.",{exact:true})).toBeVisible();
 const summary=page.locator("table").first();
 const gst=summary.locator("tbody tr").filter({has:page.getByText("TPS",{exact:true})}).first();
 const qst=summary.locator("tbody tr").filter({has:page.getByText("TVQ",{exact:true})}).first();
 await expect(gst.getByRole("cell").nth(1)).toContainText(/5,00\s*\$/);await expect(qst.getByRole("cell").nth(1)).toContainText(/9,98\s*\$/);
 await expect(gst.getByRole("cell").nth(3)).toContainText(/-5,00\s*\$/);
 await expect(page.getByText("2 lignes comptabilisées.",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"sommaire-taxes","Sommaire TPS/TVQ et autres taxes");
 const file=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);
 expect(file.status()).toBe(200);expect(file.headers()["content-disposition"]).toContain("sommaire-taxes_2026-07-15_2026-07-15.csv");expect(file.headers()["cache-control"]).toContain("no-store");
 const csv=await file.text();expect(csv.charCodeAt(0)).toBe(0xfeff);expect(csv).toContain("TPS;0,00;5,00;0,00;-5,00;0,00;-5,00");expect(csv).toContain("Taxe récupérable");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.getByRole("heading",{name:"GST/QST and other taxes summary",exact:true})).toBeVisible();
 const english=await page.request.get((await page.getByRole("link",{name:"Export as CSV",exact:true}).getAttribute("href"))!);expect(await english.text()).toContain("TPS,0.00,5.00,0.00,-5.00,0.00,-5.00");
 await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Sommaire TPS/TVQ et autres taxes",exact:true})).toBeVisible();
 await page.getByLabel("Au",{exact:true}).fill("2026-07-19");await page.getByRole("button",{name:"Afficher",exact:true}).click();await expect(page.getByText("Écritures du 2026-07-15 au 2026-07-19.",{exact:true})).toBeVisible();
 await expect(page.locator("table").first().locator("tfoot td").nth(3)).toContainText(/0,00\s*\$/);
 await expect(page.getByText("8 lignes comptabilisées.",{exact:true})).toBeVisible();
 const entry=page.locator("table").nth(1).getByRole("link").first();await entry.click();await expect(page).toHaveURL(/\/journal\//);
}


/** Real receipts, grouped deposits and a reversal, after the reports so their independent fixtures remain stable. */
async function bankDepositsJourney(page: Page) {
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0]??"";
 const companyId=company.split("/")[2];const today=todayInToronto();
 await page.getByRole("button",{name:"Français",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Suivi de trésorerie",exact:true})).toBeVisible();
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 let invoiceId:string;
 try{const rows=(await db.query("SELECT id FROM sales_document WHERE company_id=$1 AND kind='INVOICE' AND status='POSTED' AND posting_date<=$2::date AND sales_document_open_cents(company_id,id)>3000 ORDER BY posting_date DESC,id LIMIT 1",[companyId,today])).rows;expect(rows.length).toBe(1);invoiceId=rows[0].id as string;}finally{await db.end();}
 const receipts:{number:string;url:string}[]=[];
 for(const [index,amount] of ["10,00","20,00"].entries()){
  await page.goto(`${company}/factures/validees/${invoiceId}`);
  await page.locator("summary",{hasText:"Enregistrer un encaissement"}).click();
  await page.getByLabel("Montant reçu",{exact:true}).fill(amount);
  await page.getByLabel("Date de réception",{exact:true}).fill(today);
  await page.getByLabel("Compte de réception",{exact:true}).selectOption({label:"1050 · Fonds non déposés"});
  await page.getByLabel("Mode de paiement",{exact:true}).selectOption("CHEQUE");
  await page.getByLabel(/^Référence/).fill(`Lot dépôt test ${index+1}`);
  await page.getByRole("button",{name:"Enregistrer l’encaissement",exact:true}).click();
  const heading=page.getByRole("heading",{name:/^Encaissement E-\d{5}$/});await expect(heading).toBeVisible();
  receipts.push({number:(await heading.innerText()).replace("Encaissement ",""),url:page.url()});
 }
 await page.goto(`${company}/depots`);
 await expect(page.getByRole("heading",{name:"Dépôts bancaires",exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Préparer un dépôt",exact:true}).click();
 await page.getByLabel("Rechercher un encaissement ou une référence",{exact:true}).fill("Lot dépôt test");
 await page.getByRole("button",{name:"Rechercher",exact:true}).click();
 for(const receipt of receipts)await page.getByRole("checkbox",{name:`Déposer ${receipt.number}`,exact:true}).check();
 await page.getByLabel("Compte de destination",{exact:true}).selectOption({label:"1000 · Banque – compte courant"});
 const account=await page.getByLabel("Compte de destination",{exact:true}).inputValue();
 await page.getByLabel("Référence du bordereau (facultative)",{exact:true}).fill("Bordereau groupé de test");
 await expect(page.getByRole("status").filter({hasText:"2 sélectionné(s)"})).toContainText("30,00");
 await expectNoPageOverflow(page);await captureReference(page,"depots-formulaire","Encaissements à déposer");
 await page.getByRole("button",{name:"English",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Prepare a deposit",exact:true})).toBeVisible();
 for(const receipt of receipts)await expect(page.getByRole("checkbox",{name:`Deposit ${receipt.number}`,exact:true})).toBeChecked();
 await expect(page.getByLabel("Destination account",{exact:true})).toHaveValue(account);
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"depots-formulaire-en-dark","Payments to deposit");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Préparer un dépôt",exact:true})).toBeVisible();
 await expect(page.getByLabel("Référence du bordereau (facultative)",{exact:true})).toHaveValue("Bordereau groupé de test");
 await page.getByRole("checkbox",{name:"Je confirme les encaissements, le total, le compte et la date de ce dépôt comptable.",exact:true}).check();
 await page.getByRole("button",{name:"Comptabiliser le dépôt",exact:true}).click();
 const heading=page.getByRole("heading",{name:/^Dépôt DP-\d{5}$/});await expect(heading).toBeVisible();
 const depositNumber=(await heading.innerText()).replace("Dépôt ","");const depositUrl=page.url();
 await expect(page.getByText("Bordereau groupé de test",{exact:true})).toBeVisible();
 for(const receipt of receipts)await expect(page.getByRole("link",{name:receipt.number,exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"depots-detail","Encaissements inclus");
 await page.getByRole("link",{name:"Voir l’écriture du dépôt",exact:true}).click();
 await expect(page.getByRole("heading",{name:/^Écriture J-/})).toBeVisible();
 await expect(page.getByRole("cell",{name:/1050 – Fonds non déposés/})).toBeVisible();
 await page.getByRole("link",{name:"Voir le dépôt d’origine",exact:true}).click();
 await page.getByRole("link",{name:receipts[0]!.number,exact:true}).click();
 await expect(page.getByText("Cet encaissement est dans un dépôt actif. Annulez d’abord le dépôt pour pouvoir annuler l’encaissement.",{exact:true})).toBeVisible();
 await expect(page.locator("summary",{hasText:"Annuler cet encaissement"})).toHaveCount(0);
 await page.goto(depositUrl);await page.locator("summary",{hasText:"Annuler ce dépôt"}).click();
 await page.getByLabel("Date d’annulation du dépôt",{exact:true}).fill(today);
 await page.getByLabel("Motif d’annulation du dépôt",{exact:true}).fill("Bordereau à refaire");
 await page.getByRole("checkbox",{name:"Je confirme l’annulation du dépôt par contre-passation.",exact:true}).check();
 await page.getByRole("button",{name:"Annuler le dépôt",exact:true}).click();
 await expect(page.getByText(`Dépôt annulé le ${today}`,{exact:true})).toBeVisible();
 await expect(page.getByText("Bordereau à refaire",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"depots-annule","Encaissements inclus");
 await page.goto(receipts[0]!.url);await expect(page.locator("summary",{hasText:"Annuler cet encaissement"})).toBeVisible();
 await page.goto(`${company}/depots/nouveau?q=Lot%20dépôt%20test`);
 for(const receipt of receipts)await expect(page.getByRole("checkbox",{name:`Déposer ${receipt.number}`,exact:true})).toBeVisible();
 await page.goto(`${company}/depots`);await expect(page.getByRole("link",{name:depositNumber,exact:true})).toBeVisible();
}

/** Paid-invoice credit, a recorded refund, dated customer statement and reversal. */
async function customerBalancesJourney(page: Page, invoiceUrl: string): Promise<string> {
 const today=todayInToronto(),company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0]??"";
 await page.goto(invoiceUrl);
 // Settle the fixture's remaining balance through the real form before crediting a paid invoice.
 const receive=page.locator("summary",{hasText:"Enregistrer un encaissement"});
 if(await receive.count()){
  await receive.click();await page.getByLabel("Date de réception",{exact:true}).fill(today);
  await page.getByLabel("Compte de réception",{exact:true}).selectOption({label:"1000 · Banque – compte courant"});
  await page.getByRole("button",{name:"Enregistrer l’encaissement",exact:true}).click();
  await expect(page.getByRole("heading",{name:/^Encaissement E-/})).toBeVisible();await page.goto(invoiceUrl);
 }
 await expect(page.getByText("Cette facture est payée en entier.",{exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Préparer un avoir",exact:true}).click();
 await page.getByLabel("Date de l’avoir",{exact:true}).fill(today);
 await page.getByLabel("Motif de l’avoir",{exact:true}).fill("Note interne non destinée au relevé client");
 await page.getByLabel("Consultation comptable",{exact:true}).fill("10");
 await page.getByRole("button",{name:"Enregistrer le brouillon d’avoir",exact:true}).click();
 await page.locator("summary",{hasText:"Valider l’avoir"}).click();
 await page.getByLabel("Traitement de l’avoir",{exact:true}).selectOption("UNAPPLIED");
 await page.getByLabel("Date comptable",{exact:true}).fill(today);
 await page.getByLabel("Je confirme les montants et le traitement choisi pour cet avoir.",{exact:true}).check();
 await captureReference(page,"avoir-disponible-formulaire","Avoir en brouillon");
 await page.getByRole("button",{name:"Valider l’avoir",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Remboursement de l’avoir",exact:true})).toBeVisible();
 const creditUrl=page.url();
 await page.locator("summary",{hasText:"Enregistrer un remboursement"}).click();
 await page.getByLabel("Montant remboursé",{exact:true}).fill("5,00");
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-formulaire","Remboursement de l’avoir");
 await page.getByLabel("Montant remboursé",{exact:true}).fill("99,00");
 await page.getByLabel("Date du remboursement",{exact:true}).fill(today);
 await page.getByLabel("Compte du remboursement",{exact:true}).selectOption({label:"1000 · Banque – compte courant"});
 await page.getByLabel("Je confirme le montant, la date et le compte du remboursement déjà effectué.",{exact:true}).check();
 await page.getByRole("button",{name:"Comptabiliser le remboursement",exact:true}).click();
 await expect(page.locator("form").getByRole("alert")).toContainText("Le montant dépasse l’avoir disponible.");
 await expect(page.getByLabel("Montant remboursé",{exact:true})).toHaveValue("99,00");
 await page.getByLabel("Montant remboursé",{exact:true}).fill("5,00");
 await page.getByLabel("Je confirme le montant, la date et le compte du remboursement déjà effectué.",{exact:true}).check();
 await page.getByRole("button",{name:"Comptabiliser le remboursement",exact:true}).click();
 await expect(page.getByRole("heading",{name:/^Remboursement D-\d{5}$/})).toBeVisible();
 const refundUrl=page.url();
 await expect(page.getByText("5,00 $",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-detail","Origines du remboursement");
 await page.getByRole("button",{name:"English",exact:true}).click();
 await expect(page.getByRole("heading",{name:/^Refund D-/})).toBeVisible();
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-detail-en-dark","Refund origins");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();
 await expect(page.getByRole("heading",{name:/^Remboursement D-/})).toBeVisible();
 await page.goto(`${company}/releves-clients`);
 await page.getByLabel("Client",{exact:true}).selectOption({label:"Atelier Boréal"});
 await page.getByLabel("Du",{exact:true}).fill("2026-01-01");await page.getByLabel("Au",{exact:true}).fill(today);
 await page.getByRole("button",{name:"Afficher le relevé",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Atelier Boréal",exact:true})).toBeVisible();
 await expect(page.locator(".workspace-content")).not.toContainText("Note interne non destinée au relevé client");
 await expectNoPageOverflow(page);await captureReference(page,"releve-client","Atelier Boréal");
 const statementUrl=page.url(),csv=page.getByRole("link",{name:"Exporter en CSV",exact:true});
 const response=await page.request.get((await csv.getAttribute("href"))!);expect(response.status()).toBe(200);
 const body=await response.text();expect(body).toContain("Remboursement D-");expect(body).not.toMatch(/Note interne|journalEntryId|[a-f0-9]{8}-[a-f0-9]{4}-/);
 await page.getByRole("link",{name:"Vue imprimable complète",exact:true}).click();
 await expect(page.getByRole("button",{name:"Imprimer / PDF",exact:true})).toBeVisible();
 await page.emulateMedia({media:"print"});
 await expect(page.locator(".workspace-header")).toBeHidden();await expect(page.getByRole("table")).toBeVisible();
 await page.emulateMedia({media:"screen"});await page.goto(statementUrl);
 await page.getByRole("button",{name:"English",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Customer account statement",exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"releve-client-en-dark","Atelier Boréal");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Relevé de compte client",exact:true})).toBeVisible();
 for(const suffix of ["?contact=invalid","?contact=invalid&contact=","/export?contact=invalid","/export?contact=&contact=invalid"])expect((await page.request.get(`${company}/releves-clients${suffix}`)).status()).toBe(404);
 await page.goto(refundUrl);await page.locator("summary",{hasText:"Annuler le remboursement"}).click();
 await page.getByLabel("Date d’annulation",{exact:true}).fill(today);await page.getByLabel(/^Motif/).fill("Remboursement saisi deux fois");
 await page.getByLabel("Je confirme la contre-passation de ce remboursement.",{exact:true}).check();
 await page.getByRole("button",{name:"Contre-passer le remboursement",exact:true}).click();
 await expect(page.getByText(`Annulé le ${today}`,{exact:true})).toBeVisible();
 await page.goto(creditUrl);await expect(page.getByText(/Disponible :.*11,50/)).toBeVisible();
 await expect(page.getByText(`retiré le ${today}`,{exact:true})).toBeVisible();
 return creditUrl;
}

/** Apply part of an available credit to another invoice, then restore both document balances. */
async function creditApplicationsJourney(page: Page, creditUrl: string): Promise<string> {
 const today=todayInToronto();
 await openSection(page,"Brouillons de factures");
 await page.getByRole("link",{name:"Nouveau brouillon",exact:true}).click();
 await page.getByLabel("Client",{exact:true}).selectOption({label:"Atelier Boréal"});
 await page.getByLabel("Date de facture",{exact:true}).fill(today);
 await page.getByLabel("Date d’échéance",{exact:true}).fill(today);
 const line=page.getByRole("group",{name:"Ligne 1",exact:true});
 await line.getByLabel("Article du catalogue").selectOption({label:"Consultation comptable"});
 await line.getByLabel("Prix unitaire (CAD)").fill("20");
 await line.getByLabel("Compte de revenus").selectOption({label:"4000 — Revenus de services"});
 await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();
 await page.locator("summary",{hasText:"Valider la facture"}).click();
 await page.getByLabel("Date comptable",{exact:true}).fill(today);
 await page.getByLabel("Je confirme les montants et la validation définitive.",{exact:true}).check();
 await page.getByRole("button",{name:"Valider la facture",exact:true}).click();
 const invoiceHeading=page.getByRole("heading",{level:1,name:/^F-\d{5}$/});
 await expect(invoiceHeading).toBeVisible();
 const invoiceNumber=(await invoiceHeading.innerText()).trim(),invoiceUrl=page.url();
 await expect(page.getByText(/^Solde restant:\s*23,00\s*\$/)).toBeVisible();
 await page.goto(creditUrl);
 const panel=page.getByRole("region",{name:"Affectations aux factures",exact:true});
 await expect(panel.getByText(/^Avoir disponible :\s*11,50\s*\$/)).toBeVisible();
 await panel.getByLabel("Rechercher une facture par numéro ou référence",{exact:true}).fill(invoiceNumber);
 await panel.getByRole("button",{name:"Rechercher",exact:true}).click();
 await panel.getByLabel("Facture à régler",{exact:true}).selectOption(new URL(invoiceUrl).pathname.split("/").at(-1)!);
 await panel.getByRole("button",{name:"Réviser l’affectation",exact:true}).click();
 await panel.getByLabel("Montant à affecter",{exact:true}).fill("5,00");
 await panel.getByLabel("Date d’affectation",{exact:true}).fill(today);
 await expect(panel.getByRole("heading",{name:new RegExp(`^Facture ${invoiceNumber} — solde ouvert :`)})).toContainText("23,00");
 await expectNoPageOverflow(page);await captureReference(page,"affectation-avoir-formulaire","Affectations aux factures");
 await panel.getByLabel("Je confirme cette affectation et les soldes affichés.",{exact:true}).check();
 await panel.getByRole("button",{name:"Affecter cet avoir",exact:true}).click();
 const application=panel.getByRole("listitem").filter({has:page.getByRole("link",{name:invoiceNumber,exact:true})});
 await expect(application).toHaveCount(1);
 await expect(application.getByText("Active",{exact:true})).toBeVisible();
 await expect(application).toContainText("5,00");
 await expect(panel.getByText(/^Avoir disponible :\s*6,50\s*\$/)).toBeVisible();
 await application.getByRole("link",{name:invoiceNumber,exact:true}).click();
 await expect(page.getByText(/^Solde restant:\s*18,00\s*\$/)).toBeVisible();
 await page.goto(creditUrl);
 await page.getByRole("button",{name:"English",exact:true}).click();
 const englishPanel=page.getByRole("region",{name:"Invoice applications",exact:true});
 await expect(englishPanel.getByRole("link",{name:invoiceNumber,exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"affectation-avoir-en-dark","Invoice applications");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();
 await application.locator("summary",{hasText:"Désaffecter"}).click();
 await application.getByLabel("Date de désaffectation",{exact:true}).fill(today);
 await application.getByLabel("Je confirme la désaffectation de ce montant.",{exact:true}).check();
 await application.getByRole("button",{name:"Désaffecter",exact:true}).click();
 await expect(application.getByText(`Retirée le ${today}`,{exact:true})).toBeVisible();
 await expect(application.getByRole("button",{name:"Désaffecter",exact:true})).toHaveCount(0);
 await expect(panel.getByText(/^Avoir disponible :\s*11,50\s*\$/)).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"affectation-avoir-retiree","Affectations aux factures");
 for(const query of ["q_affectation=a&q_affectation=b","page_affectation=0","q_affectation=%00"]){
  expect((await page.request.get(`${creditUrl}?${query}`)).status(),`invalid credit application query: ${query}`).toBe(404);
 }
 await page.goto(invoiceUrl);await expect(page.getByText(/^Solde restant:\s*23,00\s*\$/)).toBeVisible();
 return invoiceUrl;
}

/** Sales readers retain the invoice itself when separate accounting or tax access is disabled. */
async function invoiceModulePermissionsJourney(page: Page, invoiceUrl: string) {
 const companyId=new URL(invoiceUrl).pathname.split("/")[2]!;
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 let original:Record<string,unknown>|null=null,userId:string|null=null,originalRole:string|null=null,backupUserId:string|null=null;
 try{
  const membership=await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL]);
  expect(membership.rows).toHaveLength(1);
  userId=membership.rows[0].user_id as string;originalRole=membership.rows[0].role as string;original=membership.rows[0].module_access as Record<string,unknown>|null;
  // Owners deliberately retain all modules. A credential-free backup owner preserves the last-owner invariant
  // while the signed-in fixture exercises real configurable accountant permissions.
  const backup=await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'e2e-backup-'||gen_random_uuid()::text||'@exemple.test','Browser permission fixture',now()) RETURNING id");
  backupUserId=backup.rows[0].id as string;
  await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupUserId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({...original,accounting:"none"})]);
  const accountingResponse=await page.goto(invoiceUrl);expect(accountingResponse?.status()).toBe(200);
  await expect(page.getByRole("heading",{level:1,name:/^F-\d{5}$/})).toBeVisible();
  await expect(page.getByText(/^Solde restant:/)).toHaveCount(0);
  await expect(page.locator("#invoice-payments-title")).toHaveCount(0);
  await expect(page.locator("summary",{hasText:"Enregistrer un encaissement"})).toHaveCount(0);
  await expect(page.locator("summary",{hasText:"Annuler la facture"})).toHaveCount(0);
  await expect(page.locator(`a[href^="/c/${companyId}/journal/"]`)).toHaveCount(0);
  await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({...original,taxes:"none"})]);
  const taxesResponse=await page.goto(invoiceUrl);expect(taxesResponse?.status()).toBe(200);
  await expect(page.getByRole("heading",{level:1,name:/^F-\d{5}$/})).toBeVisible();
  await expect(page.getByText(/^Taxe:\s*1,00\s*\$/)).toBeVisible();
  await expect(page.getByText(/^Taxe:\s*2,00\s*\$/)).toBeVisible();
  await expect(page.getByText(/^Solde restant:\s*23,00\s*\$/)).toBeVisible();
  const printResponse=await page.goto(`${invoiceUrl}/imprimer`);expect(printResponse?.status()).toBe(200);
  await expect(page.getByRole("heading",{level:1,name:/^Facture F-\d{5}$/})).toBeVisible();
  const taxTotals=page.locator(".invoice-totals");
  await expect(taxTotals.locator("p").filter({hasText:/^Taxe\s*1,00\s*\$/})).toBeVisible();
  await expect(taxTotals.locator("p").filter({hasText:/^Taxe\s*2,00\s*\$/})).toBeVisible();
  await expect(taxTotals.locator("p").filter({hasText:/23,00\s*\$/})).toBeVisible();
 }finally{
  try{
   if(userId&&originalRole)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,originalRole,original===null?null:JSON.stringify(original)]);
   if(backupUserId){
    await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupUserId]);
    await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupUserId]);
   }
  }finally{await db.end();}
 }
 await page.goto(invoiceUrl);
 await expect(page.getByText(/^Solde restant:\s*23,00\s*\$/)).toBeVisible();
}

/** Record money already received, allocate across invoices, and release one allocation without moving money. */
async function onAccountReceiptJourney(page: Page, firstInvoiceUrl: string): Promise<string> {
 const today=todayInToronto(),company=new URL(firstInvoiceUrl).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0];
 const firstNumber=(await page.getByRole("heading",{level:1,name:/^F-\d{5}$/}).innerText()).trim();
 await openSection(page,"Brouillons de factures");
 await page.getByRole("link",{name:"Nouveau brouillon",exact:true}).click();
 await page.getByLabel("Client",{exact:true}).selectOption({label:"Atelier Boréal"});
 await page.getByLabel("Date de facture",{exact:true}).fill(today);
 await page.getByLabel("Date d’échéance",{exact:true}).fill(today);
 const line=page.getByRole("group",{name:"Ligne 1",exact:true});
 await line.getByLabel("Article du catalogue").selectOption({label:"Consultation comptable"});
 await line.getByLabel("Prix unitaire (CAD)").fill("10");
 await line.getByLabel("Compte de revenus").selectOption({label:"4000 — Revenus de services"});
 await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();
 await page.locator("summary",{hasText:"Valider la facture"}).click();
 await page.getByLabel("Date comptable",{exact:true}).fill(today);
 await page.getByLabel("Je confirme les montants et la validation définitive.",{exact:true}).check();
 await page.getByRole("button",{name:"Valider la facture",exact:true}).click();
 const secondHeading=page.getByRole("heading",{level:1,name:/^F-\d{5}$/});
 await expect(secondHeading).toBeVisible();
 const secondNumber=(await secondHeading.innerText()).trim(),secondInvoiceUrl=page.url();
 await expect(page.getByText(/^Solde restant:\s*11,50\s*\$/)).toBeVisible();
 await page.goto(`${company}/encaissements/nouveau`);
 await page.locator("#on-account-customer-search").fill("Atelier Boréal");
 await page.locator("form").filter({has:page.locator("#on-account-customer-search")}).getByRole("button",{name:"Rechercher",exact:true}).click();
 await page.getByRole("link",{name:"Atelier Boréal",exact:true}).click();
 await page.getByLabel("Montant reçu",{exact:true}).fill("30,00");
 await page.getByLabel("Date de réception",{exact:true}).fill(today);
 await page.getByLabel("Compte de réception",{exact:true}).selectOption({label:"1000 · Banque – compte courant"});
 await page.getByLabel(/^Référence/).fill("Paiement au compte — test navigateur");
 await expect(page.getByText("Cette opération crée un encaissement et son écriture comptable. Elle ne prélève ni ne transfère de fonds.",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"encaissement-au-compte-formulaire","Encaissement au compte");
 await page.getByLabel("Je confirme avoir déjà reçu ce paiement du client.",{exact:true}).check();
 await page.getByRole("button",{name:"Enregistrer l’encaissement",exact:true}).click();
 await expect(page.getByRole("heading",{level:1,name:/^Encaissement E-\d{5}$/})).toBeVisible();
 const receiptUrl=page.url(),panel=page.getByRole("region",{name:"Affectations aux factures",exact:true});
 await expect(panel.getByText(/^Montant disponible :\s*30,00\s*\$/)).toBeVisible();
 await expect(panel.getByText("Aucune affectation pour cet encaissement.",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"encaissement-au-compte-detail","Affectations aux factures");
 const apply=async(invoiceUrl:string,number:string,amount:string)=>{
  await panel.locator("#receipt-allocation-search").fill(number);
  await panel.getByRole("button",{name:"Rechercher",exact:true}).click();
  await panel.locator("#receipt-allocation-invoice").selectOption(new URL(invoiceUrl).pathname.split("/").at(-1)!);
  await panel.getByRole("button",{name:"Réviser l’affectation",exact:true}).click();
  await panel.getByLabel("Montant à affecter",{exact:true}).fill(amount);
  await panel.getByLabel("Date d’affectation",{exact:true}).fill(today);
  await panel.getByLabel("Je confirme cette affectation et les soldes affichés.",{exact:true}).check();
  await panel.getByRole("button",{name:"Affecter cet encaissement",exact:true}).click();
 };
 await apply(firstInvoiceUrl,firstNumber,"10,00");
 await expect(panel.getByText(/^Montant disponible :\s*20,00\s*\$/)).toBeVisible();
 await apply(secondInvoiceUrl,secondNumber,"5,00");
 await expect(panel.getByText(/^Montant disponible :\s*15,00\s*\$/)).toBeVisible();
 await expect(panel.getByText("Affectation active",{exact:true})).toHaveCount(2);
 await expect(panel.getByText("Affectez un encaissement déjà enregistré à une facture ouverte du même client. Aucun argent n’est transféré et aucune nouvelle écriture comptable n’est créée.",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"encaissement-au-compte-affectation","Affectations aux factures");
 await page.getByRole("button",{name:"English",exact:true}).click();
 const englishPanel=page.getByRole("region",{name:"Invoice applications",exact:true});
 await expect(englishPanel.getByText(/^Available amount:\s*\$15\.00$/)).toBeVisible();
 await expect(englishPanel.getByText("Active allocation",{exact:true})).toHaveCount(2);
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"encaissement-au-compte-en-dark","Invoice applications");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();
 // Wait for the language action to commit before a navigation can cancel it.
 await expect(panel.getByText(/^Montant disponible :\s*15,00\s*\$/)).toBeVisible();
 await page.goto(firstInvoiceUrl);await expect(page.getByText(/^Solde restant:\s*13,00\s*\$/)).toBeVisible();
 await page.goto(secondInvoiceUrl);await expect(page.getByText(/^Solde restant:\s*6,50\s*\$/)).toBeVisible();
 await page.goto(receiptUrl);
 const firstAllocation=panel.getByRole("listitem").filter({has:page.getByRole("link",{name:new RegExp(firstNumber)})});
 await firstAllocation.locator("summary",{hasText:"Désaffecter"}).click();
 await firstAllocation.getByLabel("Date de désaffectation",{exact:true}).fill(today);
 await firstAllocation.getByLabel("Je confirme la désaffectation de ce montant.",{exact:true}).check();
 await firstAllocation.getByRole("button",{name:"Désaffecter",exact:true}).click();
 await expect(firstAllocation.getByText(`retiré le ${today}`,{exact:true})).toBeVisible();
 await expect(firstAllocation.getByRole("button",{name:"Désaffecter",exact:true})).toHaveCount(0);
 await expect(panel.getByText("Affectation active",{exact:true})).toHaveCount(1);
 await expect(panel.getByText(/^Montant disponible :\s*25,00\s*\$/)).toBeVisible();
 for(const query of ["q_affectation=a&q_affectation=b","page_affectation=0","q_affectation=%00"]){
  expect((await page.request.get(`${receiptUrl}?${query}`)).status(),`invalid receipt allocation query: ${query}`).toBe(404);
 }
 await page.goto(firstInvoiceUrl);await expect(page.getByText(/^Solde restant:\s*23,00\s*\$/)).toBeVisible();
 await page.goto(secondInvoiceUrl);await expect(page.getByText(/^Solde restant:\s*6,50\s*\$/)).toBeVisible();
 return receiptUrl;
}

/** Refund only the receipt's available part, retain the invoice allocation, then reverse the refund. */
async function receiptRefundJourney(page: Page, receiptUrl: string) {
 const today=todayInToronto(),invoiceUrl=page.url(),company=new URL(receiptUrl).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0];
 await page.goto(receiptUrl);
 const receiptHeading=page.getByRole("heading",{level:1,name:/^Encaissement E-\d{5}$/});
 await expect(receiptHeading).toBeVisible();
 const receiptNumber=(await receiptHeading.innerText()).replace(/^Encaissement /,"").trim();
 const refunds=page.getByRole("region",{name:"Remboursements de cet encaissement",exact:true});
 const allocations=page.getByRole("region",{name:"Affectations aux factures",exact:true});
 await expect(refunds.getByText(/^Disponible à rembourser :\s*25,00\s*\$/)).toBeVisible();
 await expect(allocations.getByText("Affectation active",{exact:true})).toHaveCount(1);
 await refunds.locator("summary",{hasText:"Enregistrer un remboursement de l’encaissement"}).click();
 await refunds.getByLabel("Montant remboursé",{exact:true}).fill("10,00");
 await refunds.getByLabel("Date du remboursement",{exact:true}).fill(today);
 await refunds.getByLabel("Compte du remboursement",{exact:true}).selectOption({label:"1000 · Banque – compte courant"});
 await expect(refunds.getByText("Remboursez uniquement le montant disponible de cet encaissement. Enregistrez un remboursement déjà effectué ailleurs : Allumi ne transmet aucun ordre bancaire et ne transfère pas de fonds.",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-encaissement-formulaire","Remboursements de cet encaissement");
 await refunds.getByLabel("Je confirme avoir déjà remboursé ce client séparément, avec le montant, la date et le compte indiqués.",{exact:true}).check();
 await refunds.getByRole("button",{name:"Comptabiliser le remboursement",exact:true}).click();
 const refundHeading=page.getByRole("heading",{level:1,name:/^Remboursement D-\d{5}$/});
 await expect(refundHeading).toBeVisible();
 const refundUrl=page.url(),refundNumber=(await refundHeading.innerText()).replace(/^Remboursement /,"").trim();
 const origins=page.getByRole("region",{name:"Origines du remboursement",exact:true});
 const origin=origins.getByRole("link",{name:new RegExp(`^Encaissement ${receiptNumber} ·\\s*10,00\\s*\\$`)});
 await expect(origin).toBeVisible();await expect(origin).toHaveAttribute("href",new URL(receiptUrl).pathname);
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-encaissement-detail","Origines du remboursement");
 await page.getByRole("button",{name:"English",exact:true}).click();
 await expect(page.getByRole("heading",{level:1,name:new RegExp(`^Refund ${refundNumber}$`)})).toBeVisible();
 await expect(page.getByRole("region",{name:"Refund origins",exact:true}).getByRole("link",{name:new RegExp(`^Receipt ${receiptNumber} ·\\s*\\$10\\.00$`)})).toBeVisible();
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-encaissement-en-dark","Refund origins");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();
 await expect(refundHeading).toBeVisible();
 await page.goto(receiptUrl);
 await expect(allocations.getByText(/^Montant disponible :\s*15,00\s*\$/)).toBeVisible();
 await expect(refunds.getByText(/^Disponible à rembourser :\s*15,00\s*\$/)).toBeVisible();
 await expect(refunds.getByRole("link",{name:refundNumber,exact:true})).toBeVisible();
 await expect(refunds.getByText(/^Part de cet encaissement :\s*10,00\s*\$/)).toBeVisible();
 await expect(allocations.getByText("Affectation active",{exact:true})).toHaveCount(1);
 await page.goto(invoiceUrl);await expect(page.getByText(/^Solde restant:\s*6,50\s*\$/)).toBeVisible();
 await page.goto(`${company}/remboursements`);
 await page.getByLabel("Client, numéro ou référence",{exact:true}).fill(receiptNumber);
 await page.getByRole("button",{name:"Filtrer les paiements",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"1 remboursement"})).toBeVisible();
 await page.getByRole("link").filter({has:page.getByRole("heading",{name:refundNumber,exact:true})}).click();
 await expect(refundHeading).toBeVisible();
 await page.locator("summary",{hasText:"Annuler le remboursement"}).click();
 await page.getByLabel("Date d’annulation",{exact:true}).fill(today);
 await page.getByLabel(/^Motif/).fill("Remboursement au compte saisi deux fois");
 await page.getByLabel("Je confirme la contre-passation de ce remboursement.",{exact:true}).check();
 await page.getByRole("button",{name:"Contre-passer le remboursement",exact:true}).click();
 await expect(page.getByText(`Annulé le ${today}`,{exact:true})).toBeVisible();
 await expect(origins.getByText(`· retiré le ${today}`,{exact:true})).toBeVisible();
 await expect(origin).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"remboursement-encaissement-annule","Origines du remboursement");
 for(const [url,key] of [[receiptUrl,"page_remboursements"],[refundUrl,"page_origines"]])for(const query of [`${key}=1&${key}=2`,`${key}=0`,`${key}=%00`]){
  expect((await page.request.get(`${url}?${query}`)).status(),`invalid refund history query: ${query}`).toBe(404);
 }
 await page.goto(invoiceUrl);await expect(page.getByText(/^Solde restant:\s*6,50\s*\$/)).toBeVisible();
 await page.goto(receiptUrl);
 await expect(allocations.getByText(/^Montant disponible :\s*25,00\s*\$/)).toBeVisible();
 await expect(refunds.getByText(/^Disponible à rembourser :\s*25,00\s*\$/)).toBeVisible();
 const refundedHistory=refunds.getByRole("listitem").filter({has:page.getByRole("link",{name:refundNumber,exact:true})});
 await expect(refundedHistory).toContainText(`retiré le ${today}`);
 await expect(allocations.getByText("Affectation active",{exact:true})).toHaveCount(1);
}

/** Legacy unallocated receipts exercise pagination without re-running the already tested receipt form 27 times. */
async function seedPaymentHistory(companyId: string, date: string) {
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 try {
  const user=(await db.query("SELECT id FROM app_user WHERE email=$1",[EMAIL])).rows[0].id;
  const contact=(await db.query("SELECT id FROM contact WHERE company_id=$1 AND is_customer AND display_name='Atelier Boréal'",[companyId])).rows[0].id;
  const bank=(await db.query("SELECT id FROM account WHERE company_id=$1 AND subtype='BANK' ORDER BY code LIMIT 1",[companyId])).rows[0].id;
  const ar=(await db.query("SELECT id FROM account WHERE company_id=$1 AND system_key='ACCOUNTS_RECEIVABLE'",[companyId])).rows[0].id;
  await db.query("BEGIN");await db.query("SET LOCAL ROLE allumi_app");
  await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[user,companyId]);
  for(let i=0;i<27;i++){
   const ids=(await db.query("SELECT gen_random_uuid() AS payment,gen_random_uuid() AS entry")).rows[0];
   const sequence=(await db.query("UPDATE number_sequence SET next_value=next_value+1 WHERE company_id=$1 AND key='JOURNAL_ENTRY' RETURNING next_value-1 AS n",[companyId])).rows[0].n;
   await db.query("INSERT INTO journal_entry(id,company_id,entry_number,entry_date,fiscal_period_id,source_type,source_id,created_by_id) SELECT $1,$2,$3,$4::date,id,'PAYMENT',$5,$6 FROM fiscal_period WHERE company_id=$2 AND $4::date BETWEEN start_date AND end_date",[ids.entry,companyId,sequence,date,ids.payment,user]);
   await db.query("INSERT INTO journal_line(id,company_id,entry_id,line_no,account_id,debit_cents,credit_cents,contact_id,entry_date) VALUES(gen_random_uuid(),$1,$2,1,$3,100,0,NULL,$5::date),(gen_random_uuid(),$1,$2,2,$4,0,100,$6,$5::date)",[companyId,ids.entry,bank,ar,date,contact]);
   await db.query("INSERT INTO payment(id,company_id,number,direction,ledger,contact_id,payment_date,amount_cents,account_id,method,reference,journal_entry_id,created_by_id,updated_at) VALUES($1,$2,$3,'RECEIVED','RECEIVABLE',$4,$5::date,100,$6,'EFT',$7,$8,$9,now())",[ids.payment,companyId,`H-${String(i+1).padStart(5,'0')}`,contact,date,bank,`Historique %_\\ ${String(i).padStart(2,'0')}`,ids.entry,user]);
  }
  await db.query("COMMIT");
 } catch(e){await db.query("ROLLBACK");throw e;}finally{await db.end();}
}
async function paymentHistoryJourney(page: Page) {
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0]??"",today=todayInToronto();
 await seedPaymentHistory(company.slice(3),today);
 await page.goto(`${company}/encaissements`);
 await page.getByLabel("Client, numéro ou référence",{exact:true}).fill("Historique %_\\");
 await page.getByLabel("État du paiement",{exact:true}).selectOption("POSTED");
 await page.getByLabel("Date du paiement — du",{exact:true}).fill(today);await page.getByLabel("Date du paiement — au",{exact:true}).fill(today);
 await page.getByRole("button",{name:"Filtrer les paiements",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"27 encaissements"})).toBeVisible();
 await expect(page.locator(".workspace-content").getByRole("heading",{level:2})).toHaveCount(25);
 await page.getByRole("link",{name:"Suivant",exact:true}).click();
 await expect(page.locator(".workspace-content").getByRole("heading",{level:2})).toHaveCount(2);
 const filters=new URL(page.url()).searchParams;expect(filters.get("q")).toBe("Historique %_\\");expect(filters.get("etat")).toBe("POSTED");expect(filters.get("du")).toBe(today);expect(filters.get("au")).toBe(today);expect(filters.get("page")).toBe("2");
 await expectNoPageOverflow(page);await captureReference(page,"historique-encaissements","Encaissements");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.getByRole("heading",{name:"Payments received",exact:true})).toBeVisible();
 await expect(page.getByLabel("Customer, number or reference",{exact:true})).toHaveValue("Historique %_\\");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expectNoPageOverflow(page);await captureReference(page,"historique-encaissements-en-dark","Payments received");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Encaissements",exact:true})).toBeVisible();
 await page.getByLabel("Client, numéro ou référence",{exact:true}).fill("Modification non soumise");
 await page.getByRole("link",{name:"Réinitialiser les filtres",exact:true}).click();
 await expect(page.getByLabel("Client, numéro ou référence",{exact:true})).toHaveValue("");await expect(page.getByLabel("État du paiement",{exact:true})).toHaveValue("");await expect(page.getByLabel("Date du paiement — du",{exact:true})).toHaveValue("");
 await page.getByLabel("Client, numéro ou référence",{exact:true}).fill("Aucun résultat fictif 999");await page.getByRole("button",{name:"Filtrer les paiements",exact:true}).click();await expect(page.getByRole("heading",{name:"Aucun paiement correspondant",exact:true})).toBeVisible();
 for(const route of ["encaissements","remboursements"])for(const query of ["q=a&q=b","etat=invalid","du=2026-02-30","du=2026-03-01&au=2026-02-01","etat=POSTED&etat=VOID"])expect((await page.request.get(`${company}/${route}?${query}`)).status()).toBe(404);
 await page.goto(`${company}/remboursements`);await page.getByLabel("Client, numéro ou référence",{exact:true}).fill("Atelier Boréal");await page.getByLabel("État du paiement",{exact:true}).selectOption("VOID");await page.getByLabel("Date du paiement — du",{exact:true}).fill(today);await page.getByLabel("Date du paiement — au",{exact:true}).fill(today);await page.getByRole("button",{name:"Filtrer les paiements",exact:true}).click();
 await expect(page.locator(".workspace-content").getByRole("heading",{level:2})).toHaveCount(1);await expect(page.getByRole("status").filter({hasText:"1 remboursement"})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"historique-remboursements","Remboursements clients");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.getByRole("heading",{name:"Customer refunds",exact:true})).toBeVisible();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expectNoPageOverflow(page);await captureReference(page,"historique-remboursements-en-dark","Customer refunds");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.getByRole("heading",{name:"Remboursements clients",exact:true})).toBeVisible();
}

test("estimate delivery, acceptance, private PDF and idempotent draft invoice conversion", async ({ page }) => {
 test.setTimeout(120_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
 await page.goto(`${company}/devis`);await page.getByRole("link",{name:"Nouveau devis",exact:true}).click();
 await page.getByLabel("Client",{exact:true}).selectOption({label:"Atelier Boréal"});
 await page.getByLabel("Référence",{exact:true}).fill("EST-E2E");
 await page.getByLabel("Valide jusqu’au",{exact:true}).fill("2999-01-01");
 await page.getByLabel("Description",{exact:true}).fill("Entretien annuel");await page.getByLabel("Prix unitaire (CAD)",{exact:true}).fill("100");
 for(const [label,code] of [["Compte de revenus","4000"],["Code de taxe","TPS+TVQ"]]) {
  const field=page.getByLabel(label!);await expect(field).toBeVisible();const options=await field.locator("option").allTextContents();const option=options.find(text=>text.startsWith(code!));expect(option,`Estimate ${label}`).toBeTruthy();await field.selectOption({label:option!});
 }
 await page.getByLabel("Note interne — non imprimée",{exact:true}).fill("EST-PRIVATE-NOTE");await page.getByLabel("Conditions — imprimées sur le devis",{exact:true}).fill("Paiement à la livraison");
 await expectNoPageOverflow(page);await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();await expect(page).toHaveURL(/\/devis\/[0-9a-f-]{36}$/);
 const quoteUrl=page.url();
 await page.locator("summary").filter({hasText:"Finaliser et numéroter"}).click();const delivery=page.locator("details").filter({has:page.getByText("Finaliser et numéroter",{exact:true})});await delivery.getByRole("checkbox").check();await delivery.getByRole("button",{name:"Finaliser et numéroter",exact:true}).click();
 await expect(page.getByRole("heading",{name:"DEV-00001",exact:true})).toBeVisible();
 await estimateEmailJourney(page, quoteUrl);
 await page.locator("summary").filter({hasText:"Consigner une acceptation"}).click();const acceptance=page.locator("details").filter({has:page.getByRole("button",{name:"Consigner une acceptation",exact:true})});await acceptance.getByLabel("Note interne sur la réponse",{exact:true}).fill("EST-PRIVATE-RESPONSE");await acceptance.getByRole("checkbox").check();await acceptance.getByRole("button",{name:"Consigner une acceptation",exact:true}).click();
 await expect(page.getByText("Accepté",{exact:true})).toBeVisible();await page.getByRole("link",{name:"Copier en nouveau devis",exact:true}).click();await expect(page.getByLabel("Conditions — imprimées sur le devis",{exact:true})).toHaveValue("Paiement à la livraison");await expect(page.getByLabel("Description",{exact:true})).toHaveValue("Entretien annuel");await page.goto(quoteUrl);await expectNoPageOverflow(page);await captureReference(page,"devis-accepte","DEV-00001");
 await page.getByRole("link",{name:"Imprimer / PDF",exact:true}).click();const paper=page.locator(".invoice-paper");await expect(paper).toContainText("Paiement à la livraison");await expect(paper).not.toContainText("EST-PRIVATE");const printResponse=await page.request.get(page.url());expect((await printResponse.text()).includes("EST-PRIVATE")).toBe(false);await expectNoPageOverflow(page);await captureReference(page,"devis-impression","Devis DEV-00001");
 await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(paper.getByRole("heading",{name:"Estimate DEV-00001",exact:true})).toBeVisible();await expect(paper).not.toContainText("EST-PRIVATE");
 const headerContrast=()=>paper.locator("thead").evaluate(element=>{
  const style=getComputedStyle(element),canvas=document.createElement("canvas");canvas.width=canvas.height=1;const context=canvas.getContext("2d")!;
  const luminance=(color:string)=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=context.getImageData(0,0,1,1).data;return [0.2126,0.7152,0.0722].reduce((sum,weight,index)=>{const channel=rgb[index]!/255;return sum+weight*(channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4);},0);};
  const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
 });
 await expect.poll(headerContrast).toBeGreaterThanOrEqual(4.5);await expectNoPageOverflow(page);await captureReference(page,"devis-en-dark","Estimate DEV-00001");
 await page.emulateMedia({media:"print"});await expect(page.locator(".print-controls")).toBeHidden();await expect(page.locator(".workspace-header")).toBeHidden();await expect(paper).toBeVisible();await expect.poll(headerContrast).toBeGreaterThanOrEqual(4.5);await page.emulateMedia({media:"screen"});
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");await expect(paper.getByRole("heading",{name:"Devis DEV-00001",exact:true})).toBeVisible();await page.goto(quoteUrl);
 await page.locator("summary").filter({hasText:"Créer la facture brouillon"}).click();const conversion=page.locator("details").filter({has:page.getByRole("button",{name:"Créer la facture brouillon",exact:true})});await conversion.getByRole("checkbox").check();await conversion.getByRole("button",{name:"Créer la facture brouillon",exact:true}).click();await expect(page).toHaveURL(/\/factures\/[0-9a-f-]{36}$/);await expect(page.getByRole("link",{name:/Devis source.*DEV-00001/})).toBeVisible();await expect(page.locator(".workspace-content")).not.toContainText("EST-PRIVATE");
 const invoiceUrl=page.url();await page.goto(quoteUrl);await page.getByRole("link",{name:"Voir la facture liée",exact:true}).click();await expect(page).toHaveURL(invoiceUrl);
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();try{const id=quoteUrl.split("/").pop();const rows=await db.query("SELECT e.status,e.converted_invoice_id,d.status AS invoice_status,d.journal_entry_id FROM sales_estimate e JOIN sales_document d ON d.company_id=e.company_id AND d.id=e.converted_invoice_id WHERE e.company_id=$1 AND e.id=$2",[company!.split("/")[2],id]);expect(rows.rows).toHaveLength(1);expect(rows.rows[0]).toMatchObject({status:"CONVERTED",invoice_status:"DRAFT",journal_entry_id:null});}finally{await db.end();}
 await page.goto(`${company}/recherche?type=ESTIMATE&q=EST-E2E`);await expect(page.locator(".workspace-content").getByRole("link",{name:"DEV-00001",exact:true})).toBeVisible();
 for(const suffix of ["?statut=BAD","?q=a&q=b","?q=%00","?page=0","?page=1001"])expect((await page.request.get(`${company}/devis${suffix}`)).status()).toBe(404);
 expect(cspViolations).toEqual([]);
});

test("recurring invoice schedule, reviewed draft generation and retained deleted occurrence",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let invoiceId:string;
 try {const rows=await db.query("SELECT d.id FROM sales_document d JOIN contact c ON c.company_id=d.company_id AND c.id=d.contact_id WHERE d.company_id=$1 AND d.kind='INVOICE' AND d.status='POSTED' AND d.issue_date<$2::date AND c.is_active AND c.anonymized_at IS NULL ORDER BY d.posted_at DESC,d.id DESC LIMIT 1",[company!.split("/")[2],today]);expect(rows.rows).toHaveLength(1);invoiceId=rows.rows[0].id;}finally{await db.end();}
 await page.goto(`${company}/factures/validees/${invoiceId}`);await page.getByRole("link",{name:"Nouvelle récurrence",exact:true}).click();await expect(page.getByLabel("Facture source",{exact:true})).toHaveValue(invoiceId);
 await page.getByLabel("Nom du modèle (interne)",{exact:true}).fill("ABO-INTERNE-E2E");await page.getByLabel("Première date de facture",{exact:true}).fill(today);await page.getByLabel("Dernière date incluse (facultatif)",{exact:true}).fill(today);await page.getByLabel("Jour du mois (1 à 31)",{exact:true}).fill(String(Number(today.slice(8))));await page.getByRole("checkbox",{name:"Je confirme cette opération.",exact:true}).check();await page.getByRole("button",{name:"Créer la récurrence",exact:true}).click();await expect(page).toHaveURL(/\/recurrences\/[0-9a-f-]{36}$/);
 const planUrl=page.url();await expect(page.getByRole("heading",{name:"Échéance à préparer",exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"recurrences-modele","ABO-INTERNE-E2E");
 await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByRole("heading",{name:"Occurrence ready to prepare",exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"recurrences-en-dark","ABO-INTERNE-E2E");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");await expect(page.getByRole("heading",{name:"Échéance à préparer",exact:true})).toBeVisible();
 const generation=page.locator("form").filter({has:page.getByRole("button",{name:"Générer le prochain brouillon",exact:true})});await generation.getByRole("checkbox").check();await generation.getByRole("button").click();await expect(page).toHaveURL(/\/factures\/[0-9a-f-]{36}$/);await expect(page.getByRole("link",{name:"Modèle récurrent source",exact:true})).toBeVisible();await expect(page.locator(".workspace-content")).not.toContainText("ABO-INTERNE-E2E");
 await page.locator("summary").filter({hasText:"Supprimer le brouillon"}).click();const deletion=page.locator("form").filter({has:page.getByRole("button",{name:"Supprimer le brouillon",exact:true})});await deletion.getByRole("checkbox").check();await deletion.getByRole("button").click();await expect(page).toHaveURL(`${company}/factures`);await page.goto(planUrl);
 await expect(page.getByText(/Brouillon supprimé — échéance conservée$/)).toBeVisible();await expect(page.getByRole("button",{name:"Générer le prochain brouillon",exact:true})).toHaveCount(0);await expectNoPageOverflow(page);await captureReference(page,"recurrences-historique","Historique des échéances");
 for(const suffix of ["?page=0","?page=1001","?q=%00","?q=a&q=b","?dues=2"])expect((await page.request.get(`${company}/recurrences${suffix}`)).status()).toBe(404);
 expect(cspViolations).toEqual([]);
});

test("overdue reminder preview, confirmed SMTP send and immutable invoice history", async ({ page }) => {
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
 await page.goto(`${company}/factures/nouvelle`);await page.getByLabel("Client",{exact:true}).selectOption({label:"Atelier Boréal"});
 await page.getByLabel("Date de facture",{exact:true}).fill("2026-06-01");await page.getByLabel("Date d’échéance",{exact:true}).fill("2026-06-02");await page.getByLabel("Référence",{exact:true}).fill("RELANCE-E2E");
 const line=page.getByRole("group",{name:"Ligne 1",exact:true});await line.getByLabel("Article du catalogue").selectOption({label:"Consultation comptable"});await line.getByLabel("Prix unitaire (CAD)").fill("100");await line.getByLabel("Compte de revenus").selectOption({label:"4000 — Revenus de services"});await line.getByLabel("Code de taxe").selectOption({label:"TPS+TVQ"});await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();await expect(page).toHaveURL(/\/factures\/[0-9a-f-]{36}$/);
 await page.locator("summary",{hasText:"Valider la facture"}).click();await page.getByLabel("Date comptable",{exact:true}).fill("2026-06-01");await page.getByLabel("Je confirme les montants et la validation définitive.",{exact:true}).check();await page.getByRole("button",{name:"Valider la facture",exact:true}).click();await expect(page).toHaveURL(/\/factures\/validees\/[0-9a-f-]{36}$/);
 const invoiceId=new URL(page.url()).pathname.split("/").at(-1)!,number=(await page.locator(".workspace-content").getByRole("heading",{level:1}).innerText()).trim();
 await page.goto(`${company}/relances`);await expect(page.getByRole("heading",{name:"Relances clients",exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Apparence",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.getByLabel("Client ou numéro de facture",{exact:true}).fill(number);await page.getByRole("button",{name:"Filtrer les relances",exact:true}).click();await expect(page.locator(".workspace-content").getByRole("heading",{level:2})).toHaveCount(1);await expectNoPageOverflow(page);await captureReference(page,"relances-file","Relances clients");
 await page.getByRole("link",{name:"Préparer une relance",exact:true}).click();await expect(page.getByRole("heading",{name:`Relance de la facture ${number}`,exact:true})).toBeVisible();await expect(page.getByRole("region",{name:"Aperçu du message",exact:true})).toContainText("Solde à payer (CAD)");
 await page.getByLabel("Langue du courriel",{exact:true}).selectOption("en");await page.getByRole("button",{name:"Actualiser l’aperçu",exact:true}).click();await expect(page.getByRole("region",{name:"Aperçu du message",exact:true})).toContainText("Outstanding balance (CAD)");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByRole("heading",{name:"Message preview",exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"relances-apercu-en-dark","Message preview");
 const before=relay.messages.length;await page.getByLabel("Recipient email address",{exact:true}).fill("reminder@example.test");await page.getByRole("checkbox",{name:"I confirm the recipient, balance and sending of this reminder.",exact:true}).check();await page.getByRole("button",{name:"Send reminder",exact:true}).click();await expect(page).toHaveURL(`${company}/factures/validees/${invoiceId}`);
 const history=page.getByRole("region",{name:"Email invoice",exact:true});await expect(history.getByText("Payment reminder · reminder@example.test",{exact:true})).toBeVisible();await expect(history.getByText("Accepted by SMTP server — delivery unconfirmed",{exact:true})).toBeVisible();await expect(history.getByText(/^Balance reminded:/)).toBeVisible();expect(relay.messages).toHaveLength(before+1);expect(relay.messages.at(-1)).toContain("reminder@example.test");await expectNoPageOverflow(page);await captureReference(page,"relances-historique-en-dark","Email invoice");
 await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");await page.getByRole("combobox",{name:"Apparence",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await expect(page.getByRole("heading",{name: number,exact:true})).toBeVisible();
 for(const query of ["?q=a&q=b","?q=%00","?page=0","?page=1001"])expect((await page.request.get(`${company}/relances${query}`)).status()).toBe(404);
 for(const query of ["?lang=es","?lang=en&lang=fr-CA"])expect((await page.request.get(`${company}/relances/${invoiceId}${query}`)).status()).toBe(404);
 expect(cspViolations).toEqual([]);
});

/** Finalized quote, public-only preview and explicit SMTP delivery, then return for manual acceptance. */
async function estimateEmailJourney(page: Page, quoteUrl: string) {
 const title="Historique des courriels du devis";
 await expect(page.getByRole("region",{name:title,exact:true}).getByText("Aucune tentative d’envoi.",{exact:true})).toBeVisible();
 await expectNoPageOverflow(page);await captureReference(page,"devis-courriel-emis",title);
 await page.getByRole("link",{name:"Prévisualiser le courriel du devis",exact:true}).click();await expect(page.getByRole("heading",{name:"Envoyer le devis DEV-00001",exact:true})).toBeVisible();
 const french=page.getByRole("region",{name:"Aperçu du courriel du devis",exact:true});await expect(french).toContainText("Paiement à la livraison");await expect(french).not.toContainText("EST-PRIVATE");await expect(french).toContainText("Aucun paiement n’est demandé");
 await page.getByLabel("Langue du courriel",{exact:true}).selectOption("en");await page.getByRole("button",{name:"Actualiser l’aperçu",exact:true}).click();await expect(french).toContainText("No payment is requested");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 const preview=page.getByRole("region",{name:"Estimate email preview",exact:true});await expect(preview).toContainText("Valid until: 2999-01-01");await expect(preview).toContainText("$114.98");await expect(preview).not.toContainText("EST-PRIVATE");expect(await (await page.request.get(page.url())).text()).not.toContain("EST-PRIVATE");await expectNoPageOverflow(page);await captureReference(page,"devis-courriel-apercu-en-dark","Estimate email preview");
 const before=relay.messages.length;await page.getByLabel("Recipient email address",{exact:true}).fill("estimate@example.test");await page.getByRole("checkbox",{name:"I confirm the recipient, public content and sending of this estimate.",exact:true}).check();await page.getByRole("button",{name:"Send estimate email",exact:true}).click();await expect(page).toHaveURL(quoteUrl);
 const history=page.getByRole("region",{name:"Estimate email history",exact:true});await expect(history.getByText("estimate@example.test",{exact:true})).toBeVisible();await expect(history.getByText("Accepted by SMTP server — delivery unconfirmed",{exact:true})).toBeVisible();expect(relay.messages).toHaveLength(before+1);expect(relay.messages.at(-1)).not.toContain("EST-PRIVATE");await expectNoPageOverflow(page);await captureReference(page,"devis-courriel-historique-en-dark","Estimate email history");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");await expect(page.getByRole("heading",{name:"DEV-00001",exact:true})).toBeVisible();
 for(const query of ["?lang=es","?lang=en&lang=fr-CA"])expect((await page.request.get(`${quoteUrl}/envoyer${query}`)).status()).toBe(404);
}

test("supplier payment filters and complete private CSV export in French and English dark mode", async ({ page }) => {
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
 await page.goto(`${company}/decaissements`);
 await page.getByLabel("Fournisseur, numéro ou référence",{exact:true}).fill("Atelier Boréal");
 await page.getByLabel("État du paiement",{exact:true}).selectOption("VOID");
 await page.getByLabel("Date du paiement — du",{exact:true}).fill("2026-07-15");
 await page.getByLabel("Date du paiement — au",{exact:true}).fill("2026-07-15");
 await page.getByRole("button",{name:"Filtrer les paiements",exact:true}).click();
 await expect(page.getByRole("heading",{name:/^D-\d+$/})).toHaveCount(1);
 const paymentNumber=(await page.getByRole("heading",{name:/^D-\d+$/}).innerText()).trim();
 await expectNoPageOverflow(page);await captureReference(page,"decaissements-recherche");
 const exportLink=page.getByRole("link",{name:"Exporter les paiements (CSV)",exact:true});
 const response=await page.request.get((await exportLink.getAttribute("href"))!);expect(response.status()).toBe(200);
 expect(response.headers()["content-disposition"]).toContain("supplier_payments.csv");expect(response.headers()["cache-control"]).toContain("no-store");
 const french=await response.text();expect(french).toContain("Montant d’origine");expect(french).toContain("50,00");expect(french).toContain(paymentNumber);expect(french).not.toContain("Correction du règlement de test");expect(french.split("\r\n")).toHaveLength(3);
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expect(page.getByLabel("Supplier, number or reference",{exact:true})).toHaveValue("Atelier Boréal");await expectNoPageOverflow(page);await captureReference(page,"decaissements-recherche-en-dark");
 const english=await page.request.get((await page.getByRole("link",{name:"Export payments (CSV)",exact:true}).getAttribute("href"))!);expect(english.status()).toBe(200);expect(await english.text()).toContain("50.00");expect(await english.text()).toContain("Original amount");
 const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("link",{name:"Export payments (CSV)",exact:true}).click()]);expect(download.suggestedFilename()).toBe("supplier_payments.csv");
 for(const suffix of ["?q=a&q=b","?q=%00","?etat=DRAFT","?du=2026-07-16&au=2026-07-15"]) {
  expect((await page.request.get(`${company}/decaissements${suffix}`)).status()).toBe(404);
  expect((await page.request.get(`${company}/decaissements/export${suffix}`)).status()).toBe(404);
 }
 for(const suffix of ["?page=0","?page=1&page=2","?page=100001"])expect((await page.request.get(`${company}/decaissements${suffix}`)).status()).toBe(404);
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
 expect(cspViolations).toEqual([]);
});


/** The original supplier record prints independently of internal detail notes and workspace controls. */
async function purchasePrintJourney(page: Page, documentUrl: string, credit: boolean) {
 await page.getByRole("link",{name:"Imprimer la copie comptable",exact:true}).click();
 const paper=page.getByRole("article",{name:"Copie comptable interne",exact:true});await expect(paper).toContainText("Atelier Boréal");await expect(paper).toContainText(credit ? "28,74" : "114,98");
 for(const privateValue of ["Facture fournisseur de référence","Retour partiel de fournitures"])expect(await (await page.request.get(page.url())).text()).not.toContain(privateValue);
 if(credit){await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByRole("article",{name:"Internal accounting copy",exact:true})).toContainText("$28.74");}
 await expectNoPageOverflow(page);await captureReference(page,credit ? "achats-impression-credit-en-dark" : "achats-impression-facture");
 await page.evaluate(()=>{window.print=()=>document.documentElement.setAttribute("data-purchase-print","true");});await page.getByRole("button",{name:/^(Imprimer ou enregistrer en PDF|Print or save as PDF)$/,exact:true}).click();await expect(page.locator("html")).toHaveAttribute("data-purchase-print","true");
 await page.emulateMedia({media:"print"});await expect(page.locator(".workspace-header")).toBeHidden();await expect(page.locator(".workspace-sidebar")).toBeHidden();await expect(page.locator("nav:visible")).toHaveCount(0);await expect(page.locator(".print-controls")).toBeHidden();
 expect(await page.locator(".invoice-paper").evaluate(el=>getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
 if(process.env.E2E_MOBILE!=="1"){const pdf=await page.pdf({format:"A4",printBackground:true});expect(pdf.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.length).toBeGreaterThan(3000);}
 await page.emulateMedia({media:"screen"});
 if(credit){await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");}
 await page.getByRole("link",{name:"Retour à la pièce comptable",exact:true}).click();await expect(page).toHaveURL(documentUrl);
}

test("purchase print copies respect accounting permissions without Contacts or Taxes and show voids without private reasons", async ({ page }) => {
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();const companyId=company!.split("/")[2];
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,originalRole:string|null=null,originalAccess:unknown=null;
 try{
  const membership=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=membership.user_id;originalRole=membership.role;originalAccess=membership.module_access;
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'purchase-print-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:"read",contacts:"none",taxes:"none",sales:"none"})]);
  const documents=(await db.query("SELECT id,kind FROM purchase_document WHERE company_id=$1 AND number IN ('A-00001','A-00002') ORDER BY number",[companyId])).rows;expect(documents).toHaveLength(2);
  for(const document of documents){
   const base=`${company}/${document.kind==="BILL" ? "achats/validees" : "credits-fournisseurs/valides"}/${document.id}`;
   expect((await page.goto(base))?.status()).toBe(200);await page.getByRole("link",{name:"Imprimer la copie comptable",exact:true}).click();
   const paper=page.getByRole("article",{name:"Copie comptable interne",exact:true});await expect(paper).toContainText("Atelier Boréal");await expect(paper.getByText("Taxe 1",{exact:true})).toBeVisible();await expect(paper.getByText("Taxe 2",{exact:true})).toBeVisible();await expect(paper).toContainText("Pièce annulée");
   const html=await (await page.request.get(page.url())).text();for(const secret of ["Facture fournisseur de référence","Retour partiel de fournitures","Correction du crédit de test","Correction de la pièce"])expect(html).not.toContain(secret);
   await expectNoPageOverflow(page);if(document.kind==="BILL")await captureReference(page,"achats-impression-annulee");
   await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(`${base}/imprimer`)).status()).toBe(404);
   await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:"read",contacts:"none",taxes:"none",sales:"none"})]);
   const wrong=`${company}/${document.kind==="BILL" ? "credits-fournisseurs/valides" : "achats/validees"}/${document.id}/imprimer`;expect((await page.request.get(wrong)).status()).toBe(404);
  }
 }finally{
  if(userId&&originalRole)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,originalRole,originalAccess===null?null:JSON.stringify(originalAccess)]);
  if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();
 }
 expect(cspViolations).toEqual([]);
});

/** Accounting copies use a white paper surface and exclude private detail data from HTML/RSC. */
async function supplierRefundPrintJourney(page: Page, refundUrl: string, voided = false) {
 await page.getByRole("link", { name: "Imprimer la copie comptable", exact: true }).click();
 const paper = page.getByRole("article", { name: "Copie comptable interne", exact: true });
 await expect(paper).toContainText("Atelier Boréal"); await expect(paper).toContainText("10,00"); await expect(paper).toContainText("2026-07-24"); await expect(paper).toContainText("RF-FOUR-E2E");
 const html = await (await page.request.get(page.url())).text();
 for (const secret of ["REFUND-PRIVATE-E2E", "DISPONIBLE-PRIVATE-E2E", "Correction fictive"]) expect(html).not.toContain(secret);
 if (voided) { await expect(paper).toContainText("Remboursement annulé"); await expect(paper).toContainText("2026-07-25"); }
 await expectNoPageOverflow(page); await captureReference(page, voided ? "impression-remboursement-fournisseur-annule" : "impression-remboursement-fournisseur", (await page.getByRole("heading", { level: 1 }).innerText()).trim());
 if (!voided) {
  await page.getByRole("button", { name: "English", exact: true }).click(); await expect(page.locator("html")).toHaveAttribute("lang", "en"); await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark"); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("article", { name: "Internal accounting copy", exact: true })).toContainText("$10.00"); await expectNoPageOverflow(page); await captureReference(page, "impression-remboursement-fournisseur-en-dark", (await page.getByRole("heading", { level: 1 }).innerText()).trim());
 }
 await page.evaluate(() => { window.print = () => document.documentElement.setAttribute("data-refund-print", "true"); });
 await page.getByRole("button", { name: /^(Imprimer ou enregistrer en PDF|Print or save as PDF)$/, exact: true }).click(); await expect(page.locator("html")).toHaveAttribute("data-refund-print", "true");
 await page.emulateMedia({ media: "print" }); await expect(page.locator(".workspace-header")).toBeHidden(); await expect(page.locator(".workspace-sidebar")).toBeHidden(); await expect(page.locator(".print-controls")).toBeHidden(); await expect(page.locator("nav:visible")).toHaveCount(0);
 expect(await page.locator(".invoice-paper").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
 if (process.env.E2E_MOBILE !== "1") { const pdf = await page.pdf({ format: "A4", printBackground: true }); expect(pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(pdf.length).toBeGreaterThan(3000); }
 await page.emulateMedia({ media: "screen" });
 if (!voided) { await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light"); await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); await page.getByRole("button", { name: "Français", exact: true }).click(); await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA"); }
 await page.getByRole("link", { name: "Retour au remboursement", exact: true }).click(); await expect(page).toHaveURL(refundUrl);
}

test("supplier credit stays available on a paid bill, with explicit treatment and reversible posting",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();
 await page.goto(`${company}/achats/nouvelle`);await page.getByLabel("Fournisseur",{exact:true}).selectOption({label:"Atelier Boréal"});await page.getByLabel("Numéro de facture fournisseur",{exact:true}).fill("FOUR-DISPONIBLE-E2E");await page.getByLabel("Date de facture",{exact:true}).fill("2026-07-20");await page.getByLabel("Date d’échéance",{exact:true}).fill("2026-08-20");
 const line=page.getByRole("group",{name:"Ligne 1",exact:true});await line.getByLabel("Description").fill("Fournitures de bureau");await line.getByLabel("Prix unitaire (CAD)").fill("100");await line.getByLabel("Compte de charges").selectOption({label:"6040 — Fournitures de bureau"});await line.getByLabel("Code de taxe").selectOption({label:"TPS+TVQ"});await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();
 await page.locator("summary",{hasText:"Valider la facture"}).click();await page.getByLabel("Date comptable",{exact:true}).fill("2026-07-20");await page.getByLabel("Je confirme les montants de la pièce et la récupération intégrale des taxes.",{exact:true}).check();await page.getByRole("button",{name:"Valider la facture",exact:true}).click();await expect(page).toHaveURL(/\/achats\/validees\/[0-9a-f-]{36}$/);const billUrl=page.url();
 await page.locator("summary",{hasText:"Enregistrer un décaissement"}).click();await page.getByLabel("Montant envoyé",{exact:true}).fill("114,98");await page.getByLabel("Date de paiement",{exact:true}).fill("2026-07-20");await page.getByRole("button",{name:"Enregistrer le décaissement",exact:true}).click();await expect(page).toHaveURL(/\/decaissements\//);
 await page.goto(billUrl);await expect(page.getByText(/^Solde à payer:\s*0,00/)).toBeVisible();await page.getByRole("link",{name:"Nouveau crédit fournisseur",exact:true}).click();await page.getByLabel("Date de l’avoir",{exact:true}).fill("2026-07-21");await page.getByLabel("Motif de l’avoir",{exact:true}).fill("DISPONIBLE-PRIVATE-E2E");await page.getByLabel("Fournitures de bureau",{exact:true}).fill("25,00");await page.getByRole("button",{name:"Enregistrer le brouillon d’avoir",exact:true}).click();
 await page.locator("summary",{hasText:"Valider le crédit fournisseur"}).click();await page.getByLabel("Date comptable",{exact:true}).fill("2026-07-21");await expect(page.getByLabel("Traitement du crédit",{exact:true})).toHaveValue("SOURCE_BILL");await page.getByLabel("Traitement du crédit",{exact:true}).selectOption("UNAPPLIED");await expectNoPageOverflow(page);await captureReference(page,"credit-fournisseur-disponible-choix");await page.getByLabel("Traitement du crédit",{exact:true}).selectOption("SOURCE_BILL");await page.getByLabel("Je confirme la validation comptable et le traitement choisi pour ce crédit.",{exact:true}).check();await page.getByRole("button",{name:"Valider le crédit fournisseur",exact:true}).click();await expect(page.locator("form").getByRole("alert").filter({hasText:"Le solde de la facture est insuffisant"})).toBeVisible();
 await page.getByLabel("Traitement du crédit",{exact:true}).selectOption("UNAPPLIED");await page.getByLabel("Je confirme la validation comptable et le traitement choisi pour ce crédit.",{exact:true}).check();await page.getByRole("button",{name:"Valider le crédit fournisseur",exact:true}).click();await expect(page).toHaveURL(/\/credits-fournisseurs\/valides\/[0-9a-f-]{36}$/);const creditUrl=page.url(),number=(await page.getByRole("heading",{level:1}).innerText()).trim();
 await expect(page.getByRole("region",{name:"Disponible du crédit fournisseur",exact:true})).toContainText("28,74");await expect(page.getByText("Aucune affectation enregistrée.",{exact:true})).toBeVisible();await page.reload();await expect(page.getByRole("heading",{name:number,exact:true})).toBeVisible();
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByRole("region",{name:"Supplier credit available balance",exact:true})).toContainText("$28.74");await expectNoPageOverflow(page);await captureReference(page,"credit-fournisseur-disponible-en-dark");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
 await page.goto(`${company}/credits-fournisseurs/valides`);await expect(page.getByRole("link").filter({has:page.getByRole("heading",{name:number,exact:true})})).toContainText("Disponible : 28,74");await expectNoPageOverflow(page);await captureReference(page,"credit-fournisseur-disponible-liste");
 await page.goto(`${company}/achats/nouvelle`);await page.getByLabel("Fournisseur",{exact:true}).selectOption({label:"Atelier Boréal"});await page.getByLabel("Numéro de facture fournisseur",{exact:true}).fill("FOUR-AFFECTATION-E2E");await page.getByLabel("Date de facture",{exact:true}).fill("2026-07-22");await page.getByLabel("Date d’échéance",{exact:true}).fill("2026-08-22");
 const targetLine=page.getByRole("group",{name:"Ligne 1",exact:true});await targetLine.getByLabel("Description").fill("Autres fournitures");await targetLine.getByLabel("Prix unitaire (CAD)").fill("100");await targetLine.getByLabel("Compte de charges").selectOption({label:"6040 — Fournitures de bureau"});await targetLine.getByLabel("Code de taxe").selectOption({label:"TPS+TVQ"});await page.getByRole("button",{name:"Enregistrer le brouillon",exact:true}).click();
 await page.locator("summary",{hasText:"Valider la facture"}).click();await page.getByLabel("Date comptable",{exact:true}).fill("2026-07-22");await page.getByLabel("Je confirme les montants de la pièce et la récupération intégrale des taxes.",{exact:true}).check();await page.getByRole("button",{name:"Valider la facture",exact:true}).click();await expect(page).toHaveURL(/\/achats\/validees\/[0-9a-f-]{36}$/);const targetUrl=page.url(),targetNumber=(await page.getByRole("heading",{level:1}).innerText()).trim();
 await page.goto(creditUrl);const panel=page.getByRole("region",{name:"Affectations aux factures fournisseurs",exact:true});await panel.getByLabel("Rechercher une facture par numéro ou référence",{exact:true}).fill("FOUR-AFFECTATION-E2E");await panel.getByRole("button",{name:"Rechercher",exact:true}).click();await panel.getByLabel("Facture à régler",{exact:true}).selectOption(new URL(targetUrl).pathname.split("/").at(-1)!);await panel.getByRole("button",{name:"Réviser l’affectation",exact:true}).click();
 await panel.getByLabel("Montant à affecter",{exact:true}).fill("10,00");await panel.getByLabel("Date d’affectation",{exact:true}).fill("2026-07-22");await expectNoPageOverflow(page);await captureReference(page,"affectation-credit-fournisseur-formulaire","Affectations aux factures fournisseurs");await panel.getByLabel("Je confirme cette affectation et les soldes affichés.",{exact:true}).check();await panel.getByRole("button",{name:"Affecter ce crédit",exact:true}).click();
 const application=panel.getByRole("listitem").filter({has:page.getByRole("link",{name:targetNumber,exact:true})});await expect(application.getByText("Active",{exact:true})).toBeVisible();await expect(page.getByRole("region",{name:"Disponible du crédit fournisseur",exact:true})).toContainText("18,74");await page.goto(targetUrl);await expect(page.getByText(/^Solde à payer:\s*104,98/)).toBeVisible();await page.goto(creditUrl);
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByRole("region",{name:"Supplier credit available balance",exact:true})).toContainText("$18.74");await expectNoPageOverflow(page);await captureReference(page,"affectation-credit-fournisseur-en-dark","Supplier bill applications");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
 await application.locator("summary",{hasText:"Désaffecter"}).click();await application.getByLabel("Date de désaffectation",{exact:true}).fill("2026-07-23");await application.getByLabel("Je confirme la désaffectation de ce montant.",{exact:true}).check();await application.getByRole("button",{name:"Désaffecter",exact:true}).click();await expect(application.getByText("Retirée le 2026-07-23",{exact:true})).toBeVisible();await expect(page.getByRole("region",{name:"Disponible du crédit fournisseur",exact:true})).toContainText("28,74");await expectNoPageOverflow(page);await captureReference(page,"affectation-credit-fournisseur-retiree","Affectations aux factures fournisseurs");
 for(const query of ["q_affectation=a&q_affectation=b","page_affectation=0","q_affectation=%00","cible_affectation=invalid"]){expect((await page.request.get(`${creditUrl}?${query}`)).status()).toBe(404);}
 await page.goto(targetUrl);await expect(page.getByText(/^Solde à payer:\s*114,98/)).toBeVisible();
 await page.goto(creditUrl);const refundPanel=page.getByRole("region",{name:"Remboursement reçu du fournisseur",exact:true});await refundPanel.locator("summary",{hasText:"Enregistrer un remboursement reçu"}).click();await refundPanel.getByLabel("Montant remboursé",{exact:true}).fill("10,00");await refundPanel.getByLabel("Date du remboursement",{exact:true}).fill("2026-07-24");
 const refundAccount=refundPanel.getByLabel("Compte du remboursement",{exact:true});const accountLabels=await refundAccount.locator("option").allTextContents();const bank=accountLabels.find(text=>text.startsWith("1000"));expect(bank).toBeTruthy();await refundAccount.selectOption({label:bank!});await refundPanel.getByLabel("Référence (numéro de chèque, de transaction…)",{exact:true}).fill("RF-FOUR-E2E");await refundPanel.getByLabel("Note",{exact:true}).fill("REFUND-PRIVATE-E2E");await expectNoPageOverflow(page);await captureReference(page,"remboursement-fournisseur-formulaire","Remboursement reçu du fournisseur");await refundPanel.getByLabel("Je confirme le montant, la date et le compte du remboursement déjà reçu.",{exact:true}).check();await refundPanel.getByRole("button",{name:"Comptabiliser le remboursement",exact:true}).click();await expect(page).toHaveURL(/\/remboursements-fournisseurs\/[0-9a-f-]{36}$/);const refundUrl=page.url(),refundTitle=(await page.getByRole("heading",{level:1}).innerText()).trim();
 await supplierRefundPrintJourney(page,refundUrl);
 await page.goto(creditUrl);await expect(page.getByRole("region",{name:"Disponible du crédit fournisseur",exact:true})).toContainText("18,74");await page.goto(refundUrl);await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");const englishRefundTitle=(await page.getByRole("heading",{level:1}).innerText()).trim();await expect(page.getByRole("definition").filter({hasText:"$10.00"})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"remboursement-fournisseur-en-dark",englishRefundTitle);
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");await page.locator("summary",{hasText:"Annuler le remboursement"}).click();await page.getByLabel("Date d’annulation",{exact:true}).fill("2026-07-25");await page.getByLabel("Motif (obligatoire, 500 caractères au plus)",{exact:true}).fill("Correction fictive");await page.getByLabel("Je confirme la contre-passation de ce remboursement.",{exact:true}).check();await page.getByRole("button",{name:"Contre-passer le remboursement",exact:true}).click();await expect(page.getByText("Annulé le 2026-07-25",{exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,"remboursement-fournisseur-annule",refundTitle);await supplierRefundPrintJourney(page,refundUrl,true);
 await page.goto(`${company}/remboursements-fournisseurs?q=RF-FOUR-E2E&etat=VOID&du=2026-07-24&au=2026-07-24`);await expect(page.getByRole("heading",{level:2})).toHaveCount(1);
 const csvLink=page.getByRole("link",{name:"Exporter en CSV",exact:true}),csvHref=(await csvLink.getAttribute("href"))!;const csvParams=new URL(csvHref,"http://localhost").searchParams;expect(csvParams.get("q")).toBe("RF-FOUR-E2E");expect(csvParams.get("etat")).toBe("VOID");expect(csvParams.get("du")).toBe("2026-07-24");expect(csvParams.get("au")).toBe("2026-07-24");
 const csvResponse=await page.request.get(csvHref);expect(csvResponse.status()).toBe(200);expect(csvResponse.headers()["cache-control"]).toBe("private, no-store");expect(csvResponse.headers()["x-content-type-options"]).toBe("nosniff");expect(csvResponse.headers()["content-disposition"]).toContain('filename="supplier_refunds.csv"');const frenchCsv=await csvResponse.text();expect(frenchCsv).toContain("10,00");expect(frenchCsv).toContain("Annulé");expect(frenchCsv).not.toContain("REFUND-PRIVATE-E2E");expect(frenchCsv).not.toContain("Correction fictive");expect(frenchCsv.trim().split("\r\n")).toHaveLength(2);expect(await (await page.request.get(csvHref+"&page=2")).text()).toBe(frenchCsv);
 expect((await (await page.request.get(csvHref.replace("etat=VOID","etat=POSTED"))).text()).trim().split("\r\n")).toHaveLength(1);await expectNoPageOverflow(page);await captureReference(page,"export-remboursements-fournisseurs","Remboursements fournisseurs");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");const downloadPromise=page.waitForEvent("download");await page.getByRole("link",{name:"Export CSV",exact:true}).click();const csvDownload=await downloadPromise;expect(csvDownload.suggestedFilename()).toBe("supplier_refunds.csv");const englishCsv=readFileSync((await csvDownload.path())!,"utf8");expect(englishCsv.startsWith("\uFEFF")).toBe(true);expect(englishCsv).toContain("10.00");expect(englishCsv).toContain("Voided");expect(englishCsv).not.toContain("REFUND-PRIVATE-E2E");expect(englishCsv).not.toContain("Correction fictive");await expectNoPageOverflow(page);await captureReference(page,"export-remboursements-fournisseurs-en-dark","Supplier refunds");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
 for(const suffix of ["q=a&q=b","etat=VOID&etat=POSTED","du=2026-02-30","du=2026-07-25&au=2026-07-24"]){expect((await page.request.get(`${company}/remboursements-fournisseurs/export?${suffix}`)).status()).toBe(404);}
for(const query of ["page=0","page=1&page=2"]){expect((await page.request.get(`${refundUrl}?${query}`)).status()).toBe(404);}
 await page.goto(creditUrl);await expect(page.getByRole("region",{name:"Disponible du crédit fournisseur",exact:true})).toContainText("28,74");
 await page.goto(billUrl);await expect(page.getByText(/^Solde à payer:\s*0,00/)).toBeVisible();await page.goto(creditUrl);await page.locator("summary",{hasText:"Annuler l’avoir"}).click();await page.getByLabel("Date de contre-passation",{exact:true}).fill("2026-07-26");await page.getByLabel("Motif",{exact:true}).fill("Correction de disponibilité");await page.getByLabel("Je confirme l’annulation définitive de cet avoir.",{exact:true}).check();await page.getByRole("button",{name:"Annuler l’avoir",exact:true}).click();await expect(page.getByRole("region",{name:"Disponible du crédit fournisseur",exact:true})).toHaveCount(0);await expect(page.getByText("Avoir annulé",{exact:true})).toBeVisible();
 expect(cspViolations).toEqual([]);
});

test("supplier refund print copies require accounting access, preserve origins without directory access and reject other payment kinds", async ({ page }) => {
 cspViolations.length = 0; watchCsp(page.context()); await page.context().addCookies(updateCookies); await page.goto("/");
 if (!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole("link", { name: "Atelier Exemple inc.", exact: true }).click();
 const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0], companyId = company.split("/")[2];
 const db = new pg.Client({ connectionString: e2eUrls().owner }); await db.connect();
 let userId: string | null = null, backupId: string | null = null, originalRole: string | null = null, originalAccess: unknown = null;
 try {
  const membership = (await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2", [companyId, EMAIL])).rows[0]; userId = membership.user_id; originalRole = membership.role; originalAccess = membership.module_access;
  backupId = (await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'refund-print-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())", [companyId, backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2", [companyId, userId, JSON.stringify({ accounting: "read", contacts: "none", taxes: "none", sales: "none" })]);
  const id = (await db.query("SELECT id FROM payment WHERE company_id=$1 AND reference='RF-FOUR-E2E' AND ledger='PAYABLE' AND direction='RECEIVED'", [companyId])).rows[0].id;
  const url = `${company}/remboursements-fournisseurs/${id}/imprimer`;
  expect((await page.goto(url))?.status()).toBe(200); await expect(page.getByRole("article", { name: "Copie comptable interne", exact: true })).toContainText("Atelier Boréal");
  expect(await (await page.request.get(url)).text()).not.toContain("REFUND-PRIVATE-E2E");
  const otherPayment = (await db.query("SELECT id FROM payment WHERE company_id=$1 AND ledger='PAYABLE' AND direction='SENT' LIMIT 1", [companyId])).rows[0].id;
  for (const wrong of [otherPayment, "invalid", "00000000-0000-7000-8000-999999999999"]) expect((await page.request.get(`${company}/remboursements-fournisseurs/${wrong}/imprimer`)).status()).toBe(404);
  expect((await page.request.get(`/c/00000000-0000-7000-8000-999999999999/remboursements-fournisseurs/${id}/imprimer`)).status()).toBe(404);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]); expect((await page.request.get(url)).status()).toBe(404);
 } finally {
  if (userId && originalRole) await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2", [companyId, userId, originalRole, originalAccess === null ? null : JSON.stringify(originalAccess)]);
  if (backupId) { await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2", [companyId, backupId]); await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1", [backupId]); }
  await db.end();
 }
 expect(cspViolations).toEqual([]);
});

test("monthly quarterly annual and custom sales-tax periods use the same exact range for the report and CSV",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());await page.context().addCookies(updateCookies);await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)?.[0];expect(company).toBeTruthy();const base=`${company}/sommaire-taxes`;
 await page.goto(base);await page.getByLabel("Fréquence du rapport",{exact:true}).selectOption("MONTH");await page.getByLabel("Date dans la période",{exact:true}).fill("2026-07-15");await page.getByRole("button",{name:"Afficher cette période",exact:true}).click();await expect(page.getByLabel("Du",{exact:true})).toHaveValue("2026-07-01");await expect(page.getByLabel("Au",{exact:true})).toHaveValue("2026-07-31");
 const csvLink=page.getByRole("link",{name:"Exporter en CSV",exact:true});const monthly=await page.request.get((await csvLink.getAttribute("href"))!);expect(monthly.status()).toBe(200);const explicit=await page.request.get(`${base}/export?du=2026-07-01&au=2026-07-31`);expect(await monthly.text()).toBe(await explicit.text());await expectNoPageOverflow(page);await captureReference(page,"taxes-periodes-mensuelles","Périodes rapides");
 for(const [frequency,from,to] of [["QUARTER","2026-07-01","2026-09-30"],["YEAR","2026-01-01","2026-12-31"]]){
  await page.getByLabel("Fréquence du rapport",{exact:true}).selectOption(frequency!);await page.getByRole("button",{name:"Afficher cette période",exact:true}).click();await expect(page.getByLabel("Du",{exact:true})).toHaveValue(from!);await expect(page.getByLabel("Au",{exact:true})).toHaveValue(to!);
  const download=await page.request.get((await page.getByRole("link",{name:"Exporter en CSV",exact:true}).getAttribute("href"))!);const range=await page.request.get(`${base}/export?du=${from}&au=${to}`);expect(await download.text()).toBe(await range.text());
 }
 await page.getByLabel("Date dans la période",{exact:true}).fill("2999-12-15");await page.getByRole("button",{name:"Afficher cette période",exact:true}).click();await expect(page.getByText("Cette période n’est pas encore terminée. Le rapport reflète uniquement les écritures déjà comptabilisées.",{exact:true})).toBeVisible();
 await page.getByLabel("Date dans la période",{exact:true}).fill("2026-07-15");await page.getByLabel("Fréquence du rapport",{exact:true}).selectOption("QUARTER");await page.getByRole("button",{name:"Afficher cette période",exact:true}).click();await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByLabel("Report frequency",{exact:true})).toHaveValue("QUARTER");await expectNoPageOverflow(page);await captureReference(page,"taxes-periodes-trimestre-en-dark","Quick periods");
 await page.getByLabel("From",{exact:true}).fill("2026-02-01");await page.getByLabel("To",{exact:true}).fill("2026-04-30");await page.getByRole("button",{name:"Show",exact:true}).click();await expect(page.getByLabel("From",{exact:true})).toHaveValue("2026-02-01");await expect(page.getByLabel("To",{exact:true})).toHaveValue("2026-04-30");await expectNoPageOverflow(page);await captureReference(page,"taxes-periodes-personnalisees-en-dark","Custom period");
 for(const suffix of ["?frequence=MONTH&date=2026-02-30","?frequence=MONTH&date=2026-07-15&du=2026-07-01","?frequence=YEAR&frequence=MONTH&date=2026-07-15","?du=2026-07-01&au=2026-06-30","?du=2026-07-01&du=2026-08-01&au=2026-09-30","?frequence=INVALID&date=2026-07-15"]){expect((await page.request.get(`${base}${suffix}`)).status()).toBe(404);expect((await page.request.get(`${base}/export${suffix}`)).status()).toBe(404);}
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await expect(page.locator("html")).toHaveAttribute("data-theme","light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");expect(cspViolations).toEqual([]);
});


test("tax comparison preserves both periods, reconciles source summaries, exports private aggregates and prints in both locales", async ({ page }) => {
 test.setTimeout(90_000); cspViolations.length=0; watchCsp(page.context()); await page.context().addCookies(updateCookies); await page.goto("/");
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],base=`${company}/sommaire-taxes`,companyId=company.split("/")[2];
 const sourceAmounts: string[][]=[];
 for(const [du,au] of [["2026-07-01","2026-07-31"],["2026-08-01","2026-08-31"]]){
  await page.goto(`${base}?du=${du}&au=${au}`);const values=await page.getByRole("table",{name:"Sommaire TPS/TVQ et autres taxes",exact:true}).locator("tfoot tr td").allTextContents();expect(values).toHaveLength(6);sourceAmounts.push(values);
 }
 await page.goto(`${base}?frequence=QUARTER&date=2026-07-15`);await page.getByRole("link",{name:"Comparer les périodes de taxes",exact:true}).click();
 await expect(page.getByLabel("Début de la période étudiée",{exact:true})).toHaveValue("2026-07-01");await expect(page.getByLabel("Fin de la période étudiée",{exact:true})).toHaveValue("2026-09-30");await expect(page.getByLabel("Début de la période de référence",{exact:true})).toHaveValue("2026-04-01");await expect(page.getByLabel("Fin de la période de référence",{exact:true})).toHaveValue("2026-06-30");
 await page.getByLabel("Fin de la période étudiée",{exact:true}).fill("2026-07-31");await page.getByLabel("Début de la période de référence",{exact:true}).fill("2026-08-01");await page.getByLabel("Fin de la période de référence",{exact:true}).fill("2026-08-31");await page.getByRole("button",{name:"Comparer",exact:true}).click();
 const selectedUrl=page.url(),totals=page.getByRole("table",{name:"Total",exact:true}).locator("tbody tr"),cents=(text:string)=>BigInt(text.replace(/[^0-9-]/g,""));
 for(let i=0;i<6;i++){const cells=await totals.nth(i).locator("td").allTextContents();expect(cells[0]).toBe(sourceAmounts[0]![i]);expect(cells[1]).toBe(sourceAmounts[1]![i]);expect(cents(cells[2]!)).toBe(cents(cells[0]!)-cents(cells[1]!));}
 if(process.env.E2E_MOBILE==="1")expect(await page.getByRole("table",{name:"Total",exact:true}).evaluate(el=>el.scrollWidth<=(el.parentElement?.clientWidth??0))).toBe(true);
 const sourceLinks=page.getByRole("link",{name:"Ouvrir le sommaire détaillé",exact:true});await expect(sourceLinks).toHaveCount(2);expect(await sourceLinks.nth(0).getAttribute("href")).toBe(`${base}?du=2026-07-01&au=2026-07-31`);expect(await sourceLinks.nth(1).getAttribute("href")).toBe(`${base}?du=2026-08-01&au=2026-08-31`);
 const csv=page.getByRole("link",{name:"Exporter en CSV",exact:true}),href=(await csv.getAttribute("href"))!,response=await page.request.get(href);expect(response.status()).toBe(200);expect(response.headers()["cache-control"]).toBe("private, no-store");expect(response.headers()["x-content-type-options"]).toBe("nosniff");expect(response.headers()["content-disposition"]).toContain("tax_period_comparison.csv");const french=await response.text();expect(french.startsWith("\uFEFF")).toBe(true);expect(french).toContain("Période étudiée;2026-07-01;2026-07-31");expect(french).toContain("Période de référence;2026-08-01;2026-08-31");for(const secret of ["REFUND-PRIVATE-E2E","DISPONIBLE-PRIVATE-E2E","Facture fournisseur de référence","entryId","accountId"])expect(french).not.toContain(secret);
 await expectNoPageOverflow(page);await captureReference(page,"taxes-comparatif-periodes","Total");
 await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await expect(page.getByLabel("Selected period start",{exact:true})).toHaveValue("2026-07-01");await expect(page.getByLabel("Reference period end",{exact:true})).toHaveValue("2026-08-31");await expectNoPageOverflow(page);await captureReference(page,"taxes-comparatif-periodes-en-dark","Total");
 const downloadPromise=page.waitForEvent("download");await page.getByRole("link",{name:"Export as CSV",exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe("tax_period_comparison.csv");const english=readFileSync((await download.path())!,"utf8");expect(english.startsWith("\uFEFF")).toBe(true);expect(english).toContain("Selected period,2026-07-01,2026-07-31");expect(english).toContain("Reference period,2026-08-01,2026-08-31");
 const beforePrint=await page.locator(".statement-print table").allTextContents();await page.evaluate(()=>{window.print=()=>document.documentElement.setAttribute("data-tax-print","true");});await page.getByRole("button",{name:"Print / PDF",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("data-tax-print","true");await page.emulateMedia({media:"print"});for(const control of await page.locator(".print-controls").all())await expect(control).toBeHidden();await expect(page.locator(".workspace-header")).toBeHidden();await expect(page.locator(".workspace-sidebar")).toBeHidden();expect(await page.locator(".statement-print table").allTextContents()).toEqual(beforePrint);
 if(process.env.E2E_MOBILE!=="1"){const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.length).toBeGreaterThan(3000);}await page.emulateMedia({media:"screen"});
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
 for(const query of ["du_ref=2026-01-01","du_ref=a&au_ref=b","du=2026-07-01&du=2026-08-01&au=2026-08-31","frequence=MONTH&date=2026-07-01&du=2026-07-01","du_ref=2026-07-01&du_ref=2026-08-01&au_ref=2026-08-31","du_ref=2026-02-30&au_ref=2026-03-31","du_ref=2026-03-31&au_ref=2026-03-01","page=2"]){expect((await page.request.get(`${base}/comparer?${query}`)).status()).toBe(404);expect((await page.request.get(`${base}/comparer/export?${query}`)).status()).toBe(404);}
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{
  const member=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'tax-compare-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:"read",taxes:"read",sales:"none",contacts:"none"})]);expect((await page.goto(selectedUrl))?.status()).toBe(200);expect((await page.request.get(href)).status()).toBe(200);
  for(const mask of [{accounting:"none",taxes:"read"},{accounting:"read",taxes:"none"}]){await db.query("UPDATE membership SET module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify(mask)]);expect((await page.request.get(selectedUrl)).status()).toBe(404);expect((await page.request.get(href)).status()).toBe(404);}
  expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/sommaire-taxes/comparer')).status()).toBe(404);
 }finally{
  if(userId&&role)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,role,access===null?null:JSON.stringify(access)]);
  if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();
 }
 expect(cspViolations).toEqual([]);
});


test("accounting search opens inactive account ledgers and manual reversals with read-only modular access",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());
 // This scenario also runs alone against the disposable fresh database, through real onboarding.
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto("/");
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");await page.getByLabel("Ton nom").fill("Alex Exemple");await page.getByLabel("Courriel").fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption("fr-CA");await page.getByLabel("Mot de passe",{exact:true}).fill(PASSWORD);await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);await page.getByRole("button",{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split("/")[2],day=todayInToronto();
 await page.goto(`${company}/comptes`);await page.getByLabel("Code",{exact:true}).fill("1098");await page.getByLabel("Nom (français)",{exact:true}).fill("Banque archive recherche");await page.getByLabel("Nom (anglais)",{exact:true}).fill("Search archive bank");await page.getByLabel("Type",{exact:true}).selectOption("ASSET");await page.getByLabel("Sous-type",{exact:true}).selectOption("BANK");await page.getByLabel("Description (facultatif)",{exact:true}).fill("SEARCH-PRIVATE-ACCOUNT-E2E");await page.getByRole("button",{name:"Créer le compte",exact:true}).click();await expect(page.getByRole("cell",{name:"1098",exact:true})).toBeVisible();
 const accountHref=(await page.getByRole("link",{name:"Modifier le compte 1098",exact:true}).getAttribute("href"))!,accountId=accountHref.split("/").at(-1)!;
 await page.goto(`${company}/journal/nouvelle`);await page.getByLabel("Date",{exact:true}).fill(day);await page.getByLabel("Description",{exact:true}).fill("SEARCH-PRIVATE-JOURNAL-E2E");await page.getByLabel("Ligne 1 – Compte",{exact:true}).selectOption({label:"1098 – Banque archive recherche"});await page.getByLabel("Ligne 1 – Débit",{exact:true}).fill("17,23");await page.getByLabel("Ligne 1 – Note",{exact:true}).fill("SEARCH-PRIVATE-LINE-E2E");await page.getByLabel("Ligne 2 – Compte",{exact:true}).selectOption({label:"3000 – Capital-actions"});await page.getByLabel("Ligne 2 – Crédit",{exact:true}).fill("17,23");await page.getByRole("button",{name:"Enregistrer l'écriture",exact:true}).click();await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);const originalUrl=page.url(),reference=(await page.getByRole("heading",{level:1}).innerText()).replace(/^Écriture /,"").trim();
 await page.getByLabel("Date de la contre-passation",{exact:true}).fill(day);await page.getByLabel("Motif (facultatif)",{exact:true}).fill("SEARCH-PRIVATE-REVERSAL-E2E");await page.getByRole("button",{name:"Contre-passer",exact:true}).click();await expect(page.getByText(`Contre-passation de l'écriture ${reference}`,{exact:true})).toBeVisible();
 await page.goto(`${company}/comptes`);await page.getByRole("button",{name:"Désactiver le compte 1098",exact:true}).click();await expect(page.getByRole("cell",{name:"1098",exact:true})).toHaveCount(0);
 const accountUrl=`${company}/recherche?${new URLSearchParams({type:"ACCOUNT",statut:"INACTIVE",q:"Search archive bank"})}`,entryUrl=`${company}/recherche?${new URLSearchParams({type:"JOURNAL_ENTRY",statut:"REVERSED",q:reference,du:day,au:day,montant:"17,23"})}`;
 await page.goto(accountUrl);const results=page.getByRole("list",{name:"Résultats de recherche",exact:true});await expect(results.getByRole("link",{name:"1098",exact:true})).toBeVisible();await expect(results).toContainText("Banque archive recherche");await expect(results).toContainText("Inactif");await expectNoPageOverflow(page);await captureReference(page,"recherche-comptable-compte","Recherche dans l’entreprise");
 expect(await results.getByRole("link",{name:"1098",exact:true}).getAttribute("href")).toBe(`${company}/grand-livre?compte=${accountId}`);await results.getByRole("link",{name:"1098",exact:true}).click();await expect(page.getByRole("combobox",{name:"Compte",exact:true})).toHaveValue(accountId);await expect(page.locator(`option[value="${accountId}"]`)).toContainText("Inactif");await expect(page.getByRole("heading",{name:"Grand livre",exact:true})).toBeVisible();
 await page.goto(entryUrl);await expect(results.getByRole("link",{name:reference,exact:true})).toBeVisible();await expect(results).toContainText("Contre-passée");await expect(results).toContainText("Total des débits");await expect(results).toContainText("17,23");const html=await (await page.request.get(entryUrl)).text();for(const value of ["SEARCH-PRIVATE-JOURNAL-E2E","SEARCH-PRIVATE-LINE-E2E","SEARCH-PRIVATE-REVERSAL-E2E","SEARCH-PRIVATE-ACCOUNT-E2E"])expect(html).not.toContain(value);await expectNoPageOverflow(page);await captureReference(page,"recherche-comptable-ecriture","Recherche dans l’entreprise");await results.getByRole("link",{name:reference,exact:true}).click();await expect(page).toHaveURL(originalUrl);
 await page.goto(entryUrl);await page.getByRole("button",{name:"English",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","en");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");const english=page.getByRole("list",{name:"Search results",exact:true});await expect(english).toContainText("Reversed");await expect(english).toContainText("Manual entry");await expect(english).toContainText("Total debits");await expect(english).toContainText("$17.23");await expectNoPageOverflow(page);await captureReference(page,"recherche-comptable-ecriture-en-dark","Search company data");await page.goto(accountUrl);await expect(english).toContainText("Search archive bank");
 await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","fr-CA");
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{
  const member=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'account-search-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:"read",contacts:"none",catalog:"none",sales:"none",taxes:"none"})]);
  expect((await page.goto(accountUrl))?.status()).toBe(200);await results.getByRole("link",{name:"1098",exact:true}).click();await expect(page.getByRole("combobox",{name:"Compte",exact:true})).toHaveValue(accountId);expect((await page.request.get(accountHref)).status()).toBe(404);
  expect((await page.goto(entryUrl))?.status()).toBe(200);await results.getByRole("link",{name:reference,exact:true}).click();await expect(page).toHaveURL(originalUrl);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);
  for(const url of [accountUrl,entryUrl]){await page.goto(url);await expect(page.getByText("Aucun résultat. Vérifiez les filtres ou vos permissions.",{exact:true})).toBeVisible();}
  expect((await page.request.get(`${company}/grand-livre?compte=${accountId}`)).status()).toBe(404);expect((await page.request.get(originalUrl)).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/recherche?type=ACCOUNT')).status()).toBe(404);
 }finally{
  if(userId&&role)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,role,access===null?null:JSON.stringify(access)]);
  if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();
 }
 expect(cspViolations).toEqual([]);
});


test("official rate comparison reviews imported codes, dated HST changes and modular read-only access",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());
 // This scenario also runs alone against the disposable fresh database, through real onboarding.
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto("/");
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");await page.getByLabel("Ton nom").fill("Alex Exemple");await page.getByLabel("Courriel").fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption("fr-CA");await page.getByLabel("Mot de passe",{exact:true}).fill(PASSWORD);await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);await page.getByRole("button",{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();

 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split("/")[2];
 await page.goto(`${company}/sources-fiscales`);await page.getByLabel("Province ou territoire",{exact:true}).selectOption("NS");await page.getByLabel("Date de référence",{exact:true}).fill("2025-03-31");await page.getByRole("button",{name:"Consulter les taux",exact:true}).click();await page.getByLabel("Code local",{exact:true}).fill("NS-CMP");
 for(const [label,code] of [["TPS/TVH à remettre","2100"],["TPS/TVH récupérable (facultatif)","1200"]]){const field=page.getByLabel(label!,{exact:true});const match=(await field.locator("option").allTextContents()).find(text=>text.startsWith(code!+" "))!;await field.selectOption({label:match});}
 await page.getByRole("checkbox",{name:/J’ai vérifié la province/}).check();await page.getByRole("button",{name:"Créer le code et ses taxes",exact:true}).click();
 const card=page.getByRole("article").filter({has:page.getByRole("heading",{name:/^NS-CMP —/})});await card.getByRole("link",{name:"Comparer un code aux taux officiels",exact:true}).click();await expect(page.getByLabel("Code local",{exact:true})).toHaveValue("NS-CMP");
 await page.getByLabel("Province ou territoire",{exact:true}).selectOption("NS");await page.getByLabel("Date de référence",{exact:true}).fill("2025-03-31");await page.getByRole("button",{name:"Comparer les taux",exact:true}).click();
 const status=page.getByRole("status");await expect(status).toContainText("Le code standard actif a les mêmes taux");await expect(page.getByRole("article",{name:"Code local à la date choisie",exact:true})).toContainText("15 %");
 await page.getByLabel("Date de référence",{exact:true}).fill("2025-04-01");await page.getByRole("button",{name:"Comparer les taux",exact:true}).click();await expect(status).toContainText("Le code standard actif a les mêmes taux");await expect(page.getByRole("article",{name:"Code local à la date choisie",exact:true})).toContainText("14 %");await expectNoPageOverflow(page);await captureReference(page,"comparaison-code-fiscal","NS-CMP · Nouvelle-Écosse · 2025-04-01");
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null,rateId:string|null=null;
 try{
  const rate=(await db.query("SELECT r.id,t.payable_account_id,t.recoverable_account_id FROM tax_rate r JOIN tax t ON t.company_id=r.company_id AND t.id=r.tax_id WHERE t.company_id=$1 AND t.code='NS-CMP-FED' AND r.effective_from='2025-04-01'",[companyId])).rows[0];rateId=rate.id;
  // Change an unused local definition in this disposable fixture, never a posted document.
  await db.query("UPDATE tax_rate SET rate=0.13 WHERE id=$1",[rateId]);await page.reload();await expect(status).toContainText("Les taux des composantes diffèrent");await expect(page.getByRole("article",{name:"Code local à la date choisie",exact:true})).toContainText("13 %");await expect(page.getByRole("article",{name:"Taux standards officiels",exact:true})).toContainText("14 %");await expectNoPageOverflow(page);await captureReference(page,"comparaison-code-fiscal-ecart","NS-CMP · Nouvelle-Écosse · 2025-04-01");
  await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(status).toContainText("The component rates differ");await expectNoPageOverflow(page);await captureReference(page,"comparaison-code-fiscal-en-dark","NS-CMP · Nova Scotia · 2025-04-01");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();
  const comparisonUrl=page.url(),member=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'tax-comparison-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({taxes:"read",accounting:"none",audit:"none",sales:"none",contacts:"none"})]);await page.reload();await expect(status).toContainText("Les taux des composantes diffèrent");const response=await page.request.get(comparisonUrl);expect(response.status()).toBe(200);const html=await response.text();expect(html).not.toContain(rate.payable_account_id);expect(html).not.toContain(rate.recoverable_account_id);await expect(page.getByRole("button",{name:"Créer le code et ses taxes",exact:true})).toHaveCount(0);
  for(const suffix of ["code=NS-CMP&code=NO","code=NS-CMP&province=NS&province=QC","code=NS-CMP&date=2026-02-30","code=NS-CMP&charger=2","code=NO-SUCH-CODE&charger=1","charger=1"])expect((await page.request.get(`${company}/sources-fiscales/comparer?${suffix}`)).status()).toBe(404);
  await db.query("UPDATE membership SET module_access='{\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(comparisonUrl)).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/sources-fiscales/comparer?code=NS-CMP&province=NS&date=2025-04-01&charger=1')).status()).toBe(404);
 }finally{
  if(rateId)await db.query("UPDATE tax_rate SET rate=0.14 WHERE id=$1",[rateId]);
  if(userId&&role)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,role,access===null?null:JSON.stringify(access)]);
  if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();
 }
 expect(cspViolations).toEqual([]);
});


test("global bank search finds signed statement amounts and respects modular read-only permissions",async({page})=>{
 test.setTimeout(90_000);cspViolations.length=0;watchCsp(page.context());
 // This scenario also runs alone against the disposable fresh database, through real onboarding.
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto("/");
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");await page.getByLabel("Ton nom").fill("Alex Exemple");await page.getByLabel("Courriel").fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption("fr-CA");await page.getByLabel("Mot de passe",{exact:true}).fill(PASSWORD);await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);await page.getByRole("button",{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();

 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split("/")[2];
 await page.goto(`${company}/transactions/importer`);await page.locator('select[name="accountId"]').selectOption({label:"1000 · Banque – compte courant"});await page.getByLabel(/^Fichier du relevé/).setInputFiles({name:"PRIVATE-SEARCH-FILE.csv",mimeType:"text/csv",buffer:Buffer.from("Date,Description,Montant\n2026-06-01,Recherche banque Érable,-17.23\n2026-06-02,Recherche banque Dépôt,17.23\n")});await page.getByRole("button",{name:"Importer le relevé",exact:true}).click();await expect(page.getByRole("heading",{name:"Transactions bancaires",exact:true})).toBeVisible();
 const url=`${company}/recherche?${new URLSearchParams({type:"BANK_TRANSACTION",q:"Recherche banque",montant:"17,23",du:"2026-06-01",au:"2026-06-02"})}`;await page.goto(url);const results=page.getByRole("list",{name:"Résultats de recherche",exact:true});await expect(results.getByRole("link")).toHaveCount(2);await expect(results).toContainText("-17,23");await expect(results).toContainText("Montant signé du relevé");expect(await (await page.request.get(url)).text()).not.toContain("PRIVATE-SEARCH-FILE");await expectNoPageOverflow(page);await captureReference(page,"recherche-bancaire",results);
 const negative=results.getByRole("link",{name:"Recherche banque Érable",exact:true}),detail=(await negative.getAttribute("href"))!;await negative.click();await expect(page.getByRole("heading",{name:"Recherche banque Érable",exact:true})).toBeVisible();await page.getByRole("button",{name:"Mettre de côté",exact:true}).click();await page.goto(url+"&statut=EXCLUDED");await expect(results.getByRole("link")).toHaveCount(1);await expect(results).toContainText("Exclue");
 await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");await expect(page.getByRole("list",{name:"Search results",exact:true})).toContainText("Excluded");await expect(page.getByRole("list",{name:"Search results",exact:true})).toContainText("-$17.23");await expectNoPageOverflow(page);await captureReference(page,"recherche-bancaire-en-dark",page.getByRole("list",{name:"Search results",exact:true}));await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{const member=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'bank-search-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:"read",contacts:"none",sales:"none",taxes:"none"})]);await page.goto(url);await expect(results.getByRole("link")).toHaveCount(2);await results.getByRole("link",{name:"Recherche banque Érable",exact:true}).click();await expect(page.getByRole("heading",{name:"Recherche banque Érable",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:/Rétablir|Restaurer/})).toHaveCount(0);await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(url);await expect(results.getByRole("link")).toHaveCount(0);expect((await page.request.get(detail)).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/recherche?type=BANK_TRANSACTION')).status()).toBe(404);
 }finally{if(userId&&role)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,role,access===null?null:JSON.stringify(access)]);if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();}expect(cspViolations).toEqual([]);
});


test("report search opens existing forms and hides destinations forbidden by modular access",async({page})=>{
 test.setTimeout(120_000);cspViolations.length=0;watchCsp(page.context());
 // This scenario also runs alone against the disposable fresh database, through real onboarding.
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto("/");
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");await page.getByLabel("Ton nom").fill("Alex Exemple");await page.getByLabel("Courriel").fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption("fr-CA");await page.getByLabel("Mot de passe",{exact:true}).fill(PASSWORD);await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);await page.getByRole("button",{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();

 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split("/")[2],path=`${company}/recherche?type=REPORT`;
 await page.goto(path);const results=page.getByRole("list",{name:"Résultats de recherche",exact:true});await expect(results.getByRole("link")).toHaveCount(15);const destinations=await results.getByRole("link").evaluateAll(links=>links.map(link=>link.getAttribute("href")!));for(const href of destinations){expect(href.startsWith(company+'/')).toBe(true);expect((await page.request.get(href)).status(),href).toBe(200);}await expect(results.locator("time")).toHaveCount(0);await expect(results.locator("p.font-semibold")).toHaveCount(0);
 await page.goto(path+'&q=bilan');await expect(results.getByRole("link")).toHaveCount(2);await expect(results).toContainText("Disponible");await expectNoPageOverflow(page);await captureReference(page,"recherche-rapports",results);
 await page.goto(path+'&q=Etat+des+resultats');await results.getByRole("link",{name:"État des résultats",exact:true}).click();await expect(page).toHaveURL(company+'/resultats');await expect(page.getByRole("heading",{level:1})).toBeVisible();
 await page.goto(path+'&q=GST');await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");const english=page.getByRole("list",{name:"Search results",exact:true});await expect(english.getByRole("link")).toHaveCount(2);await expect(english).toContainText("Available");await expectNoPageOverflow(page);await captureReference(page,"recherche-rapports-en-dark",english);await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();
 for(const suffix of ['&montant=0','&du=2026-01-01','&statut=POSTED']){await page.goto(path+suffix);await expect(results.getByRole("link")).toHaveCount(0);}
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{const member=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'report-search-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:"read",sales:"none",contacts:"none",taxes:"none"})]);await page.goto(path);await expect(results.getByRole("link")).toHaveCount(9);for(const route of ['sommaire-taxes','sommaire-taxes/comparer','age-clients','releves-clients','releves-fournisseurs']){await expect(results.locator(`a[href="${company}/${route}"]`)).toHaveCount(0);expect((await page.request.get(`${company}/${route}`)).status()).toBe(404);}
 await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\",\"sales\":\"read\",\"contacts\":\"read\",\"taxes\":\"read\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(path);await expect(results.getByRole("link")).toHaveCount(0);expect((await page.request.get(`${company}/bilan`)).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/recherche?type=REPORT')).status()).toBe(404);
 }finally{if(userId&&role)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,role,access===null?null:JSON.stringify(access)]);if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();}expect(cspViolations).toEqual([]);
});


test("header suggestions support keyboard, touch, stale responses and private authorized endpoints",async({page,browser})=>{
 test.setTimeout(150_000);cspViolations.length=0;watchCsp(page.context());
 // This scenario also runs alone against the disposable fresh database, through real onboarding.
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto("/");
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");await page.getByLabel("Ton nom").fill("Alex Exemple");await page.getByLabel("Courriel").fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption("fr-CA");await page.getByLabel("Mot de passe",{exact:true}).fill(PASSWORD);await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);await page.getByRole("button",{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();

 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split("/")[2],endpoint=`${company}/recherche/suggestions`;
 const header=page.getByRole("search",{name:"Recherche dans l’entreprise",exact:true}),field=header.getByRole("combobox",{name:"Terme recherché",exact:true}),list=header.getByRole("listbox",{name:"Suggestions de recherche",exact:true});
 const requests:string[]=[];page.on("request",request=>{const u=new URL(request.url());if(u.pathname===endpoint)requests.push(u.searchParams.get("q")??"");});await field.fill("b");await page.waitForTimeout(500);expect(requests).toHaveLength(0);
 await field.fill("trial balance");await expect(list.getByRole("option")).toHaveCount(1);await field.press("ArrowDown");await expect(list.getByRole("option")).toHaveAttribute("aria-selected","true");await field.press("Enter");await expect(page).toHaveURL(company+'/balance');await expect(field).toHaveValue("");
 await field.fill("bilan");await expect(list.getByRole("option")).toHaveCount(2);await field.press("Escape");await expect(list).toHaveCount(0);await expect(field).toBeFocused();await field.press("Enter");await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe("bilan");await expect(page).toHaveURL(/\/recherche\?/);
 await field.fill("bilan");await expect(list.getByRole("option")).toHaveCount(2);await expectNoPageOverflow(page);await captureReference(page,"suggestions-recherche",header);const choice=list.getByRole("option").filter({hasText:"Comparaison des bilans"});if(process.env.E2E_MOBILE==="1")await choice.tap();else await choice.click();await expect(page).toHaveURL(company+'/bilan/comparer');
 await page.getByRole("button",{name:"English",exact:true}).click();await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("dark");const englishHeader=page.getByRole("search",{name:"Search company data",exact:true}),englishField=englishHeader.getByRole("combobox",{name:"Search term",exact:true}),englishList=englishHeader.getByRole("listbox",{name:"Search suggestions",exact:true});await englishField.fill("profit and loss");await expect(englishList.getByRole("option")).toHaveCount(2);await expectNoPageOverflow(page);await captureReference(page,"suggestions-recherche-en-dark",englishHeader);await englishField.press("Escape");await page.getByRole("combobox",{name:"Appearance",exact:true}).selectOption("light");await page.getByRole("button",{name:"Français",exact:true}).click();
 const response=await page.request.get(endpoint+'?q=trial+balance');expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');expect(response.headers()['cache-control']).toContain('private');expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin');const body=await response.json();expect(body.rows[0].href).toBe(company+'/balance');expect(Object.keys(body.rows[0]).sort()).toEqual(['href','id','kind','label']);for(const suffix of ['?q=a&q=b','?page=2','?q='+encodeURIComponent('x'.repeat(121)),'?q=%00ab'])expect((await page.request.get(endpoint+suffix)).status()).toBe(400);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/recherche/suggestions?q=bilan')).status()).toBe(404);const guest=await newWatchedContext(browser);try{const r=await guest.request.get(new URL(endpoint,page.url()).href+'?q=bilan');expect(r.status()).toBe(401);expect(r.headers()['cache-control']).toContain('no-store');}finally{await guest.close();}
 // Ignore AbortSignal in this one test so out-of-order responses really reach the client.
 await page.evaluate(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>{const value=typeof input==='string'?input:input instanceof URL?input.href:input.url;return original(input,new URL(value,window.location.origin).pathname.endsWith('/recherche/suggestions')?{...init,signal:undefined}:init);};});
 let releaseOld!:()=>void,oldSeen!:()=>void;const gate=new Promise<void>(resolve=>{releaseOld=resolve;}),seen=new Promise<void>(resolve=>{oldSeen=resolve;});
 await page.route('**/recherche/suggestions?*',async route=>{const q=new URL(route.request().url()).searchParams.get('q');if(q==='oldneedle'){oldSeen();await gate;await route.fulfill({json:{rows:[{id:'balance',kind:'REPORT',label:'OLD STALE',href:company+'/balance'}]}});}else if(q==='newneedle')await route.fulfill({json:{rows:[{id:'bilan',kind:'REPORT',label:'NEW CURRENT',href:company+'/bilan'}]}});else if(q==='evilneedle')await route.fulfill({json:{rows:[{id:'bad',kind:'REPORT',label:'MALICIOUS',href:'https://example.invalid/escape'}]}});else await route.continue();});
 try{await field.fill('oldneedle');await seen;await field.fill('newneedle');await expect(list.getByRole('option')).toContainText('NEW CURRENT');const late=page.waitForResponse(r=>new URL(r.url()).searchParams.get('q')==='oldneedle');releaseOld();await late;await expect(list.getByRole('option')).toContainText('NEW CURRENT');await expect(list).not.toContainText('OLD STALE');await field.fill('evilneedle');await expect(header.getByRole('status')).toContainText('Suggestions indisponibles');await expect(header.getByRole('option')).toHaveCount(0);await field.press('Enter');await expect.poll(()=>new URL(page.url()).searchParams.get('q')).toBe('evilneedle');expect(new URL(page.url()).origin).toMatch(/127\.0\.0\.1/);}finally{releaseOld();await page.unroute('**/recherche/suggestions?*');}
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{const member=(await db.query("SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2",[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'suggestion-'||gen_random_uuid()::text||'@exemple.test','Permission test owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:'none',sales:'none',contacts:'none',catalog:'none',taxes:'none'})]);const denied=await page.request.get(endpoint+'?q=trial+balance');expect(denied.status()).toBe(200);expect((await denied.json()).rows).toEqual([]);expect((await page.request.get(company+'/balance')).status()).toBe(404);
 }finally{if(userId&&role)await db.query("UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,role,access===null?null:JSON.stringify(access)]);if(backupId){await db.query("DELETE FROM membership WHERE company_id=$1 AND user_id=$2",[companyId,backupId]);await db.query("UPDATE app_user SET disabled_at=now() WHERE id=$1",[backupId]);}await db.end();}
 const noJs=watchCsp(await browser.newContext({javaScriptEnabled:false}));try{await noJs.addCookies(await page.context().cookies());const fallback=await noJs.newPage();await fallback.goto(new URL(company+'/balance',page.url()).href);const search=fallback.getByRole('search',{name:'Recherche dans l’entreprise',exact:true});await search.locator('input[name="q"]').fill('trial balance');await search.getByRole('button',{name:'Recherche dans l’entreprise',exact:true}).click();await expect.poll(()=>new URL(fallback.url()).searchParams.get('q')).toBe('trial balance');}finally{await noJs.close();}expect(cspViolations).toEqual([]);
});

test("annual budgets create scenarios, compare exact targets, reject stale edits and honor Accounting access",async({page,browser})=>{
 test.setTimeout(150_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto("/");
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill("e2e-setup-token-123456789");await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");await page.getByLabel("Premier mois de l'exercice financier").selectOption("4");await page.getByLabel("Ton nom").fill("Alex Exemple");await page.getByLabel("Courriel").fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption("fr-CA");await page.getByLabel("Mot de passe",{exact:true}).fill(PASSWORD);await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);await page.getByRole("button",{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole("link",{name:"Atelier Exemple inc.",exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 await page.goto(company+'/espace/rapports');await page.locator('main section').getByRole('link',{name:'Budgets annuels',exact:true}).click();
 await page.getByLabel('Nom du scénario',{exact:true}).fill('Plan annuel 2026');await page.getByRole('button',{name:'Créer un budget',exact:true}).click();await expect(page).toHaveURL(/\/budgets\/[0-9a-f-]{36}$/);
 const detail=page.url();await page.getByText('Ajouter ou remplacer un objectif',{exact:true}).first().click();
 const account=page.getByLabel('Compte',{exact:true});const salesValue=await account.locator('option').filter({hasText:/^4/}).first().getAttribute('value');expect(salesValue).toBeTruthy();await account.selectOption(salesValue!);await page.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('125000,25');await page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(page.getByRole('status')).toContainText('Objectif enregistré.');
 const stale=await browser.newPage();await stale.context().addCookies(await page.context().cookies());await stale.goto(detail);await stale.getByText('Ajouter ou remplacer un objectif',{exact:true}).first().click();await stale.getByLabel('Compte',{exact:true}).selectOption(salesValue!);await stale.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('999');
 await account.selectOption(salesValue!);await page.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('135000,50');await page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(page.getByRole('region',{name:'Budget et réel par compte',exact:true})).toContainText('135');
 await stale.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(stale.locator('form').getByRole('alert')).toContainText('Ce budget a été modifié');await expect(stale.getByLabel('Objectif annuel (CAD)',{exact:true})).toHaveValue('999');await stale.close();
 // Close the editor for useful report references, preserving the exact ledger values from this fixture.
 await page.locator('details[open] summary').click();await expectNoPageOverflow(page);await captureReference(page,'budgets-annuels','Budget et réel par compte');
 const csv=await page.request.get(detail+'/export');expect(csv.status()).toBe(200);expect(csv.headers()['cache-control']).toBe('private, no-store');expect(await csv.text()).toContain('135000,50');expect(await csv.text()).toContain('Exercice complet');
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Budget vs actual by account',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'budgets-annuels-en-dark','Budget vs actual by account');expect(await (await page.request.get(detail+'/export')).text()).toContain('135000.50');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'budget-'||gen_random_uuid()::text||'@exemple.test','Budget fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access=$3::jsonb WHERE company_id=$1 AND user_id=$2",[companyId,userId,JSON.stringify({accounting:'read',contacts:'none',sales:'none',taxes:'none',audit:'none'})]);await page.reload();await expect(page.getByRole('region',{name:'Budget et réel par compte',exact:true})).toContainText('135');await expect(page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true})).toHaveCount(0);expect((await page.request.get(detail+'/export')).status()).toBe(200);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(detail)).status()).toBe(404);expect((await page.request.get(detail+'/export')).status()).toBe(404);expect((await page.request.get(company+'/budgets')).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/budgets')).status()).toBe(404);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,access===null?'{}':JSON.stringify(access)]);if(backupId){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backupId]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backupId]);}await db.end();}
 await page.goto(detail);const remove=page.getByRole('button',{name:/Retirer l’objectif du compte/}).first();await remove.click();await expect(page.getByRole('region',{name:'Budget et réel par compte',exact:true}).getByText('135')).toHaveCount(0);expect(cspViolations).toEqual([]);
});

test("budget duplication reviews exclusions, refuses stale previews and keeps copies independent",async({page,browser})=>{
 test.setTimeout(150_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel("Premier mois de l'exercice financier").selectOption('4');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption('fr-CA');await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 await page.goto(company+'/budgets');await page.getByLabel('Nom du scénario',{exact:true}).fill('Objectifs à reprendre');await page.getByRole('button',{name:'Créer un budget',exact:true}).click();await expect(page).toHaveURL(/\/budgets\/[0-9a-f-]{36}$/);const source=page.url(),sourceId=new URL(source).pathname.split('/').at(-1)!;
 await page.locator('details summary').click();const accounts=page.getByLabel('Compte',{exact:true});const revenue=(await accounts.locator('option').filter({hasText:/^4/}).first().getAttribute('value'))!,expense=(await accounts.locator('option').filter({hasText:/^5/}).first().getAttribute('value'))!;
 await accounts.selectOption(revenue);await page.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('85000,75');await page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(page.getByRole('status')).toContainText('Objectif enregistré.');await accounts.selectOption(expense);await page.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('12500,25');await page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(page.getByRole('region',{name:'Budget et réel par compte',exact:true})).toContainText('12');
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{
  const accountBefore=(await db.query('SELECT is_active FROM account WHERE id=$1',[expense])).rows[0].is_active;
  await db.query('UPDATE account SET is_active=false WHERE id=$1',[expense]);
  await page.getByRole('link',{name:'Dupliquer le budget',exact:true}).click();await expect(page).toHaveURL(/\/dupliquer$/);const duplicateUrl=page.url();await expect(page.getByRole('heading',{name:'Dupliquer un budget annuel',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Aperçu du budget source',exact:true})).toContainText('1 objectif inactif');await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Copie annuelle');await page.locator('details summary').click();await expect(page.locator('details')).toContainText('Sera exclu si confirmé');await expectNoPageOverflow(page);await captureReference(page,'duplication-budget','Aperçu du budget source');
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Duplicate an annual budget',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'duplication-budget-en-dark','Source budget preview');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();
  await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Copie annuelle');const check=page.getByRole('checkbox',{name:/J’exclus explicitement/});await expect(check).not.toBeChecked();await page.getByRole('button',{name:'Créer la copie',exact:true}).click();await expect(page).toHaveURL(duplicateUrl);expect(await check.evaluate(e=>(e as HTMLInputElement).validity.valueMissing)).toBe(true);await check.check();
  const stale=await browser.newPage();await stale.context().addCookies(await page.context().cookies());await stale.goto(duplicateUrl);await stale.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Aperçu périmé');await stale.getByRole('checkbox',{name:/J’exclus explicitement/}).check();
  // An eligibility change in the disposable fixture invalidates both previews without changing any target.
  await db.query('UPDATE account SET is_active=true WHERE id=$1',[expense]);await stale.getByRole('button',{name:'Créer la copie',exact:true}).click();await expect(stale.locator('form').getByRole('alert')).toContainText('ont changé depuis cet aperçu');await expect(stale.getByLabel('Nom du nouveau scénario',{exact:true})).toHaveValue('Aperçu périmé');await stale.close();
  await db.query('UPDATE account SET is_active=false WHERE id=$1',[expense]);await page.getByRole('button',{name:'Créer la copie',exact:true}).click();await expect(page).toHaveURL(/\/budgets\/[0-9a-f-]{36}$/);expect(page.url()).not.toBe(source);const copied=page.url(),copyId=new URL(copied).pathname.split('/').at(-1)!;await expect(page.getByRole('heading',{name:'Copie annuelle',exact:true})).toBeVisible();
  const rows=(await db.query('SELECT budget_id,account_id,amount_cents::text FROM budget_line WHERE budget_id=ANY($1::uuid[]) ORDER BY account_id',[[sourceId,copyId]])).rows;expect(rows.filter(r=>r.budget_id===sourceId)).toHaveLength(2);expect(rows.filter(r=>r.budget_id===copyId)).toEqual([{budget_id:copyId,account_id:revenue,amount_cents:'8500075'}]);await db.query('UPDATE account SET is_active=$2 WHERE id=$1',[expense,accountBefore]);
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'copy-'||gen_random_uuid()::text||'@exemple.test','Copy fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(source);await expect(page.getByRole('link',{name:'Dupliquer le budget',exact:true})).toHaveCount(0);expect((await page.request.get(duplicateUrl)).status()).toBe(404);expect((await page.request.get(company+'/budgets/'+sourceId)).status()).toBe(200);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/budgets/'+sourceId+'/dupliquer')).status()).toBe(404);
 }finally{await db.query('UPDATE account SET is_active=true WHERE id=$1',[expense]);if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,access===null?'{}':JSON.stringify(access)]);if(backupId){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backupId]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backupId]);}await db.end();}expect(cspViolations).toEqual([]);
});

test("budget CSV import previews locally, resets approval, validates accounts and creates an audited scenario",async({page})=>{
 test.setTimeout(150_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel("Premier mois de l'exercice financier").selectOption('4');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption('fr-CA');await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2],url=company+'/budgets/importer';
 await page.goto(company+'/budgets');await page.getByRole('link',{name:'Importer un CSV',exact:true}).click();await expect(page).toHaveURL(url);
 const file={name:'PRIVATE-BUDGET.csv',mimeType:'text/csv',buffer:Buffer.from('account_code;annual_target\n4000;85000,75\n5000;0,00\n')};
 const template=await page.request.get(url+'/modele?format=fr-CA');expect(template.status()).toBe(200);expect(template.headers()['cache-control']).toBe('private, no-store');expect(await template.text()).toContain('account_code;annual_target');expect((await page.request.get(url+'/modele?format=en&format=fr-CA')).status()).toBe(400);
 await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('CSV annuel importé');const fiscal=page.getByLabel('Exercice du nouveau scénario',{exact:true});await fiscal.selectOption({index:1});const year=await fiscal.inputValue();
 let track=true;const posts:string[]=[];page.on('request',r=>{if(track&&r.method()==='POST'&&new URL(r.url()).pathname===url)posts.push(r.url());});
 const upload=page.getByLabel('Fichier CSV UTF-8',{exact:true});await upload.setInputFiles(file);await expect(page.getByRole('status')).toContainText('2 objectifs prêts');await expect(page.getByRole('region',{name:'Aperçu des objectifs à importer',exact:true})).toContainText('85');const approval=page.getByRole('checkbox',{name:/J’ai vérifié ces 2 objectifs/});await expect(approval).not.toBeChecked();await approval.check();
 await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('CSV annuel importé 2');await expect(approval).not.toBeChecked();await approval.check();await fiscal.selectOption('');await expect(approval).not.toBeChecked();await fiscal.selectOption(year);
 await approval.check();await page.getByLabel('Format du fichier CSV',{exact:true}).selectOption('en');await expect(page.locator('form').getByRole('alert')).toContainText('en-têtes');await page.getByLabel('Format du fichier CSV',{exact:true}).selectOption('fr-CA');await expect(approval).not.toBeChecked();
 await upload.setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:Buffer.from('account_code;annual_target\n4000;1,00\n4000;2,00')});await expect(page.locator('form').getByRole('alert')).toContainText('plusieurs fois');await expect(page.getByRole('button',{name:'Créer le budget depuis le CSV',exact:true})).toHaveCount(0);
 await upload.setInputFiles(file);await expect(page.getByRole('status')).toContainText('2 objectifs prêts');expect(posts).toEqual([]);track=false;await expectNoPageOverflow(page);await captureReference(page,'import-budget-csv','Aperçu des objectifs à importer');await approval.check();
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Import annual targets',exact:true})).toBeVisible();await expect(page.locator('input[name="confirmed"]')).not.toBeChecked();await expectNoPageOverflow(page);await captureReference(page,'import-budget-csv-en-dark','Targets to import');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');await expect(approval).not.toBeChecked();
 // Finish language/theme refreshes before checking a deliberately stale, fixed page snapshot.
 await page.reload();await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('CSV annuel importé 2');await fiscal.selectOption(year);await upload.setInputFiles(file);await expect(page.getByRole('status')).toContainText('2 objectifs prêts');const reviewed=await page.locator('input[name="review"]').inputValue();
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null,accountId:string|null=null,accountName:string|null=null;
 try{
  const account=(await db.query("SELECT id,name_en FROM account WHERE company_id=$1 AND code='4000'",[companyId])).rows[0];accountId=account.id;accountName=account.name_en;await db.query("UPDATE account SET name_en='Renamed after preview' WHERE id=$1",[accountId]);
  await expect(page.locator('input[name="review"]')).toHaveValue(reviewed);await approval.check();await page.getByRole('button',{name:'Créer le budget depuis le CSV',exact:true}).click();await expect(page.locator('form').getByRole('alert')).toContainText('Des comptes ont changé');await expect(page.getByLabel('Nom du nouveau scénario',{exact:true})).toHaveValue('CSV annuel importé 2');await db.query('UPDATE account SET name_en=$2 WHERE id=$1',[accountId,accountName]);
  await page.getByRole('link',{name:'Recharger l’aperçu',exact:true}).click();await expect(upload).toHaveValue('');await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('CSV annuel importé');await fiscal.selectOption(year);await upload.setInputFiles(file);await expect(page.getByRole('status')).toContainText('2 objectifs prêts');await approval.check();await page.getByRole('button',{name:'Créer le budget depuis le CSV',exact:true}).click();await expect(page).toHaveURL(/\/budgets\/[0-9a-f-]{36}$/);await expect(page.getByRole('heading',{name:'CSV annuel importé',exact:true})).toBeVisible();const budgetId=new URL(page.url()).pathname.split('/').at(-1)!;
  const event=(await db.query("SELECT after FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='budget.import_csv'",[companyId,budgetId])).rows[0].after;expect(event).toMatchObject({format:'fr-CA',targetCount:2});expect(JSON.stringify(event)).not.toContain('PRIVATE-BUDGET');const targets=(await db.query('SELECT amount_cents::text FROM budget_line WHERE budget_id=$1 ORDER BY amount_cents',[budgetId])).rows.map(r=>r.amount_cents);expect(targets).toEqual(['0','8500075']);
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'csv-'||gen_random_uuid()::text||'@exemple.test','CSV fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(company+'/budgets');await expect(page.getByRole('link',{name:'Importer un CSV',exact:true})).toHaveCount(0);expect((await page.request.get(url)).status()).toBe(404);expect((await page.request.get(url+'/modele?format=en')).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/budgets/importer')).status()).toBe(404);
 }finally{if(accountId&&accountName)await db.query('UPDATE account SET name_en=$2 WHERE id=$1',[accountId,accountName]);if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,access===null?'{}':JSON.stringify(access)]);if(backupId){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backupId]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backupId]);}await db.end();}expect(cspViolations).toEqual([]);
});

test("monthly budgets allocate exact fiscal periods, preserve annual limits and refuse stale editors",async({page,browser})=>{
 test.setTimeout(150_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){
  await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel("Premier mois de l'exercice financier").selectOption('4');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption('fr-CA');await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];await page.goto(company+'/budgets');await page.getByLabel('Nom du scénario',{exact:true}).fill('Plan mensuel');await page.getByRole('button',{name:'Créer un budget',exact:true}).click();await expect(page).toHaveURL(/\/budgets\/[0-9a-f-]{36}$/);const annual=page.url();
 await page.locator('details summary').click();const picker=page.getByLabel('Compte',{exact:true}),accountId=(await picker.locator('option').filter({hasText:/^4/}).first().getAttribute('value'))!;await picker.selectOption(accountId);await page.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('10000,01');await page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(page.getByRole('status')).toContainText('Objectif enregistré.');
 await page.getByRole('link',{name:'Budget mensuel',exact:true}).click();await expect(page).toHaveURL(/\/mensuel$/);const monthly=page.url();const period=page.getByLabel('Période de l’exercice',{exact:true});await period.selectOption({index:0});const firstPeriod=await period.inputValue();await page.getByRole('button',{name:'Afficher la période',exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('periode')).toBe(firstPeriod);const reportUrl=page.url();
 await page.getByRole('link',{name:'Répartir les mois',exact:true}).click();await expect(page).toHaveURL(/\/mensuel\/[0-9a-f-]{36}/);const editor=page.url();let proposalPosts=0;const countProposals=(r:{method:()=>string;url:()=>string})=>{if(r.method()==='POST'&&new URL(r.url()).pathname===new URL(editor).pathname)proposalPosts++;};page.on('request',countProposals);
 const fields=page.locator('input[name^="period_"]');await expect(fields).toHaveCount(12);await page.getByRole('button',{name:'Répartir également les 12 périodes',exact:true}).click();await expect(fields.first()).toHaveValue('833,34');await expect(fields.nth(11)).toHaveValue('833,33');expect(proposalPosts).toBe(0);page.off('request',countProposals);await expectNoPageOverflow(page);await captureReference(page,'repartition-mensuelle','Répartir les mois');
 await fields.nth(1).fill('10000,01');await page.getByRole('button',{name:'Enregistrer la répartition',exact:true}).click();await expect(page.locator('form').getByRole('alert').filter({hasText:'La répartition mensuelle dépasse'})).toBeVisible();await expect(fields.nth(1)).toHaveValue('10000,01');
 await page.getByRole('button',{name:'Répartir également les 12 périodes',exact:true}).click();await page.getByRole('button',{name:'Enregistrer la répartition',exact:true}).click();await expect(page).toHaveURL(reportUrl);await expect(page.getByRole('region',{name:'Budget et réel de la période',exact:true})).toContainText('Répartition complète');
 // Wait for the editor transition before creating the concurrent snapshot; click alone may leave the report URL current.
 await page.getByRole('link',{name:'Répartir les mois',exact:true}).click();await expect(page).toHaveURL(editor);await expect(fields).toHaveCount(12);const stale=await browser.newPage();await stale.context().addCookies(await page.context().cookies());await stale.goto(editor);await expect(stale.locator('input[name^="period_"]')).toHaveCount(12);await stale.getByRole('button',{name:'Effacer la répartition proposée',exact:true}).click();await stale.locator('input[name^="period_"]').first().fill('6000,00');
 await page.getByRole('button',{name:'Effacer la répartition proposée',exact:true}).click();await fields.first().fill('5000,00');await page.getByRole('button',{name:'Enregistrer la répartition',exact:true}).click();await expect(page).toHaveURL(reportUrl);await stale.getByRole('button',{name:'Enregistrer la répartition',exact:true}).click();await expect(stale.locator('form').getByRole('alert')).toContainText('Ce budget a été modifié');await expect(stale.locator('input[name^="period_"]').first()).toHaveValue('6000,00');await stale.close();
 const region=page.getByRole('region',{name:'Budget et réel de la période',exact:true});await expect(region).toContainText('1 / 12');await expect(region).toContainText('5');await expectNoPageOverflow(page);await captureReference(page,'budget-mensuel',region);const csv=await page.request.get(monthly+'/export?periode='+firstPeriod);expect(csv.status()).toBe(200);expect(csv.headers()['cache-control']).toBe('private, no-store');expect(await csv.text()).toContain('5000,00');expect(await csv.text()).toContain('5000,01');
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Monthly budget',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'budget-mensuel-en-dark',page.getByRole('region',{name:'Period budget vs actual',exact:true}));expect(await(await page.request.get(monthly+'/export?periode='+firstPeriod)).text()).toContain('5000.00');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
 await page.goto(annual);await page.locator('details summary').click();await picker.selectOption(accountId);await page.getByLabel('Objectif annuel (CAD)',{exact:true}).fill('4999,00');await page.getByRole('button',{name:'Ajouter ou remplacer un objectif',exact:true}).click();await expect(page.locator('form').getByRole('alert').filter({hasText:'L’objectif annuel ne peut pas'})).toBeVisible();await page.getByRole('button',{name:/Retirer l’objectif du compte/}).click();await expect(page.locator('form').getByRole('alert').filter({hasText:'Retirez d’abord les objectifs mensuels'})).toBeVisible();
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId:string|null=null,backupId:string|null=null,role:string|null=null,access:unknown=null;
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'monthly-'||gen_random_uuid()::text||'@exemple.test','Monthly fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(reportUrl);await expect(region).toContainText('1 / 12');await expect(page.getByRole('link',{name:'Répartir les mois',exact:true})).toHaveCount(0);expect((await page.request.get(editor)).status()).toBe(404);expect((await page.request.get(monthly+'/export?periode='+firstPeriod)).status()).toBe(200);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(reportUrl)).status()).toBe(404);expect((await page.request.get(monthly+'/export?periode='+firstPeriod)).status()).toBe(404);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,access===null?'{}':JSON.stringify(access)]);if(backupId){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backupId]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backupId]);}await db.end();}expect(cspViolations).toEqual([]);
});

/** Different users must not share cookie-derived catalogues through a server cache. */
test("concurrent French and English requests keep server metadata, client forms and PWA language isolated", async ({ browser }) => {
  const languages = ["fr-CA", "en"] as const;
  const origin = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
  const contexts = await Promise.all(languages.map(locale => browser.newContext({
    ...devices[process.env.E2E_MOBILE === "1" ? "Pixel 7" : "Desktop Chrome"],
    baseURL: origin,
    // The explicit app cookie must also win over a different browser language.
    locale: locale === "en" ? "fr-CA" : "en",
  })));
  try {
    const pages = await Promise.all(contexts.map(async (context, i) => {
      await context.addCookies([{ name: "allumi_locale", value: languages[i]!, url: origin }]);
      return context.newPage();
    }));
    for (let round = 0; round < 3; round++) {
      await Promise.all(pages.map(page => page.goto("/connexion")));
      await Promise.all(pages.map(async (page, i) => {
        const locale = languages[i]!, messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
        const setup = new URL(page.url()).pathname === "/setup";
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByRole("heading", { name: setup ? messages.setup.title : messages.login.title, exact: true })).toBeVisible();
        await expect(page.getByLabel(messages.form.password, { exact: true })).toBeVisible();
        await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", messages.app.tagline);
        const response = await contexts[i]!.request.get("/manifest.webmanifest");
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ lang: locale, description: messages.app.tagline });
        await expectNoPageOverflow(page);
      }));
    }
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

/** Online/Desktop CSV lists and a separately reviewed, reconciled cutover entry. Fictional data only. */
test("QuickBooks migration reviews templates and mapped lists, rejects stale approval and reconciles cutover balances", async ({ page, browser }) => {
 test.setTimeout(240_000); cspViolations.length = 0; watchCsp(page.context());
 if (updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if (!updateCookies) {
  await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel("Langue de l'interface").selectOption('fr-CA');await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 const db = new pg.Client({ connectionString: e2eUrls().owner }); await db.connect();
 let companyId = '', ownerId = '';
 try {
  ownerId = (await db.query('SELECT id FROM app_user WHERE email=$1',[EMAIL])).rows[0].id;
  companyId = (await db.query("INSERT INTO company(id,name,updated_at) VALUES(gen_random_uuid(),'Migration Exemple inc.',now()) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,ownerId]);
  const company = '/c/' + companyId; await page.goto(company);
  await page.getByRole('button',{name:'Initialiser',exact:true}).click();
  await expect(page.getByRole('button',{name:'Initialiser',exact:true})).toHaveCount(0);
  const cutoff = (await db.query("SELECT to_char(end_date,'YYYY-MM-DD') AS date FROM fiscal_period WHERE company_id=$1 ORDER BY period_number LIMIT 1",[companyId])).rows[0].date;
  await page.goto(company+'/parametres');await page.getByRole('link',{name:'Migrer depuis QuickBooks',exact:true}).click();await expect(page.getByRole('heading',{name:'Migrer depuis QuickBooks',exact:true})).toBeVisible();
  const templateUrl = (kind: string, locale: string, delimiter: string) => company + '/migration/modele?' + new URLSearchParams({ kind, locale, delimiter });
  const auditBefore = (await db.query('SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1',[companyId])).rows[0].n;
  for (const kind of ['CUSTOMERS','SUPPLIERS','ITEMS','ACCOUNTS','BALANCES']) for (const locale of ['fr-CA','en']) for (const delimiter of [',',';','\t']) {
    const response = await page.request.get(templateUrl(kind,locale,delimiter)); expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');expect(response.headers()['vary']).toContain('Cookie');expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-disposition']).toBe(`attachment; filename="quickbooks_${kind.toLowerCase()}_${locale}.${delimiter==='\t'?'tsv':'csv'}"`);
    const bytes=await response.body();expect([...bytes.subarray(0,3)]).toEqual([239,187,191]);const text=bytes.toString('utf8').replace(/^\uFEFF/,'').trim();expect(text.split(/\r?\n/)).toHaveLength(1);expect(text).toContain(locale==='en'?'"Name"':'"Nom"');expect(text).not.toContain('Migration Exemple');
  }
  const url=templateUrl('CUSTOMERS','en',',');
  for (const bad of [url+'&kind=ITEMS',url+'&extra=1',url.replace('CUSTOMERS','HISTORY'),url.replace('locale=en','locale=fr'),url.replace('delimiter=%2C','delimiter=%7C'),company+'/migration/modele']) {
    const response=await page.request.get(bad);expect(response.status()).toBe(400);expect(response.headers()['cache-control']).toBe('private, no-store');
  }
  expect((await page.request.get(url.replace(company,'/c/00000000-0000-0000-0000-000000000000'))).status()).toBe(404);
  const anonymous=await browser.newContext();try {const response=await anonymous.request.get(new URL(url,page.url()).href,{maxRedirects:0});expect(response.status()).toBe(307);expect(response.headers()['location']).toContain('/connexion');}finally{await anonymous.close();}
  await page.getByRole('combobox',{name:'Données à reprendre',exact:true}).selectOption('BALANCES');await page.getByRole('combobox',{name:'Séparateur du fichier',exact:true}).selectOption('\t');
  await expect(page.getByRole('link',{name:'Télécharger le modèle vierge',exact:true})).toHaveAttribute('href',templateUrl('BALANCES','fr-CA','\t'));
  const [tabTemplate]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Télécharger le modèle vierge',exact:true}).click()]);expect(tabTemplate.suggestedFilename()).toBe('quickbooks_balances_fr-CA.tsv');await tabTemplate.delete();
  await page.getByRole('combobox',{name:'Données à reprendre',exact:true}).selectOption('CUSTOMERS');await page.getByRole('combobox',{name:'Séparateur du fichier',exact:true}).selectOption(',');
  expect((await db.query('SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1',[companyId])).rows[0].n).toBe(auditBefore);
  await expectNoPageOverflow(page);await captureReference(page,'modele-migration','Préparer un fichier');
  const upload = async (kind:string,source:string,text:string) => {
   await page.getByRole('combobox',{name:'Données à reprendre',exact:true}).selectOption(kind);await page.getByRole('combobox',{name:'Édition source',exact:true}).selectOption(source);
   await page.getByLabel('Export CSV',{exact:true}).setInputFiles({name:'quickbooks-example.csv',mimeType:'text/csv',buffer:Buffer.from(text)});
   await page.getByRole('button',{name:'Proposer les associations',exact:true}).click();
   if(kind==='ACCOUNTS') { await page.getByRole('combobox',{name:'Nom',exact:true}).selectOption('0'); await page.getByRole('combobox',{name:'Code Allumi / UGS',exact:true}).selectOption('1'); }
   await expect(page.getByRole('button',{name:'Vérifier avec Allumi',exact:true})).toBeEnabled();
  };
  const check = async () => { await page.getByRole('button',{name:'Vérifier avec Allumi',exact:true}).click();await expect(page.getByRole('heading',{name:'3. Vérifier le lot et confirmer',exact:true})).toBeVisible(); };
  const confirm = async (balances=false) => { const previousLot=new URL(page.url()).searchParams.get('lot'); await page.getByRole('checkbox').last().check();await page.getByRole('button',{name:balances?'Valider les soldes de bascule':'Importer les listes',exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('lot')).not.toBe(previousLot);await expect(page.getByRole('status').filter({hasText:'Import confirmé'})).toBeVisible(); };
  const contacts='Customer,Company,Email,Phone,Bill State,Balance\nClient QB Exemple,Exemple inc.,qb-client@example.test,555-0100,QC,125.00';
  let posts=0;const countPosts=(r:{method:()=>string;url:()=>string})=>{if(r.method()==='POST'&&new URL(r.url()).pathname===company+'/migration')posts++;};page.on('request',countPosts);
  await upload('CUSTOMERS','ONLINE',contacts);expect(posts).toBe(0);page.off('request',countPosts);await check();
  await expect(page.getByRole('button',{name:'Importer les listes',exact:true})).toBeDisabled();await expect(page.locator('form').filter({has:page.locator('input[type="file"]')})).toContainText('Balance');
  expect((await db.query("SELECT id FROM contact WHERE company_id=$1 AND display_name='Client QB Exemple'",[companyId])).rowCount).toBe(0);
  await page.getByRole('checkbox').last().check();const reviewedToken=await page.locator('input[name="token"]').inputValue(), selectedFile=await page.getByLabel('Export CSV',{exact:true}).inputValue(), beforeDownloadUrl=page.url();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Télécharger le modèle vierge',exact:true}).click()]);expect(download.suggestedFilename()).toBe('quickbooks_customers_fr-CA.csv');await download.delete();
  await expect(page).toHaveURL(beforeDownloadUrl);await expect(page.getByRole('checkbox').last()).toBeChecked();await expect(page.locator('input[name="token"]')).toHaveValue(reviewedToken);await expect(page.getByLabel('Export CSV',{exact:true})).toHaveValue(selectedFile);
  await db.query("INSERT INTO contact(id,company_id,is_customer,display_name,updated_at) VALUES(gen_random_uuid(),$1,true,'Contact concurrent',now())",[companyId]);
  await page.getByRole('checkbox').last().check();await page.getByRole('button',{name:'Importer les listes',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'L’aperçu a expiré ou les données ont changé.'})).toBeVisible();
  await expect(page.getByLabel('Export CSV',{exact:true})).not.toHaveValue('');await check();await expect(page.getByRole('checkbox').last()).not.toBeChecked();await expectNoPageOverflow(page);await captureReference(page,'migration-quickbooks','3. Vérifier le lot et confirmer');
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('link',{name:'Download a blank template',exact:true})).toHaveAttribute('href',templateUrl('CUSTOMERS','en',','));await captureReference(page,'modele-migration-en-dark','Prepare a file');
  await page.getByRole('button',{name:'Check with Allumi',exact:true}).click();await expect(page.getByRole('heading',{name:'3. Review and confirm',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'migration-quickbooks-en-dark','3. Review and confirm');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');await check();await confirm();
  expect((await db.query("SELECT email FROM contact WHERE company_id=$1 AND display_name='Client QB Exemple'",[companyId])).rows[0].email).toBe('qb-client@example.test');
  await page.getByRole('combobox',{name:'Séparateur du fichier',exact:true}).selectOption('\t');await upload('SUPPLIERS','DESKTOP','Vendor\tEmail\nFournisseur QB Exemple\tqb-supplier@example.test');await check();await confirm();await page.getByRole('combobox',{name:'Séparateur du fichier',exact:true}).selectOption(',');
  await upload('ACCOUNTS','DESKTOP','Account,Account #,Account type\nBanque QB Exemple,QB-1000,Bank');await check();await confirm();
  await upload('ITEMS','DESKTOP','Product/Service,SKU,Type,Sales price/rate,Income account\nService QB Exemple,QB-SERVICE,Service,12.345678,4000');await check();await confirm();
  expect((await db.query("SELECT unit_price::text FROM item WHERE company_id=$1 AND code='QB-SERVICE'",[companyId])).rows[0].unit_price).toBe('12.345678');
  await upload('BALANCES','ONLINE','Code,Debit,Credit\n1100,10.00,0\n3000,0,10.00');await page.getByLabel('Date de bascule',{exact:true}).fill(cutoff);await check();await expect(page.getByRole('button',{name:'Valider les soldes de bascule',exact:true})).toBeDisabled();await expect(page.locator('form').filter({has:page.locator('input[type="file"]')})).toContainText('Écart sur un compte clients, fournisseurs ou de taxes');
  expect((await db.query('SELECT id FROM journal_entry WHERE company_id=$1',[companyId])).rowCount).toBe(0);
  await upload('BALANCES','ONLINE','Code,Debit,Credit\n1000,1234.56,0\n3000,0,1234.56');await check();await expectNoPageOverflow(page);await captureReference(page,'soldes-bascule-quickbooks','3. Vérifier le lot et confirmer');await confirm(true);
  const entry=(await db.query("SELECT id FROM journal_entry WHERE company_id=$1 AND source_type='OPENING_BALANCE'",[companyId])).rows;expect(entry).toHaveLength(1);
  expect((await db.query('SELECT sum(debit_cents)::text AS debit,sum(credit_cents)::text AS credit FROM journal_line WHERE company_id=$1 AND entry_id=$2',[companyId,entry[0].id])).rows[0]).toEqual({debit:'123456',credit:'123456'});
  await upload('BALANCES','ONLINE','Code,Debit,Credit\n1000,2000.00,0\n3000,0,2000.00');await page.getByLabel('Date de bascule',{exact:true}).fill(cutoff);await page.getByRole('button',{name:'Vérifier avec Allumi',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Ce lot ou cette bascule a déjà été confirmé.'})).toBeVisible();
  await upload('CUSTOMERS','ONLINE','Name,Email\nInterdit QB,denied@example.test');await check();
  const backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'qb-backup-owner@example.test','Backup',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await db.query("UPDATE membership SET role='ACCOUNTANT' WHERE company_id=$1 AND user_id=$2",[companyId,ownerId]);
  try {
   await page.getByRole('checkbox').last().check();await page.getByRole('button',{name:'Importer les listes',exact:true}).click();await expect(page.locator('form').filter({has:page.locator('input[type="file"]')}).getByRole('alert')).toBeVisible();expect((await page.context().request.get(company+'/migration')).status()).toBe(404);expect((await page.request.get(templateUrl('CUSTOMERS','en',','))).status()).toBe(404);
   expect((await db.query("SELECT id FROM contact WHERE company_id=$1 AND display_name='Interdit QB'",[companyId])).rowCount).toBe(0);
  } finally {await db.query("UPDATE membership SET role='OWNER' WHERE company_id=$1 AND user_id=$2",[companyId,ownerId]);}
  expect(cspViolations).toEqual([]);
 } finally {await db.end();}
});

test("monthly budget duplication reviews fiscal mappings, preserves gaps and zeros, and rejects stale confirmations", async ({ page }) => {
 test.setTimeout(150_000); cspViolations.length=0; watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0], companyId=company.split('/')[2];
 const db=new pg.Client({connectionString:e2eUrls().owner}); await db.connect();
 let sourceId='', destinationId='', userId='', backupId='', originalRole='', originalAccess:unknown=null;
 try {
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0]; userId=member.user_id; originalRole=member.role; originalAccess=member.module_access;
  const sourceYear=(await db.query('SELECT id FROM fiscal_year WHERE company_id=$1 ORDER BY start_date LIMIT 1',[companyId])).rows[0].id;
  // Fictional fixtures only: intentionally different calendar months make ordinal mapping visible.
  destinationId=(await db.query("INSERT INTO fiscal_year(id,company_id,start_date,end_date) SELECT gen_random_uuid(),$1,d,d+interval '1 year'-interval '1 day' FROM (SELECT date_trunc('year',max(end_date)+interval '1 year')::date AS d FROM fiscal_year WHERE company_id=$1) x RETURNING id",[companyId])).rows[0].id;
  await db.query("INSERT INTO fiscal_period(id,company_id,fiscal_year_id,period_number,start_date,end_date) SELECT gen_random_uuid(),$1,f.id,n,(f.start_date+make_interval(months=>n-1))::date,(f.start_date+make_interval(months=>n)-interval '1 day')::date FROM fiscal_year f CROSS JOIN generate_series(1,12) n WHERE f.company_id=$1 AND f.id=$2",[companyId,destinationId]);
  const accounts=(await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES(gen_random_uuid(),$1,'MC81-REV','Ventes du scénario','Scenario sales','REVENUE','OPERATING_REVENUE',now()),(gen_random_uuid(),$1,'MC81-ZERO','Objectif zéro','Zero target','EXPENSE','OTHER_EXPENSE',now()),(gen_random_uuid(),$1,'MC81-INACTIVE','Ancien objectif','Old target','EXPENSE','OTHER_EXPENSE',now()) RETURNING id,code",[companyId])).rows;
  const sales=accounts.find(r=>r.code==='MC81-REV')!.id, zero=accounts.find(r=>r.code==='MC81-ZERO')!.id, inactive=accounts.find(r=>r.code==='MC81-INACTIVE')!.id;
  await db.query('BEGIN');
  try {
   await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);
   sourceId=(await db.query("INSERT INTO budget(id,company_id,fiscal_year_id,name,updated_at) VALUES(gen_random_uuid(),$1,$2,'Plan de référence mensuel',now()) RETURNING id",[companyId,sourceYear])).rows[0].id;
   await db.query('INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,30000,now()),(gen_random_uuid(),$1,$2,$4,0,now()),(gen_random_uuid(),$1,$2,$5,5000,now())',[companyId,sourceId,sales,zero,inactive]);
   await db.query('INSERT INTO budget_monthly_target(id,company_id,budget_line_id,fiscal_period_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,l.id,p.id,x.amount,now() FROM (VALUES($3::uuid,1,10001::bigint),($3::uuid,2,0::bigint),($3::uuid,12,19999::bigint),($4::uuid,3,0::bigint),($5::uuid,1,5000::bigint)) x(account_id,num,amount) JOIN budget_line l ON l.company_id=$1 AND l.budget_id=$2 AND l.account_id=x.account_id JOIN fiscal_period p ON p.company_id=$1 AND p.fiscal_year_id=$6 AND p.period_number=x.num',[companyId,sourceId,sales,zero,inactive,sourceYear]);
   await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  await db.query('UPDATE account SET is_active=false WHERE company_id=$1 AND id=$2',[companyId,inactive]);
  const before=(await db.query('SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1',[companyId])).rows[0].n;
  await page.goto(company+'/budgets/'+sourceId+'/mensuel'); await page.getByRole('link',{name:'Dupliquer avec les répartitions mensuelles',exact:true}).click();
  await expect(page).toHaveURL(/\/dupliquer\/mensuel$/); const selection=page.url(); await expect(page.getByRole('button',{name:'Créer le scénario avec les répartitions',exact:true})).toHaveCount(0);
  const chooseYear=async()=>{await page.getByLabel('Exercice du nouveau scénario',{exact:true}).selectOption(destinationId);await page.getByRole('button',{name:'Vérifier la correspondance des périodes',exact:true}).click();await expect(page.getByRole('region',{name:'Correspondance des périodes fiscales',exact:true}).getByRole('listitem')).toHaveCount(12);};
  await chooseYear(); await expect(page.getByLabel('Exercice du nouveau scénario',{exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Choisir un autre exercice',exact:true}).click(); await expect(page).toHaveURL(selection); await chooseYear();
  await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Scénario mensuel repris'); await expectNoPageOverflow(page); await captureReference(page,'duplication-budget-mensuel','Correspondance des périodes fiscales');
  await page.getByRole('button',{name:'English',exact:true}).click(); await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark'); await expect(page.getByRole('heading',{name:'Copy annual and monthly budget targets',exact:true})).toBeVisible(); await expectNoPageOverflow(page); await captureReference(page,'duplication-budget-mensuel-en-dark','Fiscal period mapping');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light'); await expect(page.locator('html')).toHaveAttribute('data-theme','light'); await page.getByRole('button',{name:'Français',exact:true}).click(); await expect(page.locator('html')).toHaveAttribute('lang','fr-CA'); await expect(page.getByRole('heading',{name:'Dupliquer les objectifs annuels et mensuels',exact:true})).toBeVisible();
  // Change an actually displayed amount after the preview. SQL guards bump the source revision.
  await db.query('BEGIN'); await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]); await db.query('UPDATE budget_monthly_target SET amount_cents=9999 WHERE company_id=$1 AND budget_line_id=(SELECT id FROM budget_line WHERE company_id=$1 AND budget_id=$2 AND account_id=$3) AND fiscal_period_id=(SELECT id FROM fiscal_period WHERE company_id=$1 AND fiscal_year_id=$4 AND period_number=1)',[companyId,sourceId,sales,sourceYear]); await db.query('COMMIT');
  await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Scénario mensuel repris'); await page.locator('input[name="skipInactive"]').check(); await page.locator('input[name="confirmed"]').check(); await page.getByRole('button',{name:'Créer le scénario avec les répartitions',exact:true}).click(); await expect(page.locator('form').getByRole('alert')).toContainText('Le budget source ou ses comptes ont changé'); await expect(page.getByLabel('Nom du nouveau scénario',{exact:true})).toHaveValue('Scénario mensuel repris');
  await page.getByRole('link',{name:'Recharger l’aperçu',exact:true}).click(); await expect(page.locator('input[name="confirmed"]')).not.toBeChecked(); await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Scénario mensuel repris'); await page.locator('input[name="skipInactive"]').check(); await page.locator('input[name="confirmed"]').check(); await page.getByRole('button',{name:'Créer le scénario avec les répartitions',exact:true}).click(); await expect(page).toHaveURL(/\/budgets\/[0-9a-f-]{36}\/mensuel\?periode=/);
  const copiedId=new URL(page.url()).pathname.split('/')[4]; expect(copiedId).not.toBe(sourceId);
  const rows=(await db.query('SELECT l.account_id,p.period_number,t.amount_cents::text AS cents FROM budget_monthly_target t JOIN budget_line l ON l.company_id=t.company_id AND l.id=t.budget_line_id JOIN fiscal_period p ON p.company_id=t.company_id AND p.id=t.fiscal_period_id WHERE l.company_id=$1 AND l.budget_id=$2 ORDER BY p.period_number',[companyId,copiedId])).rows;
  expect(rows).toEqual([{account_id:sales,period_number:1,cents:'9999'},{account_id:sales,period_number:2,cents:'0'},{account_id:zero,period_number:3,cents:'0'},{account_id:sales,period_number:12,cents:'19999'}]);
  expect((await db.query('SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1',[companyId])).rows[0].n).toBe(before);
  // A form that was authorized on render must still fail after write access is removed.
  await page.goto(selection+'?exercice='+destinationId); await page.getByLabel('Nom du nouveau scénario',{exact:true}).fill('Copie refusée'); await page.locator('input[name="skipInactive"]').check(); await page.locator('input[name="confirmed"]').check();
  backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'mc81-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id; await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]); await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);
  await page.getByRole('button',{name:'Créer le scénario avec les répartitions',exact:true}).click(); await expect(page.locator('form').getByRole('alert')).toBeVisible(); expect((await page.request.get(selection+'?exercice='+destinationId)).status()).toBe(404); await page.goto(company+'/budgets/'+sourceId+'/mensuel'); await expect(page.getByRole('link',{name:'Dupliquer avec les répartitions mensuelles',exact:true})).toHaveCount(0);
  expect((await db.query("SELECT id FROM budget WHERE company_id=$1 AND name='Copie refusée'",[companyId])).rowCount).toBe(0); expect(cspViolations).toEqual([]);
 } finally {
  await db.query('ROLLBACK'); if(userId&&originalRole) await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,originalRole,JSON.stringify(originalAccess??{})]); if(backupId) { await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backupId]); await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backupId]); } await db.end();
 }
});

test("monthly budget CSV import reviews replacements, preserves other targets and refuses stale or revoked approvals", async ({ page }) => {
 test.setTimeout(150_000); cspViolations.length=0; watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 const db=new pg.Client({connectionString:e2eUrls().owner}); await db.connect();
 let userId='',originalRole='',originalAccess:unknown=null,backupId='';
 try {
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;originalRole=member.role;originalAccess=member.module_access;
  const yearId=(await db.query('SELECT id FROM fiscal_year WHERE company_id=$1 ORDER BY start_date LIMIT 1',[companyId])).rows[0].id;
  const accounts=(await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES(gen_random_uuid(),$1,'MC84-REV','Ventes du plan','Plan sales','REVENUE','OPERATING_REVENUE',now()),(gen_random_uuid(),$1,'MC84-KEEP','Compte conservé','Preserved account','EXPENSE','OTHER_EXPENSE',now()),(gen_random_uuid(),$1,'MC84-ZERO','Objectif zéro','Zero target','EXPENSE','OTHER_EXPENSE',now()) RETURNING id,code",[companyId])).rows;
  const sales=accounts.find(a=>a.code==='MC84-REV')!.id,keep=accounts.find(a=>a.code==='MC84-KEEP')!.id,zero=accounts.find(a=>a.code==='MC84-ZERO')!.id;
  await db.query('BEGIN');let budgetId='';
  try {
   await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);
   budgetId=(await db.query("INSERT INTO budget(id,company_id,fiscal_year_id,name,updated_at) VALUES(gen_random_uuid(),$1,$2,'Plan import mensuel',now()) RETURNING id",[companyId,yearId])).rows[0].id;
   await db.query('INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,30000,now()),(gen_random_uuid(),$1,$2,$4,12000,now()),(gen_random_uuid(),$1,$2,$5,0,now())',[companyId,budgetId,sales,keep,zero]);
   await db.query('INSERT INTO budget_monthly_target(id,company_id,budget_line_id,fiscal_period_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,l.id,p.id,x.amount,now() FROM (VALUES($3::uuid,1,10001::bigint),($3::uuid,2,0::bigint),($3::uuid,12,19999::bigint),($4::uuid,1,5000::bigint),($5::uuid,3,0::bigint)) x(account_id,num,amount) JOIN budget_line l ON l.company_id=$1 AND l.budget_id=$2 AND l.account_id=x.account_id JOIN fiscal_period p ON p.company_id=$1 AND p.fiscal_year_id=$6 AND p.period_number=x.num',[companyId,budgetId,sales,keep,zero,yearId]);await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
  const journalCount=(await db.query('SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1',[companyId])).rows[0].n;
  const report=company+'/budgets/'+budgetId+'/mensuel';await page.goto(report);await page.getByRole('link',{name:'Importer les répartitions mensuelles',exact:true}).click();await expect(page).toHaveURL(/\/mensuel\/importer$/);const importer=page.url();
  await page.getByText('Vérifier les dates des douze colonnes fiscales',{exact:true}).click();await expect(page.locator('details').first().getByRole('listitem')).toHaveCount(12);await page.getByText('Vérifier les dates des douze colonnes fiscales',{exact:true}).click();
  const header=['account_code',...Array.from({length:12},(_,i)=>'period_'+(i+1))].join(';');
  const makeFile=(first='123,45')=>header+'\n'+['MC84-REV',first,'0,00',...Array<string>(10).fill('')].join(';')+'\n'+['MC84-ZERO','0,00',...Array<string>(11).fill('')].join(';');
  const file=page.getByLabel('Fichier CSV UTF-8',{exact:true});
  const upload=async(text:string)=>{await file.setInputFiles({name:'monthly.csv',mimeType:'text/csv',buffer:Buffer.from(text)});};
  let posts=0;const countPosts=(r:{method:()=>string;url:()=>string})=>{if(r.method()==='POST'&&new URL(r.url()).pathname===new URL(importer).pathname)posts++;};page.on('request',countPosts);
  await upload(makeFile('300,01'));await expect(page.getByRole('alert').filter({hasText:'la somme mensuelle dépasse'})).toBeVisible();await expect(page.getByRole('button',{name:'Remplacer les répartitions vérifiées',exact:true})).toHaveCount(0);
  await upload(makeFile());await expect(page.getByRole('heading',{name:'Vérifier les répartitions actuelles et proposées',exact:true})).toBeVisible();expect(posts).toBe(0);
  const confirm=page.locator('input[name="confirmed"]');await confirm.check();await upload(makeFile('123,44'));await expect(confirm).not.toBeChecked();await upload(makeFile());await confirm.check();
  const beforeFile=await file.inputValue(),beforeReview=await page.locator('input[name="review"]').inputValue();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Télécharger le modèle vide',exact:true}).click()]);expect(download.suggestedFilename()).toBe('monthly_budget_template_fr-CA.csv');const downloadPath=await download.path();expect(downloadPath).not.toBeNull();expect(readFileSync(downloadPath!).toString('utf8')).toBe('\uFEFF'+header+'\r\n');await download.delete();await expect(page).toHaveURL(importer);await expect(confirm).toBeChecked();await expect(file).toHaveValue(beforeFile);await expect(page.locator('input[name="review"]')).toHaveValue(beforeReview);
  const model=importer+'/modele';for(const query of ['','?format=bad','?format=en&format=fr-CA','?format=en&extra=yes'])expect((await page.request.get(model+query)).status()).toBe(400);const template=await page.request.get(model+'?format=en');expect(template.status()).toBe(200);expect(template.headers()['cache-control']).toBe('private, no-store');expect((await template.body()).subarray(0,3)).toEqual(Buffer.from([239,187,191]));expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/budgets/'+budgetId+'/mensuel/importer/modele?format=en')).status()).toBe(404);expect(posts).toBe(0);page.off('request',countPosts);
  await page.locator('select[name="format"]').selectOption('en');await expect(confirm).toHaveCount(0);await page.locator('select[name="format"]').selectOption('fr-CA');await expect(confirm).not.toBeChecked();
  const preview=page.getByRole('region',{name:'Vérifier les répartitions actuelles et proposées',exact:true});await preview.locator('details').first().locator('summary').click();await expect(preview).toContainText('Actuel');await expect(preview).toContainText('Proposé');await expectNoPageOverflow(page);await captureReference(page,'import-budget-mensuel','Vérifier les répartitions actuelles et proposées');
  await confirm.check();await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(confirm).not.toBeChecked();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.getByRole('heading',{name:'Import monthly budget allocations',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'import-budget-mensuel-en-dark','Review current and proposed allocations');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');await expect(page.getByRole('heading',{name:'Importer les répartitions mensuelles',exact:true})).toBeVisible();await expect(confirm).not.toBeChecked();
  await db.query('BEGIN');await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);await db.query('UPDATE budget_monthly_target SET amount_cents=9999 WHERE company_id=$1 AND budget_line_id=(SELECT id FROM budget_line WHERE company_id=$1 AND budget_id=$2 AND account_id=$3) AND fiscal_period_id=(SELECT id FROM fiscal_period WHERE company_id=$1 AND fiscal_year_id=$4 AND period_number=1)',[companyId,budgetId,sales,yearId]);await db.query('COMMIT');
  await confirm.check();await page.getByRole('button',{name:'Remplacer les répartitions vérifiées',exact:true}).click();await expect(page.locator('form').getByRole('alert')).toContainText('Le budget, ses comptes ou ses périodes ont changé');await expect(file).toHaveValue(beforeFile);
  await page.getByRole('link',{name:'Recharger l’aperçu',exact:true}).click();await expect(file).toHaveValue('');await upload(makeFile());await expect(confirm).not.toBeChecked();await confirm.check();await page.getByRole('button',{name:'Remplacer les répartitions vérifiées',exact:true}).click();await expect(page).toHaveURL(new RegExp('/budgets/'+budgetId+'/mensuel\\?periode='));
  const rows=(await db.query('SELECT a.code,p.period_number,t.amount_cents::text AS cents FROM budget_monthly_target t JOIN budget_line l ON l.company_id=t.company_id AND l.id=t.budget_line_id JOIN account a ON a.company_id=l.company_id AND a.id=l.account_id JOIN fiscal_period p ON p.company_id=t.company_id AND p.id=t.fiscal_period_id WHERE l.company_id=$1 AND l.budget_id=$2 ORDER BY a.code,p.period_number',[companyId,budgetId])).rows;
  expect(rows).toEqual([{code:'MC84-KEEP',period_number:1,cents:'5000'},{code:'MC84-REV',period_number:1,cents:'12345'},{code:'MC84-REV',period_number:2,cents:'0'},{code:'MC84-ZERO',period_number:1,cents:'0'}]);expect((await db.query('SELECT sum(amount_cents)::text AS annual FROM budget_line WHERE company_id=$1 AND budget_id=$2',[companyId,budgetId])).rows[0].annual).toBe('42000');expect((await db.query('SELECT count(*)::int AS n FROM journal_entry WHERE company_id=$1',[companyId])).rows[0].n).toBe(journalCount);
  const events=await db.query("SELECT after FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='budget.import_monthly_csv'",[companyId,budgetId]);expect(events.rowCount).toBe(1);expect(events.rows[0].after).toMatchObject({format:'fr-CA',definedMonthlyCount:3,replacedMonthlyCount:4,removedCount:2});
  await page.goto(importer);await upload(makeFile());await confirm.check();backupId=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'mc84-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backupId]);await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);
  await page.getByRole('button',{name:'Remplacer les répartitions vérifiées',exact:true}).click();await expect(page.locator('form').getByRole('alert')).toBeVisible();expect((await page.request.get(importer)).status()).toBe(404);expect((await page.request.get(model+'?format=en')).status()).toBe(404);await page.goto(report);await expect(page.getByRole('link',{name:'Importer les répartitions mensuelles',exact:true})).toHaveCount(0);expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='budget.import_monthly_csv'",[companyId,budgetId])).rows[0].n).toBe(1);expect(cspViolations).toEqual([]);
 }finally{await db.query('ROLLBACK');if(userId&&originalRole)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,originalRole,JSON.stringify(originalAccess??{})]);if(backupId){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backupId]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backupId]);}await db.end();}
});


test("cash forecast shows due-date assumptions, exact CSV and modular read-only access",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 let userId='',role='',access:unknown=null,backup='';
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  const customer=(await db.query("INSERT INTO contact(id,company_id,is_customer,display_name,updated_at) VALUES(gen_random_uuid(),$1,true,'Client Prévision Exemple',now()) RETURNING id",[companyId])).rows[0].id;
  const tax=(await db.query("INSERT INTO tax_code(id,company_id,code,name_fr,name_en,treatment) VALUES(gen_random_uuid(),$1,'FORECAST86-EXEMPT','Exonéré prévision','Forecast exempt','EXEMPT') RETURNING id",[companyId])).rows[0].id;
  await page.goto(company+'/factures/nouvelle');await page.getByLabel('Client',{exact:true}).selectOption(customer);await page.getByLabel('Date de facture',{exact:true}).fill('2026-06-01');await page.getByLabel('Date d’échéance',{exact:true}).fill('2026-07-05');
  const line=page.getByRole('group',{name:'Ligne 1',exact:true});await line.getByLabel('Description',{exact:true}).fill('Service pour projection par échéance');await line.getByLabel('Prix unitaire (CAD)',{exact:true}).fill('100');await line.getByLabel('Compte de revenus').selectOption({label:'4000 — Revenus de services'});await line.getByLabel('Code de taxe').selectOption(tax);await page.getByRole('button',{name:'Enregistrer le brouillon',exact:true}).click();
  await page.locator('summary',{hasText:'Valider la facture'}).click();await page.getByLabel('Date comptable',{exact:true}).fill('2026-06-01');await page.getByLabel('Je confirme les montants et la validation définitive.',{exact:true}).check();await page.getByRole('button',{name:'Valider la facture',exact:true}).click();await expect(page.getByRole('heading',{name:/^F-\d{5}$/,exact:true})).toBeVisible();
  const url=company+'/previsions-tresorerie?date=2026-06-30&jours=7',csvUrl=company+'/previsions-tresorerie/export?date=2026-06-30&jours=7';
  let before=(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audits',[companyId])).rows;
  await page.goto(url);await expect(page.getByRole('heading',{name:'Prévision de trésorerie',exact:true})).toBeVisible();await expect(page.getByRole('table',{name:'Projection quotidienne',exact:true}).getByRole('row')).toHaveCount(8);await expect(page.getByRole('table',{name:'Factures clients et fournisseurs projetées',exact:true})).toContainText('Client Prévision Exemple');
  const sourceLink=page.getByRole('table',{name:'Factures clients et fournisseurs projetées',exact:true}).getByRole('row').filter({hasText:'Client Prévision Exemple'}).getByRole('link');expect((await page.request.get((await sourceLink.getAttribute('href'))!)).status()).toBe(200);
  const csv=await page.request.get(csvUrl);expect(csv.status()).toBe(200);expect(csv.headers()['cache-control']).toBe('private, no-store');expect((await csv.body()).subarray(0,3)).toEqual(Buffer.from([239,187,191]));expect(await csv.text()).toContain('Client Prévision Exemple;2026-06-01;2026-07-05;Non;100,00');expect(await csv.text()).toContain('ne sont ni planifiés ni compensés automatiquement');
  await page.locator('summary',{hasText:'Hypothèses et limites'}).click();await expect(page.getByText(/Cette projection repose sur des hypothèses/)).toBeVisible();await page.locator('summary',{hasText:'Hypothèses et limites'}).click();await expectNoPageOverflow(page);await captureReference(page,'previsions-tresorerie','Prévision de trésorerie');await forecastPrintJourney(page,false,true);
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.getByRole('heading',{name:'Cash flow forecast',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expectNoPageOverflow(page);await captureReference(page,'previsions-tresorerie-en-dark','Cash flow forecast');await forecastPrintJourney(page,true,true);expect(await (await page.request.get(csvUrl)).text()).toContain('Client Prévision Exemple,2026-06-01,2026-07-05,No,100.00');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();
  await forecastTimingJourney(page);
  expect((await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audits',[companyId])).rows).toEqual(before);
  const revenue=(await db.query("SELECT id FROM account WHERE company_id=$1 AND code='4000'",[companyId])).rows[0].id,urls=e2eUrls();
  await db.query('UPDATE contact SET display_name=$3 WHERE company_id=$1 AND id=$2',[companyId,customer,'Client Prévision Exemple '+'X'.repeat(170)]);
  const fixtureEnv:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,LOG_LEVEL:'silent'};
  // Reproduce CI: only Playwright's server receives these values; the child configures its own fake values.
  for(const key of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete fixtureEnv[key];
  const seeded=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-forecast-print.ts',userId,companyId!,customer,revenue,tax],{encoding:'utf8',env:fixtureEnv,timeout:90_000})) as {first:string;last:string;count:number};expect(seeded.count).toBe(101);
  before=(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audits',[companyId])).rows;
  await page.goto(url+'&page=2');const paged=page.getByRole('table',{name:'Factures clients et fournisseurs projetées',exact:true});await expect(page.getByRole('navigation',{name:'Pages de la prévision',exact:true})).toBeVisible();expect(await paged.getByRole('row').count()).toBeGreaterThan(1);expect(await paged.getByRole('row').count()).toBeLessThanOrEqual(101);
  await forecastPrintJourney(page,false,false,seeded.last);await expect(page).toHaveURL(url+'&page=2');
  const printPath=company+'/previsions-tresorerie/imprimer';
  const guest=await browser.newContext();try{const response=await guest.request.get(new URL(printPath,page.url()).href,{maxRedirects:0});expect(response.status()).toBe(307);expect(response.headers()['location']).toContain('/connexion');}finally{await guest.close();}
  for(const bad of ['date=2026-02-30','date=9999-01-01','jours=14','date=2026-06-30&date=2026-06-30','jours=7&jours=30','page=0','delai_clients=1','delai_clients=7&delai_clients=7','delai_fournisseurs=-7']){const res=await page.request.get(company+'/previsions-tresorerie/export?'+bad);expect(res.status()).toBe(400);expect(res.headers()['cache-control']).toBe('private, no-store');await page.goto(company+'/previsions-tresorerie?'+bad);await expect(page.getByRole('alert').filter({hasText:'Choisissez une date de référence valide'})).toBeVisible();await page.goto(printPath+'?'+bad);await expect(page.getByRole('alert').filter({hasText:'Choisissez une date de référence valide'})).toBeVisible();await expect(page.getByRole('button',{name:'Imprimer / PDF',exact:true})).toHaveCount(0);}
  expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/previsions-tresorerie/export')).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/previsions-tresorerie/imprimer')).status()).toBe(404);
  expect((await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audits',[companyId])).rows).toEqual(before);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'forecast86-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"sales\":\"read\",\"contacts\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(url);await expect(page.getByRole('table',{name:'Factures clients et fournisseurs projetées',exact:true})).toContainText('Client Prévision Exemple');expect((await page.request.get(csvUrl)).status()).toBe(200);expect((await page.request.get(printPath+'?date=2026-06-30&jours=7')).status()).toBe(200);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"read\",\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(url)).status()).toBe(404);expect((await page.request.get(csvUrl)).status()).toBe(404);expect((await page.request.get(printPath)).status()).toBe(404);await page.goto(company);await expect(page.getByRole('link',{name:'Prévision de trésorerie',exact:true})).toHaveCount(0);
  expect(cspViolations).toEqual([]);
 }finally{await db.query('ROLLBACK');if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();}
});

/** Complete due-date projection on paper: same values, all assumptions, no private notes or writes. */
async function forecastPrintJourney(page:Page,english:boolean,capture:boolean,lastNumber?:string){
 const original=page.url(),label=english?'Complete print / PDF':'Impression / PDF complet';
 await page.getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(/\/previsions-tresorerie\/imprimer\?/);
 const root=page.locator('.cash-forecast-print'),detail=root.getByRole('table',{name:english?'Projected invoices and bills':'Factures clients et fournisseurs projetées',exact:true});
 await expect(root).toContainText('Client Prévision Exemple');await expect(root).toContainText(english?'not a guarantee of available cash':'ne garantit pas les liquidités disponibles');await expect(root.getByRole('heading',{name:english?'Opening bank and cash balances':'Soldes initiaux banque et caisse',exact:true})).toBeVisible();
 await expect(detail.getByRole('link')).toHaveCount(0);await expect(root.locator('details').filter({hasText:english?'Assumptions and limits':'Hypothèses et limites'})).toHaveCount(0);
 if(lastNumber){expect(await detail.getByRole('row').count()).toBeGreaterThan(101);await expect(detail).toContainText(lastNumber);expect(await page.locator('body').innerText()).not.toMatch(/FORECAST-PRINT-PRIVATE-(MEMO|LINE)/);const response=await page.request.get(page.url());expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('private');expect(response.headers()['cache-control']).toContain('no-store');expect(await response.text()).not.toMatch(/FORECAST-PRINT-PRIVATE-(MEMO|LINE)/);}
 await expectNoPageOverflow(page);if(capture&&process.env.E2E_MOBILE==='1')await captureReference(page,english?'previsions-tresorerie-impression-en-dark':'previsions-tresorerie-impression',root.getByRole('button',{name:english?'Print / PDF':'Imprimer / PDF',exact:true}));
 const text=await detail.innerText();let posts=0;const count=(request:{method:()=>string})=>{if(request.method()==='POST')posts++;};page.on('request',count);
 await page.evaluate(()=>{window.print=()=>document.documentElement.setAttribute('data-forecast-print','true');});await page.getByRole('button',{name:english?'Print / PDF':'Imprimer / PDF',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-forecast-print','true');expect(posts).toBe(0);page.off('request',count);
 await page.emulateMedia({media:'print'});await expect(page.locator('.workspace-header')).toBeHidden();await expect(page.locator('.workspace-sidebar')).toBeHidden();await expect(page.locator('nav:visible')).toHaveCount(0);for(const control of await root.locator('.print-controls').all())await expect(control).toBeHidden();await expect(root.locator('.statement-print-heading')).toContainText('Atelier Exemple inc.');await expect(root.locator('.statement-print-heading')).toContainText('CAD');expect(await detail.innerText()).toBe(text);
 expect(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');expect(await root.getByRole('heading',{level:1}).evaluate(el=>getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');expect(await detail.locator('thead').evaluate(el=>getComputedStyle(el).display)).toBe('table-header-group');expect(await detail.locator('th,td').evaluateAll(cells=>cells.some(cell=>cell.scrollWidth>cell.clientWidth+1))).toBe(false);
 if(process.env.E2E_MOBILE!=='1'){const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(3000);const boxes=[...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\]/g)];expect(boxes.length).toBeGreaterThan(lastNumber?1:0);for(const box of boxes)expect(Number(box[1])).toBeGreaterThan(Number(box[2]));}
 if(capture&&process.env.E2E_MOBILE!=='1')await captureReference(page,english?'previsions-tresorerie-impression-en-dark':'previsions-tresorerie-impression');
 await page.emulateMedia({media:'screen'});await page.getByRole('link',{name:english?'Back to forecast':'Retour à la prévision',exact:true}).click();await expect(page).toHaveURL(original);
}

/** Timing assumptions are read-only, visible in exports, and compared to the same baseline. */
async function forecastTimingJourney(page:Page){
 const amount=(root:Locator,label:string)=>root.locator('dt').filter({hasText:new RegExp('^'+label+'$')}).locator('xpath=following-sibling::dd[1]');
 const incoming=await amount(page.locator('body'),'Encaissements prévus').innerText(),outgoing=await amount(page.locator('body'),'Décaissements prévus').innerText(),opening=await amount(page.locator('body'),'Trésorerie initiale').innerText();
 await page.locator('summary').filter({hasText:'Simuler les délais de règlement'}).click();await page.getByRole('combobox',{name:'Délai additionnel clients (jours)',exact:true}).selectOption('7');await page.getByRole('combobox',{name:'Délai additionnel fournisseurs (jours)',exact:true}).selectOption('14');await page.getByRole('button',{name:'Appliquer',exact:true}).click();await expect(page.getByTestId('forecast-timing')).toContainText('clients 7 jours, fournisseurs 14 jours');
 const baseline=page.getByRole('heading',{name:'Sans délai additionnel',exact:true}).locator('..'),selected=page.getByRole('heading',{name:'Hypothèses sélectionnées',exact:true}).locator('..');
 await expect(amount(baseline,'Encaissements prévus')).toHaveText(incoming);await expect(amount(baseline,'Décaissements prévus')).toHaveText(outgoing);await expect(amount(selected,'Trésorerie finale projetée')).toHaveText(opening);await expect(page.getByText('Aucune facture projetée dans cet horizon.',{exact:true})).toBeVisible();
 const csv=await page.request.get((await page.getByRole('link',{name:'Exporter en CSV',exact:true}).getAttribute('href'))!);expect(csv.status()).toBe(200);expect(csv.headers()['cache-control']).toBe('private, no-store');expect(await csv.text()).toContain('Délai additionnel clients (jours);7');expect(await csv.text()).toContain('Délai additionnel fournisseurs (jours);14');expect(await csv.text()).toContain('Date du minimum');
 await expectNoPageOverflow(page);await captureReference(page,'previsions-tresorerie-delais','Comparaison des hypothèses de règlement');
 const normal=page.url();await page.getByRole('link',{name:'Impression / PDF complet',exact:true}).click();await expect(page.getByTestId('forecast-timing')).toContainText('clients 7 jours, fournisseurs 14 jours');await expect(page.getByRole('heading',{name:'Comparaison des hypothèses de règlement',exact:true})).toBeVisible();await page.emulateMedia({media:'print'});await expect(page.locator('.workspace-header')).toBeHidden();await expect(page.getByTestId('forecast-timing')).toBeVisible();if(process.env.E2E_MOBILE!=='1'){const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');}await page.emulateMedia({media:'screen'});await page.getByRole('link',{name:'Retour à la prévision',exact:true}).click();await expect(page).toHaveURL(normal);
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Settlement assumption comparison',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'previsions-tresorerie-delais-en-dark','Settlement assumption comparison');const english=await page.request.get((await page.getByRole('link',{name:'Export CSV',exact:true}).getAttribute('href'))!);expect(await english.text()).toContain('Additional customer delay (days),7');expect(await english.text()).toContain('Minimum date');
 await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();await page.getByRole('link',{name:'Retirer les délais additionnels',exact:true}).click();await expect(page.getByRole('heading',{name:'Comparaison des hypothèses de règlement',exact:true})).toHaveCount(0);await expect(page.getByTestId('forecast-timing')).toContainText('clients 0 jours, fournisseurs 0 jours');
}


test("saved forecast configurations persist reusable filters with audited modular access",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];

 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 let userId='',role='',access:unknown=null,backup='';
 const name='Prudent — clients à 14 jours',query='date=2026-06-30&jours=30&delai_clients=7&delai_fournisseurs=14',base=company+'/previsions-tresorerie',configs=base+'/configurations';
 try{
  const membership=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=membership.user_id;role=membership.role;access=membership.module_access;
  const before=(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM journal_line WHERE company_id=$1)::text AS lines',[companyId])).rows;
  await page.goto(base+'?'+query);await page.getByRole('link',{name:'Configurations enregistrées',exact:true}).click();await expect(page.getByRole('heading',{name:'Configurations de prévision enregistrées',exact:true})).toBeVisible();await expect(page.getByText('Les configurations seront appliquées à la date de référence : 2026-06-30.',{exact:true})).toBeVisible();
  await page.getByLabel('Nom de la configuration',{exact:true}).fill(name);await page.getByLabel('Horizon (jours)',{exact:true}).selectOption('60');await page.getByLabel('Délai additionnel clients (jours)',{exact:true}).selectOption('14');await page.getByLabel('Délai additionnel fournisseurs (jours)',{exact:true}).selectOption('7');await page.getByRole('button',{name:'Enregistrer la configuration',exact:true}).click();
  const card=page.getByRole('heading',{name,exact:true}).locator('..');await expect(card).toBeVisible();await expect(card).toContainText('Horizon : 60 jours');const presetId=(await db.query('SELECT id FROM cash_forecast_preset WHERE company_id=$1 AND name=$2',[companyId,name])).rows[0].id;
  await page.getByLabel('Nom de la configuration',{exact:true}).fill(name);await page.getByLabel('Horizon (jours)',{exact:true}).selectOption('90');await page.getByRole('button',{name:'Enregistrer la configuration',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('Une configuration porte déjà ce nom');await expect(page.getByLabel('Nom de la configuration',{exact:true})).toHaveValue(name);await expect(page.getByLabel('Horizon (jours)',{exact:true})).toHaveValue('90');
  await page.goto(configs+'?'+query);await expectNoPageOverflow(page);await captureReference(page,'configurations-prevision','Configurations partagées (1/20)');
  await page.getByRole('link',{name:'Appliquer « '+name+' »',exact:true}).click();await expect(page).toHaveURL(base+'?date=2026-06-30&jours=60&delai_clients=14&delai_fournisseurs=7');await expect(page.getByTestId('forecast-timing')).toContainText('clients 14 jours, fournisseurs 7 jours');
  const csv=await page.request.get((await page.getByRole('link',{name:'Exporter en CSV',exact:true}).getAttribute('href'))!);expect(await csv.text()).toContain('Délai additionnel clients (jours);14');
  await page.getByRole('link',{name:'Impression / PDF complet',exact:true}).click();await expect(page.getByTestId('forecast-timing')).toContainText('clients 14 jours, fournisseurs 7 jours');await expect(page.getByRole('heading',{name,exact:true})).toHaveCount(0);
  await page.goto(configs+'?'+query);await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Saved forecast configurations',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'configurations-prevision-en-dark','Shared configurations (1/20)');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'preset90-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await page.getByLabel('Nom de la configuration',{exact:true}).fill('Permission retirée');await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"sales\":\"read\",\"contacts\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);
  await page.getByRole('button',{name:'Enregistrer la configuration',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText("Tu n'as pas les droits pour faire cela.");expect((await db.query('SELECT count(*)::int AS n FROM cash_forecast_preset WHERE company_id=$1',[companyId])).rows[0].n).toBe(1);
  await page.goto(configs+'?'+query);await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Enregistrer la configuration',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Supprimer la configuration',exact:true})).toHaveCount(0);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"read\",\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(configs)).status()).toBe(404);
  await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);
  const guest=await browser.newContext();try{const response=await guest.request.get(new URL(configs,page.url()).href,{maxRedirects:0});expect(response.status()).toBe(307);expect(response.headers()['location']).toContain('/connexion');}finally{await guest.close();}
  expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/previsions-tresorerie/configurations')).status()).toBe(404);
  await page.goto(configs+'?date=2026-06-30&delai_clients=7&delai_clients=14');await expect(page.getByRole('main').getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Enregistrer la configuration',exact:true})).toHaveCount(0);
  await page.goto(configs+'?'+query);await card.locator('summary').click();await page.getByRole('button',{name:'Supprimer la configuration',exact:true}).click();await expect(card).toBeVisible();await card.getByRole('checkbox').check();await page.getByRole('button',{name:'Supprimer la configuration',exact:true}).click();await expect(page.getByText('Aucune configuration enregistrée.',{exact:true})).toBeVisible();
  expect((await db.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_type=$1 AND entity_id=$2',['cash_forecast_preset',presetId])).rows[0].n).toBe(2);expect((await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM journal_line WHERE company_id=$1)::text AS lines',[companyId])).rows).toEqual(before);expect(cspViolations).toEqual([]);
 }finally{
  if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);
  if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}
  await db.end();
 }
});


test("budget print copies preserve complete annual and monthly reports with read-only fiscal access",async({page,browser})=>{
 test.setTimeout(240_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];


 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  const urls=e2eUrls(),fixtureEnv:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,LOG_LEVEL:'silent'};for(const key of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete fixtureEnv[key];
  const fixture=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-budget-print.ts',userId,companyId!],{encoding:'utf8',env:fixtureEnv,timeout:90_000})) as {budget:string;period:string;nextPeriod:string;year:string;count:number};expect(fixture.count).toBe(105);
  const annual=company+'/budgets/'+fixture.budget,monthly=annual+'/mensuel?periode='+fixture.period;
  const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audit,(SELECT revision FROM budget WHERE id=$2)::text AS revision',[companyId,fixture.budget])).rows;
  const before=await counts();
  await page.goto(annual);await budgetPrintJourney(page,false,false,fixture.count,true);
  await page.goto(monthly);await budgetPrintJourney(page,true,false,fixture.count,false);await expect(page).toHaveURL(monthly);
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');
  await budgetPrintJourney(page,true,true,fixture.count,true);await page.goto(annual);await budgetPrintJourney(page,false,true,fixture.count,false);
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();
  for(const bad of ['',fixture.period+'&periode='+fixture.period,'not-a-period','00000000-0000-7000-8000-999999999999'])for(const suffix of ['', '/export','/imprimer'])expect((await page.request.get(annual+'/mensuel'+suffix+'?periode='+bad)).status()).toBe(404);
  expect((await page.request.get(annual+'/imprimer')).status()).toBe(200);expect((await page.request.get(annual+'/mensuel/imprimer?periode='+fixture.nextPeriod)).status()).toBe(200);
  expect((await page.request.get(company+'/budgets/00000000-0000-7000-8000-999999999999/imprimer')).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/budgets/'+fixture.budget+'/imprimer')).status()).toBe(404);
  expect(await counts()).toEqual(before);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'budgetprint-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);
  const restrictedBefore=await counts();await page.goto(monthly);await budgetPrintJourney(page,true,false,fixture.count,false);await page.goto(annual);await budgetPrintJourney(page,false,false,fixture.count,false);expect(await counts()).toEqual(restrictedBefore);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);for(const path of [annual+'/imprimer',annual+'/mensuel/imprimer?periode='+fixture.period])expect((await page.request.get(path)).status()).toBe(404);
  await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);
  const guest=await browser.newContext();try{const res=await guest.request.get(new URL(annual+'/imprimer',page.url()).href,{maxRedirects:0});expect(res.status()).toBe(307);expect(res.headers()['location']).toContain('/connexion');}finally{await guest.close();}
  await db.query('BEGIN');try{
   await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);
   await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) SELECT gen_random_uuid(),$1,'BP91-LIM-'||lpad(n::text,3,'0'),'Capacité '||n,'Capacity '||n,'EXPENSE','OPERATING_EXPENSE',now() FROM generate_series(1,895) n",[companyId]);
   await db.query("INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) SELECT gen_random_uuid(),$1,$2,id,1,now() FROM account WHERE company_id=$1 AND code LIKE 'BP91-LIM-%'",[companyId,fixture.budget]);await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
  const cappedBefore=await counts();for(const path of [annual+'/imprimer',annual+'/mensuel/imprimer?periode='+fixture.period]){await page.goto(path);await expect(page.locator('.budget-print table').getByRole('row')).toHaveCount(1001);await expect(page.locator('.budget-print table')).toContainText('BP91-LIM-895');}expect(await counts()).toEqual(cappedBefore);
  await db.query('BEGIN');try{await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);const a=(await db.query("INSERT INTO account(id,company_id,code,name_fr,name_en,type,subtype,updated_at) VALUES(gen_random_uuid(),$1,'BP91-OVER','Au-delà','Over capacity','EXPENSE','OPERATING_EXPENSE',now()) RETURNING id",[companyId])).rows[0].id;await db.query('INSERT INTO budget_line(id,company_id,budget_id,account_id,amount_cents,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,1,now())',[companyId,fixture.budget,a]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
  for(const path of [annual+'/imprimer',annual+'/mensuel/imprimer?periode='+fixture.period]){await page.goto(path);await expect(page.getByRole('main').getByRole('alert')).toBeVisible();await expect(page.locator('.budget-print table')).toHaveCount(0);await expect(page.getByRole('button',{name:'Imprimer / PDF',exact:true})).toHaveCount(0);}
  expect(cspViolations).toEqual([]);
 }finally{
  if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);
  if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();
 }
});

async function budgetPrintJourney(page:Page,monthly:boolean,english:boolean,count:number,capture:boolean){
 const original=page.url();await page.getByRole('link',{name:english?'Complete print / PDF':'Impression / PDF complet',exact:true}).click();
 const root=page.locator('.budget-print'),table=root.getByRole('table');await expect(root.getByRole('heading',{name:english?(monthly?'Monthly budget — print copy':'Annual budget — print copy'):(monthly?'Budget mensuel — copie imprimable':'Budget annuel — copie imprimable'),exact:true})).toBeVisible();
 await expect(table.getByRole('row')).toHaveCount(count+1);await expect(table).toContainText('BP91-ZZ-100');await expect(table).toContainText('BP91-UNSET');await expect(table.getByRole('row').filter({hasText:'BP91-UNSET'})).toContainText(english?'Not set':'Non défini');
 const revenue=table.getByRole('row').filter({hasText:'BP91-REV'}),zero=table.getByRole('row').filter({hasText:'BP91-ZERO'});await expect(revenue).toContainText(english?(monthly?'2,600.00':'2,770.00'):(monthly?'2 600,00':'2 770,00'));await expect(zero).toContainText(english?'0.00':'0,00');
 if(monthly){await expect(root).toContainText('2024-04-01');await expect(root).toContainText('2024-04-30');await expect(revenue).toContainText(english?'5,000.00':'5 000,00');await expect(revenue).toContainText(english?'5,000.01':'5 000,01');await expect(revenue).toContainText('2 / 12');}
 const response=await page.request.get(page.url());expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('private');expect(response.headers()['cache-control']).toContain('no-store');expect(await response.text()).not.toContain('BUDGET-PRINT-PRIVATE');
 await expect(root.locator('form,input,select')).toHaveCount(0);await expect(table.getByRole('link')).toHaveCount(0);await expectNoPageOverflow(page);
 if(capture&&process.env.E2E_MOBILE==='1')await captureReference(page,monthly?'budget-mensuel-impression-en-dark':'budget-annuel-impression',root.getByRole('button',{name:english?'Print / PDF':'Imprimer / PDF',exact:true}));
 let posts=0;const request=(r:{method:()=>string})=>{if(r.method()==='POST')posts++;};page.on('request',request);await page.evaluate(()=>{window.print=()=>document.documentElement.setAttribute('data-budget-print','true');});await root.getByRole('button',{name:english?'Print / PDF':'Imprimer / PDF',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-budget-print','true');expect(posts).toBe(0);page.off('request',request);
 await page.emulateMedia({media:'print'});await expect(page.locator('.workspace-header')).toBeHidden();await expect(root.getByRole('button',{name:english?'Print / PDF':'Imprimer / PDF',exact:true})).toBeHidden();expect(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');expect(await table.locator('thead').evaluate(e=>getComputedStyle(e).display)).toBe('table-header-group');expect(await table.locator('th,td').evaluateAll(cells=>cells.some(c=>c.scrollWidth>c.clientWidth+1))).toBe(false);
 if(capture&&process.env.E2E_MOBILE!=='1'&&process.env.ALLUMI_SCREENSHOTS==='1'){const viewport=page.viewportSize()!;await page.setViewportSize({width:1280,height:1280});await captureReference(page,monthly?'budget-mensuel-impression-en-dark':'budget-annuel-impression',undefined,false);await page.setViewportSize(viewport);}
 if(process.env.E2E_MOBILE!=='1'){const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length).toBeGreaterThan(1);const size=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf.toString('latin1'));expect(size).not.toBeNull();expect(Number(size![1])).toBeGreaterThan(Number(size![2]));}
 await page.emulateMedia({media:'screen'});await root.getByRole('link',{name:english?'Back to budget':'Retour au budget',exact:true}).click();await expect(page).toHaveURL(original);
}


test("mileage log preserves exact metres, filtered CSV and audited modular edits",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];



 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 const base=company+'/kilometrage';
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  const financial=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM journal_line WHERE company_id=$1)::text AS lines',[companyId])).rows;const before=await financial();
  await page.goto(company+'/espace/kilometrage');await page.getByRole('main').getByText('Carnet de kilométrage→',{exact:true}).click();await expect(page.getByRole('heading',{name:'Carnet de kilométrage',exact:true})).toBeVisible();await page.getByRole('link',{name:'Nouveau trajet',exact:true}).click();
  await page.getByLabel('Date du trajet',{exact:true}).fill('2026-06-15');await page.getByLabel('Véhicule',{exact:true}).fill('Camion Exemple');await page.getByLabel('Départ',{exact:true}).fill('Québec');await page.getByLabel('Arrivée',{exact:true}).fill('Montréal');await page.getByLabel('Motif du déplacement',{exact:true}).fill('Visite client');await page.getByLabel('Distance (km)',{exact:true}).fill('0,0001');await page.getByRole('button',{name:'Enregistrer le trajet',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('au plus 3 décimales');await expect(page.getByLabel('Véhicule',{exact:true})).toHaveValue('Camion Exemple');await expect(page.getByLabel('Distance (km)',{exact:true})).toHaveValue('0,0001');
  await page.getByLabel('Distance (km)',{exact:true}).fill('12,345');await page.getByRole('button',{name:'Enregistrer le trajet',exact:true}).click();await expect(page).toHaveURL(/\/kilometrage\/[0-9a-f-]{36}$/);const detail=page.url(),id=new URL(detail).pathname.split('/').at(-1)!;await expect(page.locator('dl')).toContainText('12,345 km');
  await page.locator('summary',{hasText:'Modifier le trajet'}).click();const stale=await browser.newPage();try{await stale.context().addCookies(await page.context().cookies());await stale.goto(detail);await stale.locator('summary',{hasText:'Modifier le trajet'}).click();await stale.getByLabel('Motif du déplacement',{exact:true}).fill('Modification périmée');await page.getByLabel('Distance (km)',{exact:true}).fill('20,001');await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.locator('dl')).toContainText('20,001 km');await stale.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(stale.getByRole('main').getByRole('alert')).toContainText('Ce trajet a été modifié');await expect(stale.getByLabel('Motif du déplacement',{exact:true})).toHaveValue('Modification périmée');}finally{await stale.close();}
  await page.getByRole('link',{name:'Voir les trajets de cette année',exact:true}).click();await page.getByRole('link',{name:'Nouveau trajet',exact:true}).click();await page.getByLabel('Date du trajet',{exact:true}).fill('2026-06-30');await page.getByLabel('Véhicule',{exact:true}).fill('Voiture Exemple');await page.getByLabel('Usage',{exact:true}).selectOption('PERSONAL');await page.getByLabel('Départ',{exact:true}).fill('Québec');await page.getByLabel('Arrivée',{exact:true}).fill('Québec');await page.getByLabel('Distance (km)',{exact:true}).fill('0,001');await page.getByRole('button',{name:'Enregistrer le trajet',exact:true}).click();await expect(page.getByRole('heading',{name:'Détail du trajet',exact:true})).toBeVisible();
  const filtered=base+'?du=2026-06-01&au=2026-06-30';await page.goto(filtered);await expect(page.getByText('Du 2026-06-01 au 2026-06-30 inclus : 2 trajets.',{exact:true})).toBeVisible();await expect(page.locator('dl')).toContainText('20,002 km');await expectNoPageOverflow(page);await captureReference(page,'kilometrage',page.locator('dl').first());
  const exportUrl=base+'/export?du=2026-06-01&au=2026-06-30',csv=await page.request.get(exportUrl);expect(csv.status()).toBe(200);expect(csv.headers()['cache-control']).toBe('private, no-store');expect((await csv.body()).subarray(0,3)).toEqual(Buffer.from([239,187,191]));expect(await csv.text()).toContain('Visite client;20,001');expect(await csv.text()).toContain(';0,001');
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.getByRole('heading',{name:'Mileage log',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'kilometrage-en-dark',page.locator('dl').first());expect(await(await page.request.get(exportUrl)).text()).toContain('Visite client,20.001');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();
  const urls=e2eUrls(),fixtureEnv:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,LOG_LEVEL:'silent'};for(const key of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete fixtureEnv[key];const seeded=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-mileage.ts',userId,companyId!],{encoding:'utf8',env:fixtureEnv,timeout:90_000})) as {count:number};expect(seeded.count).toBe(51);
  await page.goto(filtered);await page.getByRole('link',{name:'Suivante',exact:true}).click();await expect(page).toHaveURL(filtered+'&page=2');await expect(page.getByText('Page 2 sur 2',{exact:true})).toBeVisible();const full=await page.request.get((await page.getByRole('link',{name:'Exporter le CSV complet',exact:true}).getAttribute('href'))!);expect(await full.text()).toContain('Visite exemple 51');expect(await full.text()).toContain('Visite client');expect(await full.text()).toContain('Nombre de trajets;53');await expect(page.locator('dl')).toContainText('20,053 km');
  await page.getByLabel('Rechercher un véhicule',{exact:true}).fill('Voiture');await page.getByLabel('Usage',{exact:true}).selectOption('PERSONAL');await page.getByRole('button',{name:'Appliquer les filtres',exact:true}).click();await expect(page.getByText('Du 2026-06-01 au 2026-06-30 inclus : 1 trajet.',{exact:true})).toBeVisible();const personal=await page.request.get((await page.getByRole('link',{name:'Exporter le CSV complet',exact:true}).getAttribute('href'))!);expect(await personal.text()).not.toContain('Camion Exemple');
  for(const bad of ['du=','du=2026-06-01&du=2026-06-01','du=2024-01-01&au=2025-01-01','usage=OTHER','page=0']){expect((await page.request.get(base+'/export?'+bad)).status()).toBe(400);await page.goto(base+'?'+bad);await expect(page.getByRole('main').getByRole('alert')).toBeVisible();}
  expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/kilometrage/'+id)).status()).toBe(404);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'mileage-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await page.goto(detail);await page.locator('summary',{hasText:'Modifier le trajet'}).click();await page.getByLabel('Motif du déplacement',{exact:true}).fill('Droits retirés');await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"read\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText("Tu n'as pas les droits pour faire cela.");
  await page.goto(detail);await expect(page.locator('summary',{hasText:'Modifier le trajet'})).toHaveCount(0);await expect(page.locator('summary',{hasText:'Supprimer le trajet'})).toHaveCount(0);expect((await page.request.get(base+'/nouveau')).status()).toBe(404);expect((await page.request.get(exportUrl)).status()).toBe(200);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);for(const path of [base,detail,exportUrl,company+'/espace/kilometrage'])expect((await page.request.get(path)).status()).toBe(404);
  await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);const guest=await browser.newContext();try{const res=await guest.request.get(new URL(base,page.url()).href,{maxRedirects:0});expect(res.status()).toBe(307);expect(res.headers()['location']).toContain('/connexion');}finally{await guest.close();}
  await page.goto(detail);await page.locator('summary',{hasText:'Supprimer le trajet'}).click();await page.getByRole('button',{name:'Confirmer la suppression',exact:true}).click();await expect(page.getByRole('heading',{name:'Détail du trajet',exact:true})).toBeVisible();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirmer la suppression',exact:true}).click();await expect(page.getByRole('heading',{name:'Carnet de kilométrage',exact:true})).toBeVisible();expect((await page.request.get(detail)).status()).toBe(404);expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type='mileage_trip' AND entity_id=$1",[id])).rows[0].n).toBe(3);expect(await financial()).toEqual(before);expect(cspViolations).toEqual([]);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();}
});


test("mileage print includes all filtered pages, exact distances and private read-only landscape PDF", async ({page,browser}) => {
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 const base=company+'/kilometrage',query='du=2026-09-01&au=2026-09-30&vehicule=IMP95+%25_&page=2',source=base+'?'+query,copy=base+'/imprimer?'+query;
 try {
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  const seed=(mode:string)=>{const urls=e2eUrls(),env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,LOG_LEVEL:'silent'};for(const key of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete env[key];return JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-mileage-print.ts',userId,companyId!,mode],{encoding:'utf8',env,timeout:90_000})).count as number;};
  expect(seed('initial')).toBe(106);await page.goto(source);await expect(page.getByText('Page 2 sur 3',{exact:true})).toBeVisible();await expect(page.locator('dl')).toContainText('12,450 km');
  expect(seed('extra')).toBe(1);
  const counts=async()=>(await db.query("SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM audit_log WHERE company_id=$1 AND entity_type='mileage_trip')::text AS audit,(SELECT sum(revision) FROM mileage_trip WHERE company_id=$1)::text AS revisions",[companyId])).rows;const before=await counts();
  await mileagePrintJourney(page,false,true);await expect(page).toHaveURL(source);
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await mileagePrintJourney(page,true,true);await expect(page).toHaveURL(source);await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.getByRole('heading',{name:'Carnet de kilométrage',exact:true})).toBeVisible();expect(await counts()).toEqual(before);
  await page.goto(base+'/imprimer?du=2026-09-01&au=2026-09-30&vehicule=not-present');await expect(page.locator('.mileage-print').getByRole('table')).toHaveCount(0);await expect(page.locator('.mileage-print')).toContainText('0,000 km');
  for(const bad of ['du=','du=2026-09-01&du=2026-09-01','du=2024-01-01&au=2025-01-01','usage=OTHER','page=0']){await page.goto(base+'/imprimer?'+bad);await expect(page.getByRole('main').getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Imprimer / PDF',exact:true})).toHaveCount(0);}
  expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/kilometrage/imprimer?'+query)).status()).toBe(404);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'mileage-print-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(source);await mileagePrintJourney(page,false,false);expect(await counts()).toEqual(before);
  await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(copy)).status()).toBe(404);
  await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);
  const guest=await browser.newContext();try{expect((await guest.request.get(new URL(copy,page.url()).href,{maxRedirects:0})).status()).toBe(307);}finally{await guest.close();}
  expect(seed('capacity')).toBe(893);const thousand=await page.request.get(copy);expect(thousand.status()).toBe(200);const thousandHtml=await thousand.text();expect(thousandHtml).toContain('Visite imprimable 892');await page.goto(copy);await expect(page.locator('.mileage-print').getByRole('table').getByRole('row')).toHaveCount(1001);await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(seed('extra')).toBe(1);const after=await counts();await page.goto(source);await expect(page.getByRole('link',{name:'Impression / PDF complet',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Exporter le CSV complet',exact:true})).toBeVisible();await page.goto(copy);await expect(page.getByRole('main').getByRole('alert')).toContainText('1 000 trajets');await expect(page.getByRole('button',{name:'Imprimer / PDF',exact:true})).toHaveCount(0);await expect(page.getByRole('main').getByRole('table')).toHaveCount(0);expect(await counts()).toEqual(after);expect(cspViolations).toEqual([]);
 } finally {if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();}
});

async function mileagePrintJourney(page:Page,english:boolean,capture:boolean) {
 const original=page.url();await page.getByRole('link',{name:english?'Complete print / PDF':'Impression / PDF complet',exact:true}).click();const root=page.locator('.mileage-print'),table=root.getByRole('table');
 await expect(root.getByRole('heading',{name:english?'Mileage log — print copy':'Carnet de kilométrage — copie imprimable',exact:true})).toBeVisible();await expect(table.getByRole('row')).toHaveCount(108);await expect(table).toContainText('Trajet relu à l’ouverture');await expect(table).toContainText('M'.repeat(200));await expect(table).toContainText('12'+(english?'.':',')+'345');await expect(root.locator('dl')).toContainText(english?'13.450 km':'13,450 km');await expect(root.locator('form,input,select')).toHaveCount(0);await expect(table.getByRole('link')).toHaveCount(0);await expectNoPageOverflow(page);
 const response=await page.request.get(page.url());expect(response.headers()['cache-control']).toContain('private');expect(response.headers()['cache-control']).toContain('no-store');await expect(root).not.toContainText('CAD');
 const button=root.getByRole('button',{name:english?'Print / PDF':'Imprimer / PDF',exact:true});
 if(capture&&process.env.E2E_MOBILE==='1')await captureReference(page,english?'kilometrage-impression-en-dark':'kilometrage-impression',button);
 let posts=0;const request=(r:{method:()=>string})=>{if(r.method()==='POST')posts++;};page.on('request',request);await page.evaluate(()=>{window.print=()=>document.documentElement.setAttribute('data-mileage-print','true');});await button.click();await expect(page.locator('html')).toHaveAttribute('data-mileage-print','true');expect(posts).toBe(0);page.off('request',request);
 await page.emulateMedia({media:'print'});await expect(page.locator('.workspace-header')).toBeHidden();await expect(button).toBeHidden();expect(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');expect(await table.locator('thead').evaluate(e=>getComputedStyle(e).display)).toBe('table-header-group');expect(await table.locator('th,td').evaluateAll(cells=>cells.some(c=>c.scrollWidth>c.clientWidth+1))).toBe(false);
 if(capture&&process.env.E2E_MOBILE!=='1'&&process.env.ALLUMI_SCREENSHOTS==='1'){const viewport=page.viewportSize()!;await page.setViewportSize({width:1280,height:1280});await captureReference(page,english?'kilometrage-impression-en-dark':'kilometrage-impression',undefined,false);await page.setViewportSize(viewport);}
 if(process.env.E2E_MOBILE!=='1'){const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length).toBeGreaterThan(1);const size=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf.toString('latin1'));expect(size).not.toBeNull();expect(Number(size![1])).toBeGreaterThan(Number(size![2]));}
 await page.emulateMedia({media:'screen'});await root.getByRole('link',{name:english?'Back to mileage log':'Retour au carnet',exact:true}).click();await expect(page).toHaveURL(original);
}


test("long contract terms, shared rates and client-link signatures preserve content and financial privacy",async({page,browser})=>{
 test.setTimeout(240_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 const base=company+'/contrats',title='Contrat de référence CT96',customer='Camille Client',email='signature96@example.test',body='Contrat de {{company_name}} pour {{client_name}}. Tarif : {{hourly_rate}}.\n\n'+('Conditions de service. Respect des échéances convenues, des responsabilités et de la confidentialité. '.repeat(90))+'\n\nLe tarif applicable demeure {{hourly_rate}}.';
 const guest=watchCsp(await browser.newContext({viewport:page.viewportSize()??undefined,isMobile:process.env.E2E_MOBILE==='1',hasTouch:process.env.E2E_MOBILE==='1'})),client=await guest.newPage();
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  const financial=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM journal_line WHERE company_id=$1)::text AS lines',[companyId])).rows;const before=await financial();
  await page.goto(base+'/modele');await page.getByLabel('Texte et conditions du contrat',{exact:true}).fill(body);await page.getByRole('button',{name:'Insérer le tarif horaire',exact:true}).click();await expect(page.getByLabel('Texte et conditions du contrat',{exact:true})).toHaveValue(body+'{{hourly_rate}}');await page.getByLabel('Texte et conditions du contrat',{exact:true}).fill(body);await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('125.99');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Enregistrement effectué.');
  await page.goto(base+'/nouveau');await expect(page.getByLabel('Texte et conditions du contrat',{exact:true})).toHaveValue(body);await page.getByLabel('Titre du document',{exact:true}).fill(title);await page.getByLabel('Nom du client',{exact:true}).fill(customer);await page.getByLabel('Courriel du client',{exact:true}).fill(email);await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('125.999');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('Tarif invalide');await expect(page.getByLabel('Texte et conditions du contrat',{exact:true})).toHaveValue(body);await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('150.50');const preview=page.getByRole('region',{name:'Aperçu du document',exact:true});await expect(preview).toContainText('150,50 CAD/h');expect((await preview.textContent())!.match(/150,50 CAD\/h/g)).toHaveLength(2);await expectNoPageOverflow(page);await captureReference(page,'contrats-editeur',page.getByLabel('Tarif horaire (CAD/h)',{exact:true}),false,true);
  await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page).toHaveURL(/\/contrats\/[0-9a-f-]{36}$/);const detail=page.url(),id=new URL(detail).pathname.split('/').at(-1)!;await expect(page.getByRole('main')).toContainText('150,50 CAD/h');expect((await page.request.get(detail+'/preuve')).status()).toBe(404);expect((await page.request.get(detail+'/copie')).status()).toBe(404);await expect(page.getByRole('region',{name:'Dossier de preuve',exact:true})).toHaveCount(0);const publish=page.locator('form').filter({has:page.getByRole('button',{name:'Publier le lien client',exact:true})});await publish.getByRole('checkbox').check();await publish.getByRole('button',{name:'Publier le lien client',exact:true}).click();const open=page.getByRole('link',{name:'Ouvrir le portail client',exact:true});await expect(open).toBeVisible();const url=(await open.getAttribute('href'))!;expect(url).toMatch(/\/document\/[A-Za-z0-9_-]{43}$/);const hash=(await db.query('SELECT content_hash FROM client_document WHERE id=$1',[id])).rows[0].content_hash;
  const response=await client.goto(url);expect(response!.status()).toBe(200);expect(response!.headers()['referrer-policy']).toBe('no-referrer');expect(response!.headers()['x-robots-tag']).toContain('noindex');expect(response!.headers()['cache-control']).toContain('no-store');expect((await db.query('SELECT first_viewed_at FROM client_document WHERE id=$1',[id])).rows[0].first_viewed_at).toBeNull();await expect(client.getByRole('button',{name:'Signer le document',exact:true})).toHaveCount(0);
  await client.getByRole('button',{name:'Consulter le document',exact:true}).click();await expect(client.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(client.locator('article')).toContainText('150,50 CAD/h');await expect(client.locator('article')).toContainText(hash);await expectNoPageOverflow(client);await captureReference(client,'contrats-portail',client.getByRole('heading',{name:'Signer le document',exact:true}),false,true);await client.getByLabel('Ton nom complet',{exact:true}).fill(customer);await client.getByLabel('Confirme ton courriel',{exact:true}).fill('wrong@example.test');await client.getByRole('checkbox').check();await client.getByRole('button',{name:'Signer le document',exact:true}).click();await expect(client.getByRole('main').getByRole('alert')).toContainText('Signature refusée');await expect(client.getByLabel('Ton nom complet',{exact:true})).toHaveValue(customer);await client.getByLabel('Confirme ton courriel',{exact:true}).fill(email);await client.getByRole('checkbox').check();await client.getByRole('button',{name:'Signer le document',exact:true}).click();await expect(client.getByRole('status')).toContainText('Signature enregistrée');await expect(client.locator('article')).toContainText('Camille Client');await expect(client.getByRole('button',{name:'Signer le document',exact:true})).toHaveCount(0);
  await page.reload();await expect(page.getByRole('main')).toContainText('Signé électroniquement');
  const evidenceRegion=page.getByRole('region',{name:'Dossier de preuve',exact:true});await expect(evidenceRegion).toContainText('Copie confidentielle');await expectNoPageOverflow(page);const evidenceDownload=page.waitForEvent('download');await evidenceRegion.getByRole('link',{name:'Télécharger le dossier de preuve (JSON)',exact:true}).click();const evidenceFile=await evidenceDownload;expect(evidenceFile.suggestedFilename()).toBe('allumi-evidence-'+id+'.json');const evidenceData=JSON.parse(readFileSync((await evidenceFile.path())!,'utf8'));expect(evidenceData.format).toBe('allumi.client-document-evidence');expect(evidenceData.signature.name).toBe(customer);expect(evidenceData.publication.sha256).toBe(hash);expect(createHash('sha256').update(evidenceData.publication.canonicalPayload,'utf8').digest('hex')).toBe(hash);expect(JSON.stringify(evidenceData)).not.toContain(new URL(url).pathname);const evidenceResponse=await page.request.get(detail+'/preuve');expect(evidenceResponse.status()).toBe(200);expect(evidenceResponse.headers()['cache-control']).toContain('private, no-store');expect(evidenceResponse.headers()['referrer-policy']).toBe('no-referrer');expect(evidenceResponse.headers()['content-type']).toContain('application/json');expect(evidenceResponse.headers()['x-content-type-options']).toBe('nosniff');expect((await guest.request.get(detail+'/preuve',{maxRedirects:0})).status()).toBe(307);
  expect((await db.query('SELECT content_hash FROM client_document WHERE id=$1',[id])).rows[0].content_hash).toBe(hash);expect(await financial()).toEqual(before);
  const searchDate=(await db.query("SELECT to_char(created_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD') AS date FROM client_document WHERE id=$1",[id])).rows[0].date,globalUrl=company+'/recherche?'+new URLSearchParams({type:'CLIENT_DOCUMENT',q:title,statut:'SIGNED',du:searchDate,au:searchDate});
  const globalResponse=await page.goto(globalUrl);const globalResults=page.getByRole('list',{name:'Résultats de recherche',exact:true});await expect(globalResults.getByRole('link')).toHaveCount(1);await expect(globalResults.getByRole('link',{name:title,exact:true})).toHaveAttribute('href',new URL(detail).pathname);await expect(globalResults).toContainText('Contrats et liens clients');await expect(globalResults).toContainText('Signé électroniquement');await expect(globalResults.locator('time')).toHaveAttribute('datetime',searchDate);await expect(page.getByRole('main')).toContainText('Date de création');expect(await globalResponse!.text()).not.toContain(hash);expect(await globalResponse!.text()).not.toContain(new URL(url).pathname);await expectNoPageOverflow(page);await captureReference(page,'recherche-contrats',globalResults,false,true);
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');const enSearch=page.getByRole('list',{name:'Search results',exact:true});await expect(enSearch).toContainText('Contracts and client links');await expect(enSearch).toContainText('Electronically signed');await expectNoPageOverflow(page);await captureReference(page,'recherche-contrats-en-dark',enSearch,false,true);await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
  const searchHeader=page.getByRole('search',{name:'Recherche dans l’entreprise',exact:true}),searchField=searchHeader.getByRole('combobox',{name:'Terme recherché',exact:true});await searchField.fill(title);await expect(searchHeader.getByRole('listbox').getByRole('option')).toHaveCount(1);await expect(searchHeader.getByRole('option')).toContainText('Contrats et liens clients');const suggestResponse=await page.request.get(company+'/recherche/suggestions?'+new URLSearchParams({q:title}));const suggestData=await suggestResponse.json();expect(suggestResponse.headers()['cache-control']).toContain('no-store');expect(suggestData.rows).toHaveLength(1);expect(suggestData.rows[0]).toMatchObject({id,kind:'CLIENT_DOCUMENT',href:new URL(detail).pathname});expect(Object.keys(suggestData.rows[0]).sort()).toEqual(['href','id','kind','label']);expect(JSON.stringify(suggestData)).not.toContain(hash);expect(JSON.stringify(suggestData)).not.toContain(new URL(url).pathname);await searchField.press('ArrowDown');await searchField.press('Enter');await expect(page).toHaveURL(detail);expect(await financial()).toEqual(before);
  const copyCount=(await db.query('SELECT count(*)::int AS n FROM client_document WHERE company_id=$1',[companyId])).rows[0].n,originalProof=(await db.query('SELECT content_hash,signed_at,revision FROM client_document WHERE id=$1',[id])).rows[0];const copyHref=(await page.getByRole('link',{name:'Dupliquer en brouillon',exact:true}).getAttribute('href'))!;const copyResponse=await page.goto(copyHref);await expect(page.getByRole('heading',{name:'Nouveau contrat à partir d’une copie',exact:true})).toBeVisible();expect(await copyResponse!.text()).not.toContain(hash);expect((await db.query('SELECT count(*)::int AS n FROM client_document WHERE company_id=$1',[companyId])).rows[0].n).toBe(copyCount);await expect(page.getByLabel('Texte et conditions du contrat',{exact:true})).toHaveValue(body);await expect(page.getByLabel('Tarif horaire (CAD/h)',{exact:true})).toHaveValue('150.50');await page.getByLabel('Titre du document',{exact:true}).fill('Renouvellement CT98');await page.getByLabel('Nom du client',{exact:true}).fill('Camille Renouvellement');await page.getByLabel('Courriel du client',{exact:true}).fill('renouvellement98@example.test');await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('175.25');await expect(page.getByRole('region',{name:'Aperçu du document',exact:true})).toContainText('175,25 CAD/h');await expectNoPageOverflow(page);await captureReference(page,'contrats-copie',page.getByRole('heading',{name:'Nouveau contrat à partir d’une copie',exact:true}),false);await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page).toHaveURL(/\/contrats\/[0-9a-f-]{36}$/);const copiedId=new URL(page.url()).pathname.split('/').at(-1)!;expect(copiedId).not.toBe(id);expect((await db.query('SELECT status,content_hash,token_hash,signed_at,first_viewed_at FROM client_document WHERE id=$1',[copiedId])).rows[0]).toEqual({status:'DRAFT',content_hash:null,token_hash:null,signed_at:null,first_viewed_at:null});await expect(page.getByRole('link',{name:'Ouvrir le portail client',exact:true})).toHaveCount(0);expect((await db.query('SELECT content_hash,signed_at,revision FROM client_document WHERE id=$1',[id])).rows[0]).toEqual(originalProof);expect(await financial()).toEqual(before);await page.goto(base+'/nouveau?copier='+copiedId);await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue('Camille Renouvellement');await expect(page.getByLabel('Tarif horaire (CAD/h)',{exact:true})).toHaveValue('175.25');await page.goto(copyHref);await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue(customer);await expect(page.getByLabel('Tarif horaire (CAD/h)',{exact:true})).toHaveValue('150.50');await page.goto(detail);for(const query of ['copier=','copier=bad-id','copier='+id+'&copier='+id,'copier=00000000-0000-7000-8000-999999999999'])expect((await page.request.get(base+'/nouveau?'+query)).status()).toBe(404);
  await page.goto(base);await page.getByLabel('Rechercher un contrat ou client',{exact:true}).fill(title);await page.getByLabel('Type de document',{exact:true}).selectOption('CONTRACT');await page.getByLabel('Consultation et signature',{exact:true}).selectOption('SIGNED');await page.getByLabel('Disponibilité du lien',{exact:true}).selectOption('AVAILABLE');await page.getByRole('button',{name:'Rechercher',exact:true}).click();const tracked=page.getByRole('main').getByRole('listitem').filter({has:page.getByRole('link',{name:title,exact:true})});await expect(tracked).toHaveCount(1);await expect(tracked).toContainText('Lien accessible');await expect(tracked.locator('time')).toHaveCount(4);await expectNoPageOverflow(page);await captureReference(page,'contrats-suivi',page.getByLabel('Type de document',{exact:true}).locator('..'),false);await expect(page.getByRole('link',{name:'Exporter le suivi CSV',exact:true})).toBeVisible();const csvLink=(await page.getByRole('link',{name:'Exporter le suivi CSV',exact:true}).getAttribute('href'))!;const [csvDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Exporter le suivi CSV',exact:true}).click()]);const csvBytes=readFileSync((await csvDownload.path())!);expect(csvBytes.subarray(0,3).toString('hex')).toBe('efbbbf');const csvText=csvBytes.toString('utf8');expect(csvText).toContain('Référence Allumi;');expect(csvText).toContain(title);expect(csvText).toContain(id);expect(csvText).not.toContain(copiedId);expect(csvText).not.toContain('/document/');expect(csvText).not.toContain(hash);const csvResponse=await page.request.get(csvLink);expect(csvResponse.status()).toBe(200);expect(csvResponse.headers()['cache-control']).toContain('no-store');expect(csvResponse.headers()['content-type']).toContain('text/csv');for(const query of ['stage=SIGNED&stage=DRAFT','kind=OTHER','page='])expect((await page.request.get(base+'/export?'+query)).status()).toBe(400);await expectNoPageOverflow(page);await captureReference(page,'contrats-export',page.getByRole('link',{name:'Exporter le suivi CSV',exact:true}).locator('..'));expect(new URL(page.url()).searchParams.get('stage')).toBe('SIGNED');await page.goto(base+'?stage=SIGNED&stage=DRAFT');await expect(page.getByRole('main').getByRole('alert')).toContainText('Les filtres sont invalides');await page.goto(base+'?link=INVALID');await expect(page.getByRole('main').getByRole('alert')).toContainText('Les filtres sont invalides');await page.goto(detail);
  await client.getByRole('button',{name:'English',exact:true}).click();await expect(client.getByRole('combobox',{name:'Appearance',exact:true})).toBeVisible();await client.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');
  // The signed document keeps its publication language even when the visitor changes the surrounding shell.
  await expect(client.getByRole('heading',{name:'Preuve de signature enregistrée',exact:true})).toBeVisible();
  if(process.env.E2E_MOBILE!=='1'){await client.emulateMedia({media:'print'});const pdf=await client.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length).toBeGreaterThan(1);await client.emulateMedia({media:'screen'});}
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.getByRole('heading',{name:'Recorded signature evidence',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');const enEvidence=page.getByRole('region',{name:'Evidence package',exact:true});await expect(enEvidence).toContainText('Confidential copy');await expectNoPageOverflow(page);expect((await page.request.get(detail+'/preuve')).status()).toBe(200);await page.getByRole('link',{name:'Duplicate as draft',exact:true}).click();await expect(page.getByRole('heading',{name:'New contract from a copy',exact:true})).toBeVisible();await expect(page.getByLabel('Document language',{exact:true})).toHaveValue('fr-CA');await expect(page.getByLabel('Hourly rate (CAD/h)',{exact:true})).toHaveValue('150.50');await page.getByLabel('Document language',{exact:true}).selectOption('en');await page.getByLabel('Client name',{exact:true}).fill('Renewal Client');await page.getByLabel('Hourly rate (CAD/h)',{exact:true}).fill('199.95');await expect(page.getByRole('region',{name:'Document preview',exact:true})).toContainText('199.95 CAD/h');await expectNoPageOverflow(page);await captureReference(page,'contrats-copie-en-dark',page.getByRole('heading',{name:'New contract from a copy',exact:true}),false);expect((await db.query('SELECT count(*)::int AS n FROM client_document WHERE company_id=$1',[companyId])).rows[0].n).toBe(copyCount+1);await page.goto(base+'/'+copiedId);const cleanup=page.locator('details').filter({has:page.locator('summary',{hasText:'Delete draft'})});await cleanup.locator('summary').click();await cleanup.getByRole('button',{name:'Delete draft',exact:true}).click();expect((await db.query('SELECT count(*)::int AS n FROM client_document WHERE id=$1',[copiedId])).rows[0].n).toBe(1);await expectNoPageOverflow(page);await captureReference(page,'contrats-nettoyage-en-dark',cleanup,false,true);await cleanup.getByRole('checkbox').check();await cleanup.getByRole('button',{name:'Delete draft',exact:true}).click();await expect(page).toHaveURL(base);expect((await db.query('SELECT count(*)::int AS n FROM client_document WHERE id=$1',[copiedId])).rows[0].n).toBe(0);expect((await db.query('SELECT content_hash,signed_at,revision FROM client_document WHERE id=$1',[id])).rows[0]).toEqual(originalProof);const enCsv=await page.request.get(base+'/export?'+new URLSearchParams({q:title,kind:'CONTRACT',stage:'SIGNED',link:'AVAILABLE'}));expect(enCsv.status()).toBe(200);expect(await enCsv.text()).toContain('Allumi reference,Document title');await page.goto(detail);await expect(page.locator('summary',{hasText:'Delete draft'})).toHaveCount(0);if(process.env.ALLUMI_SCREENSHOTS==='1'&&(!process.env.ALLUMI_SCREENSHOT_PREFIX||process.env.ALLUMI_SCREENSHOT_PREFIX.split(',').some(p=>'contrats-signature-en-dark'.startsWith(p)))){mkdirSync('docs/images',{recursive:true});await page.getByRole('heading',{name:'Recorded signature evidence',exact:true}).locator('..').screenshot({path:`docs/images/contrats-signature-en-dark-${process.env.E2E_MOBILE==='1'?'mobile':'desktop'}.png`,scale:'css',animations:'disabled'});}await page.goto(base+'?'+new URLSearchParams({q:title,kind:'CONTRACT',stage:'SIGNED',link:'AVAILABLE'}));await expect(page.getByLabel('Viewing and signing',{exact:true})).toHaveValue('SIGNED');await expect(page.getByRole('main')).toContainText('Link available');await expectNoPageOverflow(page);await captureReference(page,'contrats-suivi-en-dark',page.getByLabel('Document type',{exact:true}).locator('..'),false);await page.goto(base+'/modele');await page.getByLabel('Hourly rate (CAD/h)',{exact:true}).fill('155.25');await expect(page.getByRole('region',{name:'Document preview',exact:true})).toContainText('155.25 CAD/h');await page.goto(base+'/nouveau');await page.getByLabel('Document title',{exact:true}).fill('Sample service agreement');await page.getByLabel('Client name',{exact:true}).fill('Example Client');await page.getByLabel('Client email',{exact:true}).fill(email);await page.getByLabel('Hourly rate (CAD/h)',{exact:true}).fill('150.50');await page.getByLabel('Contract text and terms',{exact:true}).fill('Agreement between {{company_name}} and {{client_name}}. Hourly rate: {{hourly_rate}}.\n\n'+('Service terms, responsibilities, confidentiality and agreed deadlines. '.repeat(90))+'\n\nThe applicable hourly rate remains {{hourly_rate}}.');await expect(page.getByRole('region',{name:'Document preview',exact:true})).toContainText('150.50 CAD/h');await captureReference(page,'contrats-editeur-en-dark',page.getByLabel('Hourly rate (CAD/h)',{exact:true}),false,true);await page.goto(detail);await expect(page.getByRole('heading',{name:'Recorded signature evidence',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.getByRole('heading',{name:'Preuve de signature enregistrée',exact:true})).toBeVisible();
  await db.query("UPDATE client_document SET expires_at=published_at+interval '1 microsecond',revision=revision+1 WHERE id=$1",[id]);await page.goto(base+'?'+new URLSearchParams({q:title,kind:'CONTRACT',stage:'SIGNED',link:'EXPIRED'}));await expect(page.getByRole('main')).toContainText('Signé électroniquement');await expect(page.getByRole('main')).toContainText('Lien expiré');await page.goto(detail);await expect(page.getByRole('link',{name:'Ouvrir le portail client',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Envoyer le lien par courriel',exact:true})).toHaveCount(0);
  const expiredEvidence=await page.request.get(detail+'/preuve');expect(expiredEvidence.status()).toBe(200);expect((await expiredEvidence.json()).publication.sha256).toBe(hash);
  const revoke=page.locator('details').filter({has:page.locator('summary',{hasText:'Révoquer le lien'})});await revoke.locator('summary').click();await revoke.getByRole('checkbox').check();await revoke.getByRole('button',{name:'Révoquer le lien',exact:true}).click();await expect(page.getByRole('main')).toContainText('Lien révoqué');expect((await client.request.get(url)).status()).toBe(404);expect((await db.query('SELECT signed_at FROM client_document WHERE id=$1',[id])).rows[0].signed_at).not.toBeNull();
  const urls=e2eUrls(),env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,LOG_LEVEL:'silent'};for(const key of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete env[key];const fixture=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-client-documents.ts',userId,companyId!],{encoding:'utf8',env,timeout:90_000})) as {estimate:string;invoice:string};
  const afterFixture=await financial();
  for(const [kind,source] of [['ESTIMATE',company+'/devis/'+fixture.estimate],['INVOICE',company+'/factures/validees/'+fixture.invoice]] as const){await page.goto(source);const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Contrats et liens clients',exact:true})}).last();await panel.locator('summary',{hasText:'Préparer un lien client'}).click();await panel.getByLabel('Courriel du client',{exact:true}).fill(email);await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Préparer un lien client',exact:true}).click();await expect(page).toHaveURL(/\/contrats\/[0-9a-f-]{36}$/);const form=page.locator('form').filter({has:page.getByRole('button',{name:'Publier le lien client',exact:true})});await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Publier le lien client',exact:true}).click();await expect(page.getByRole('link',{name:'Dupliquer en brouillon',exact:true})).toHaveCount(0);expect((await page.request.get(base+'/nouveau?copier='+new URL(page.url()).pathname.split('/').at(-1))).status()).toBe(404);const publicUrl=(await page.getByRole('link',{name:'Ouvrir le portail client',exact:true}).getAttribute('href'))!;await client.goto(publicUrl);await client.getByRole('button',{name:'Consulter le document',exact:true}).click();await expect(client.locator('article')).toContainText('Service de référence public');await expect(client.locator('article')).toContainText('CT96-REFERENCE');if(kind==='INVOICE')await expect(client.locator('article')).toContainText('Instruction publique pour la facture');await expect(client.locator('article')).not.toContainText('CLIENT-PORTAL-PRIVATE');if(kind==='INVOICE')await expect(client.getByRole('button',{name:'Signer le document',exact:true})).toHaveCount(0);else await expect(client.getByRole('button',{name:'Signer le document',exact:true})).toBeVisible();}
  expect(await financial()).toEqual(afterFixture);
  await page.goto(company+'/devis/'+fixture.estimate);const cancel=page.locator('details').filter({has:page.locator('summary',{hasText:'Annuler le devis'})});await cancel.locator('summary').click();await cancel.getByRole('checkbox').check();await cancel.getByRole('button',{name:'Annuler le devis',exact:true}).click();const blockedPanel=page.locator('section').filter({has:page.getByRole('heading',{name:'Contrats et liens clients',exact:true})}).last();await expect(blockedPanel).toContainText('Source indisponible');await blockedPanel.getByRole('link').first().click();await expect(page.getByRole('status')).toContainText('La source est annulée ou indisponible');await expect(page.getByRole('link',{name:'Ouvrir le portail client',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Envoyer le lien par courriel',exact:true})).toHaveCount(0);await expect(page.locator('summary',{hasText:'Révoquer le lien'})).toBeVisible();expect(await financial()).toEqual(afterFixture);
  const revokedEvidence=await page.request.get(detail+'/preuve');expect(revokedEvidence.status()).toBe(200);expect((await revokedEvidence.json()).events.revokedAt).not.toBeNull();await page.goto(detail);await expect(page.getByRole('link',{name:'Ouvrir le portail client',exact:true})).toHaveCount(0);await captureReference(page,'contrats-preuve',page.getByRole('region',{name:'Dossier de preuve',exact:true}),false,true);
  // Locale changes use a Server Action; wait for the committed language before route requests.
  await page.getByRole('button',{name:'English',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await captureReference(page,'contrats-preuve-en-dark',page.getByRole('region',{name:'Evidence package',exact:true}),false,true);
  await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Français',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
  await expect(page.getByRole('region',{name:'Dossier de preuve',exact:true})).toBeVisible();
  const restoreText=(await db.query('SELECT rendered_body FROM client_document WHERE id=$1',[id])).rows[0].rendered_body;const replaceEvidenceText=async(value:string)=>{await db.query('BEGIN');try{await db.query('ALTER TABLE client_document DISABLE TRIGGER client_document_guard');await db.query('UPDATE client_document SET rendered_body=$2 WHERE id=$1',[id,value]);await db.query('ALTER TABLE client_document ENABLE TRIGGER client_document_guard');await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}};try{await replaceEvidenceText('Corruption fixture 100');const refused=await page.request.get(detail+'/preuve');expect(refused.status()).toBe(409);expect(refused.headers()['content-disposition']).toBeUndefined();expect(await refused.text()).toContain('ne correspond pas à son empreinte');const refusedCopy=await page.request.get(detail+'/copie');expect(refusedCopy.status()).toBe(409);expect(refusedCopy.headers()['content-disposition']).toBeUndefined();}finally{await replaceEvidenceText(restoreText);}
  const seedExport=async(from:number,to:number)=>{await db.query('BEGIN');try{await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);await db.query("INSERT INTO client_document(id,company_id,kind,title,customer_name,customer_email,issuer_name,locale,body,created_by_id,updated_at) SELECT gen_random_uuid(),$1,'CONTRACT','EXPORT99 fixture '||n::text,'=Client CSV','fixture99@example.test','Atelier Exemple inc.','fr-CA','PRIVATE-EXPORT-TERMS',$2,now() FROM generate_series($3::int,$4::int) n",[companyId,userId,from,to]);await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}};await seedExport(1,5000);const boundaryQuery=new URLSearchParams({q:'EXPORT99 fixture',kind:'CONTRACT',stage:'DRAFT',link:'DRAFT',page:'2'}),boundary=await page.request.get(base+'/export?'+boundaryQuery);expect(boundary.status()).toBe(200);const completeCsv=await boundary.text();expect(completeCsv.trimEnd().split('\r\n')).toHaveLength(5001);expect(completeCsv).toContain("'=Client CSV");expect(completeCsv).not.toContain('PRIVATE-EXPORT-TERMS');expect(completeCsv).not.toContain('fixture99@example.test');await seedExport(5001,5001);const tooMany=await page.request.get(base+'/export?'+boundaryQuery);expect(tooMany.status()).toBe(422);expect(tooMany.headers()['content-type']).toContain('text/plain');expect(tooMany.headers()['content-disposition']).toBeUndefined();expect(await tooMany.text()).toContain('5 000');expect(await financial()).toEqual(afterFixture);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'contracts-'||gen_random_uuid()::text||'@example.test','Backup fixture owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"sales\":\"write\",\"accounting\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(detail);await expect(page.getByRole('link',{name:'Ouvrir le portail client',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Envoyer le lien par courriel',exact:true})).toHaveCount(0);await expect(page.locator('summary',{hasText:'Supprimer le brouillon'})).toHaveCount(0);await page.goto(globalUrl);await expect(globalResults.getByRole('link',{name:title,exact:true})).toBeVisible();expect((await (await page.request.get(company+'/recherche/suggestions?'+new URLSearchParams({q:title}))).json()).rows[0].kind).toBe('CLIENT_DOCUMENT');await page.goto(detail);expect((await page.request.get(detail+'/preuve')).status()).toBe(200);expect((await page.request.get(detail+'/copie')).status()).toBe(200);expect((await page.request.get(base+'/export?'+new URLSearchParams({q:title}))).status()).toBe(200);const readerDraft=(await db.query("SELECT id FROM client_document WHERE company_id=$1 AND title LIKE 'EXPORT99 fixture %' LIMIT 1",[companyId])).rows[0].id;await page.goto(base+'/'+readerDraft);await expect(page.locator('summary',{hasText:'Supprimer le brouillon'})).toHaveCount(0);await page.goto(detail);expect((await page.request.get(base+'/nouveau')).status()).toBe(404);await expect(page.getByRole('link',{name:'Dupliquer en brouillon',exact:true})).toHaveCount(0);expect((await page.request.get(base+'/nouveau?copier='+id)).status()).toBe(404);await db.query("UPDATE membership SET module_access='{\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);for(const path of [base,detail,base+'/modele',base+'/export',detail+'/preuve',detail+'/copie'])expect((await page.request.get(path)).status()).toBe(404);await page.goto(globalUrl);await expect(globalResults.getByRole('link')).toHaveCount(0);expect((await (await page.request.get(company+'/recherche/suggestions?'+new URLSearchParams({q:title}))).json()).rows).toEqual([]);expect(cspViolations).toEqual([]);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();await guest.close();}
});

test("existing client selection in contracts preserves review, permissions and manual entry",async({page})=>{
 test.setTimeout(240_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies) await page.context().addCookies(updateCookies); await page.goto('/');
 if(!updateCookies) {
  await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789'); await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel("Premier mois de l'exercice financier").selectOption('4'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL); await page.getByLabel("Langue de l'interface").selectOption('fr-CA'); await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD); await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 }
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2];
 const db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 const base=company+'/contrats',name='Client Répertoire 101',email='directory101@example.test',terms='Contrat de {{company_name}} pour {{client_name}}. Tarif {{hourly_rate}} puis {{hourly_rate}}.';
 try {
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  await db.query('BEGIN');try{await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_id',$2,true)",[userId,companyId]);await db.query("INSERT INTO contact(id,company_id,display_name,email,is_customer,is_supplier,locale,notes,updated_at) VALUES(gen_random_uuid(),$1,$2,$3,true,false,'en','PRIVATE-LOOKUP-NOTE-101',now()),(gen_random_uuid(),$1,'Client sans courriel 101',NULL,true,true,'fr-CA',NULL,now())",[companyId,name,email]);await db.query("INSERT INTO contact(id,company_id,display_name,is_customer,is_supplier,updated_at) SELECT gen_random_uuid(),$1,'BoundaryUI101 '||lpad(n::text,2,'0'),true,false,now() FROM generate_series(1,21) n",[companyId]);await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}
  const financial=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM journal_line WHERE company_id=$1)::text AS lines',[companyId])).rows,before=await financial();const count=async()=>(await db.query('SELECT count(*)::int AS n FROM client_document WHERE company_id=$1',[companyId])).rows[0].n,startCount=await count();
  await page.goto(base+'/modele');await expect(page.getByRole('group',{name:'Choisir un client existant',exact:true})).toHaveCount(0);
  await page.goto(base+'/nouveau');const chooser=page.getByRole('group',{name:'Choisir un client existant',exact:true});await expect(chooser).toBeVisible();await page.getByLabel('Titre du document',{exact:true}).fill('Contrat répertoire 101');await page.getByLabel('Nom du client',{exact:true}).fill('Client provisoire');await page.getByLabel('Courriel du client',{exact:true}).fill('provisional101@example.test');await page.getByLabel('Texte et conditions du contrat',{exact:true}).fill(terms);await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('125.99');
  const query=page.getByLabel('Nom ou courriel à rechercher',{exact:true});await query.fill('x');await query.press('Enter');await expect(chooser.getByRole('status')).toContainText('entre 2 et 100');expect(await count()).toBe(startCount);await query.fill('Répertoire 101');await query.press('Enter');const use=chooser.getByRole('button',{name:'Utiliser '+name});await expect(use).toBeVisible();await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue('Client provisoire');expect(await count()).toBe(startCount);await expectNoPageOverflow(page);await captureReference(page,'contrats-client',chooser,false,true);await use.click();await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue(name);await expect(page.getByLabel('Courriel du client',{exact:true})).toHaveValue(email);await expect(page.getByLabel('Langue du document',{exact:true})).toHaveValue('fr-CA');await expect(page.getByRole('region',{name:'Aperçu du document',exact:true})).toContainText(name);await expect(page.getByLabel('Texte et conditions du contrat',{exact:true})).toHaveValue(terms);
  const response=await page.request.get(base+'/clients?'+new URLSearchParams({q:'Répertoire 101'}));expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('private, no-store');expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin');const dto=await response.json();expect(dto.rows).toHaveLength(1);expect(Object.keys(dto.rows[0]).sort()).toEqual(['displayName','email','id']);expect(JSON.stringify(dto)).not.toContain('PRIVATE-LOOKUP-NOTE');for(const suffix of ['', '?q=x','?q=ab&q=cd','?q=ab&extra=1','?q=%0Aab'])expect((await page.request.get(base+'/clients'+suffix)).status()).toBe(400);expect((await page.request.get(base+'/clients?q=BoundaryUI101')).status()).toBe(200);
  await query.fill('BoundaryUI101');await chooser.getByRole('button',{name:'Rechercher un client',exact:true}).click();await expect(chooser.getByRole('status')).toContainText('Plus de 20');await expect(chooser.getByRole('list').getByRole('button')).toHaveCount(20);
  await page.route('**/contrats/clients?*',route=>route.abort());await query.fill('Network101');await chooser.getByRole('button',{name:'Rechercher un client',exact:true}).click();await expect(chooser.getByRole('status')).toContainText('Recherche indisponible');await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue(name);await page.unroute('**/contrats/clients?*');
  let slowSeen=false;await page.route('**/contrats/clients?*',async route=>{slowSeen=true;await new Promise(resolve=>setTimeout(resolve,400));await route.fulfill({json:{rows:[{id:'00000000-0000-7000-8000-999999999999',displayName:'Stale customer 101',email:null}],hasMore:false}}).catch(()=>{});});await query.fill('Slow101');await chooser.getByRole('button',{name:'Rechercher un client',exact:true}).click();await expect.poll(()=>slowSeen).toBe(true);await query.fill('Different101');await page.waitForTimeout(450);await expect(chooser.getByRole('list')).toHaveCount(0);await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue(name);await page.unroute('**/contrats/clients?*');
  await page.getByLabel('Courriel du client',{exact:true}).fill('reviewed101@example.test');await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('125.999');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('Tarif invalide');await expect(page.getByLabel('Nom du client',{exact:true})).toHaveValue(name);await expect(page.getByLabel('Courriel du client',{exact:true})).toHaveValue('reviewed101@example.test');await expect(page.getByLabel('Texte et conditions du contrat',{exact:true})).toHaveValue(terms);await page.getByLabel('Tarif horaire (CAD/h)',{exact:true}).fill('125.99');await query.fill('sans courriel 101');await chooser.getByRole('button',{name:'Rechercher un client',exact:true}).click();await expect(chooser).toContainText('Aucun courriel');await chooser.getByRole('button',{name:'Utiliser Client sans courriel 101'}).click();await expect(page.getByLabel('Courriel du client',{exact:true})).toHaveValue('');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();expect(await count()).toBe(startCount);await page.getByLabel('Courriel du client',{exact:true}).fill('manual101@example.test');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page).toHaveURL(new RegExp('/contrats/[0-9a-f-]{36}$'));const detail=page.url(),id=new URL(detail).pathname.split('/').at(-1)!;expect(await count()).toBe(startCount+1);expect((await db.query('SELECT customer_name,customer_email,body FROM client_document WHERE id=$1',[id])).rows[0]).toEqual({customer_name:'Client sans courriel 101',customer_email:'manual101@example.test',body:terms});expect((await db.query('SELECT email FROM contact WHERE company_id=$1 AND display_name=$2',[companyId,name])).rows[0].email).toBe(email);
  await page.goto(base+'/nouveau?copier='+id);await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await page.getByLabel('Document language',{exact:true}).selectOption('en');const enChooser=page.getByRole('group',{name:'Choose an existing client',exact:true});await page.getByLabel('Name or email to search',{exact:true}).fill('Répertoire 101');await enChooser.getByRole('button',{name:'Find a client',exact:true}).click();await expect(enChooser.getByRole('button',{name:'Use '+name})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'contrats-client-en-dark',enChooser,false,true);await enChooser.getByRole('button',{name:'Use '+name}).click();await expect(page.getByLabel('Document language',{exact:true})).toHaveValue('en');await expect(page.getByRole('region',{name:'Document preview',exact:true})).toContainText('125.99 CAD/h');expect(await count()).toBe(startCount+1);await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
  await page.goto(detail+'/modifier');await expect(chooser).toBeVisible();await query.fill('Répertoire 101');await chooser.getByRole('button',{name:'Rechercher un client',exact:true}).click();await chooser.getByRole('button',{name:'Utiliser '+name}).click();await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page).toHaveURL(detail);expect((await db.query('SELECT customer_name,customer_email FROM client_document WHERE id=$1',[id])).rows[0]).toEqual({customer_name:name,customer_email:email});expect(await financial()).toEqual(before);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'lookup-'||gen_random_uuid()::text||'@example.test','Backup lookup owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);
  await db.query("UPDATE membership SET role='USER',module_access='{\"sales\":\"write\",\"contacts\":\"none\",\"accounting\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(base+'/nouveau');await expect(chooser).toHaveCount(0);await expect(page.getByLabel('Nom du client',{exact:true})).toBeVisible();expect((await page.request.get(base+'/clients?q=Répertoire')).status()).toBe(404);
  await db.query("UPDATE membership SET module_access='{\"sales\":\"write\",\"contacts\":\"read\",\"accounting\":\"none\",\"taxes\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.reload();await expect(chooser).toBeVisible();expect((await page.request.get(base+'/clients?q=Répertoire')).status()).toBe(200);await db.query("UPDATE membership SET role='READ_ONLY' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);for(const path of [base+'/nouveau',base+'/clients?q=Répertoire'])expect((await page.request.get(path)).status()).toBe(404);expect(await financial()).toEqual(before);expect(cspViolations).toEqual([]);
 } finally {if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();}
});

/** Downloaded copies must remain readable and inert without a session, server or network. */
test("client document printable downloads preserve verified Unicode content offline without executable markup",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);}
 // Exercise the company chooser in isolated runs too, then await the client-side transition before reading its URL.
 const chooserDb=new pg.Client({connectionString:e2eUrls().owner});await chooserDb.connect();try{const user=(await chooserDb.query('SELECT id FROM app_user WHERE email=$1',[EMAIL])).rows[0].id,extra=(await chooserDb.query("INSERT INTO company(id,name,updated_at) VALUES(gen_random_uuid(),'Archive de démonstration 105',now()) RETURNING id")).rows[0].id;await chooserDb.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[extra,user]);}finally{await chooserDb.end();}
 await page.goto('/');await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2],db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();
 const offline=watchCsp(await browser.newContext({offline:true,viewport:page.viewportSize()??undefined,isMobile:process.env.E2E_MOBILE==='1',hasTouch:process.env.E2E_MOBILE==='1'})),saved=await offline.newPage();const network:string[]=[];offline.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 const guest=await browser.newContext(),client=await guest.newPage();
 const body='\n\nConditions «été» — 日本語 🪷 & confidentialité.\n\nTexte littéral : </pre><img src="https://example.test/tracker105"><script>globalThis.COPY105_INJECTED=1</script>\n\n'+('Les engagements convenus demeurent applicables. Chaque partie conserve une copie de ces conditions.\n\n'.repeat(100))+'Fin des conditions.';
 try{
  for(const locale of ['fr-CA','en'] as const){
   await page.goto(company+'/contrats/nouveau');await page.getByLabel('Titre du document',{exact:true}).fill('Copie autonome 105 '+locale);await page.getByLabel('Nom du client',{exact:true}).fill('Camille Copie');await page.getByLabel('Courriel du client',{exact:true}).fill('copy105@example.test');await page.getByLabel('Langue du document',{exact:true}).selectOption(locale);await page.getByLabel('Texte et conditions du contrat',{exact:true}).fill(body);await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page).toHaveURL(/\/contrats\/[0-9a-f-]{36}$/);const detail=page.url(),id=new URL(detail).pathname.split('/').at(-1)!;
   expect((await page.request.get(detail+'/copie')).status()).toBe(404);await expect(page.getByRole('link',{name:'Télécharger la copie imprimable (HTML)',exact:true})).toHaveCount(0);
   const publish=page.locator('form').filter({has:page.getByRole('button',{name:'Publier le lien client',exact:true})});await publish.getByRole('checkbox').check();await publish.getByRole('button',{name:'Publier le lien client',exact:true}).click();const link=page.getByRole('link',{name:'Ouvrir le portail client',exact:true});await expect(link).toBeVisible();const publicUrl=(await link.getAttribute('href'))!;
   const before=(await db.query('SELECT (SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audit,(SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries',[companyId])).rows;
   const response=await page.request.get(detail+'/copie');expect(response.status()).toBe(200);expect(response.headers()['content-type']).toBe('text/html; charset=utf-8');expect(response.headers()['cache-control']).toBe('private, no-store');expect(response.headers()['vary']).toContain('Cookie');expect(response.headers()['x-content-type-options']).toBe('nosniff');expect(response.headers()['referrer-policy']).toBe('no-referrer');expect(response.headers()['x-robots-tag']).toContain('noindex');expect(await response.text()).not.toContain(new URL(publicUrl).pathname);
   expect((await db.query('SELECT first_viewed_at FROM client_document WHERE id=$1',[id])).rows[0].first_viewed_at).toBeNull();expect((await db.query('SELECT (SELECT count(*) FROM audit_log WHERE company_id=$1)::text AS audit,(SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries',[companyId])).rows).toEqual(before);
   const anonymous=await client.request.get(detail+'/copie',{maxRedirects:0});expect(anonymous.status()).toBe(307);expect(anonymous.headers()['referrer-policy']).toBe('no-referrer');expect(anonymous.headers()['cache-control']).toBe('private, no-store');
   if(locale==='fr-CA'){await client.goto(publicUrl);await client.getByRole('button',{name:'Consulter le document',exact:true}).click();await client.getByLabel('Ton nom complet',{exact:true}).fill('Camille Copie');await client.getByLabel('Confirme ton courriel',{exact:true}).fill('copy105@example.test');await client.getByRole('checkbox').check();await client.getByRole('button',{name:'Signer le document',exact:true}).click();await expect(client.getByRole('status')).toContainText('Signature enregistrée');await page.reload();}
   const revoke=page.locator('details').filter({has:page.locator('summary',{hasText:'Révoquer le lien'})});await revoke.locator('summary').click();await revoke.getByRole('checkbox').check();await revoke.getByRole('button',{name:'Révoquer le lien',exact:true}).click();await expect(page.getByRole('main')).toContainText('Lien révoqué');await expect(page.getByRole('link',{name:'Ouvrir le portail client',exact:true})).toHaveCount(0);
   const evidence=page.getByRole('region',{name:'Dossier de preuve',exact:true});
   if(locale==='fr-CA'){await expectNoPageOverflow(page);await captureReference(page,'copie-imprimable-contrats',evidence,false,true);}
   const [download]=await Promise.all([page.waitForEvent('download'),evidence.getByRole('link',{name:'Télécharger la copie imprimable (HTML)',exact:true}).click()]);expect(download.suggestedFilename()).toBe('allumi-document-'+id+'.html');const file=(await download.path())!,html=readFileSync(file,'utf8');expect(html).not.toContain(new URL(publicUrl).pathname);expect(html).not.toContain('canonicalPayload');
   const record=(await db.query('SELECT rendered_body,content_hash FROM client_document WHERE id=$1',[id])).rows[0];await saved.setContent(html);await expect(saved.locator('html')).toHaveAttribute('lang',locale);expect(await saved.locator('main>.document-text').textContent()).toBe(record.rendered_body);await expect(saved.locator('.hash')).toHaveText(record.content_hash);await expect(saved.locator('script,img,a,form,iframe,object,link')).toHaveCount(0);expect(await saved.evaluate('globalThis.COPY105_INJECTED')).toBeUndefined();await expectNoPageOverflow(saved);expect(network).toEqual([]);
   await expect(saved.getByRole('heading',{name:locale==='en'?'No recorded signature':'Signature déclarée',exact:true})).toBeVisible();if(locale==='fr-CA')await expect(saved.locator('.proof')).toContainText('Camille Copie');
   await saved.emulateMedia({media:'print'});await expect(saved.locator('.instructions')).toBeHidden();await expect(saved.locator('main>.document-text')).toBeVisible();if(process.env.E2E_MOBILE!=='1'){const pdf=await saved.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length).toBeGreaterThan(1);}await saved.emulateMedia({media:'screen'});
   if(locale==='en'){await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.getByRole('link',{name:'Download printable copy (HTML)',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'copie-imprimable-contrats-en-dark',page.getByRole('region',{name:'Evidence package',exact:true}),false,true);await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');}
   await download.delete();
  }
  expect(cspViolations).toEqual([]);
 }finally{await db.end();await guest.close();await offline.close();}
});

/** Staff approval is distinct from a public signature and creates neither an invoice nor a posting. */
test("signed estimate review confirms acceptance once with modular permissions and unchanged evidence",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());
 if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);}
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2],db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';const secondary=watchCsp(await browser.newContext());await secondary.addCookies(await page.context().cookies());const stale=await secondary.newPage();
 try{
  const member=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=member.user_id;role=member.role;access=member.module_access;
  const urls=e2eUrls(),env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,APP_URL:`http://127.0.0.1:${process.env.E2E_PORT??3100}`,AUTH_SECRET:process.env.AUTH_SECRET??'e2e-only-secret-e2e-only-secret-e2e-only',ENCRYPTION_KEY:process.env.ENCRYPTION_KEY??Buffer.alloc(32,7).toString('base64'),LOG_LEVEL:'silent'};const fixture=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-signed-estimates.ts',userId,companyId!],{encoding:'utf8',env,timeout:90_000})) as Record<'primary'|'modular'|'unsigned',{estimate:string;document:string}>;
  const detail=(id:string)=>company+'/contrats/'+id,review=(id:string)=>detail(id)+'/accepter-soumission',state=async(id:string)=>(await db.query('SELECT status::text FROM sales_estimate WHERE id=$1',[id])).rows[0].status;
  const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry WHERE company_id=$1)::text AS entries,(SELECT count(*) FROM sales_document WHERE company_id=$1)::text AS invoices,(SELECT count(*) FROM payment WHERE company_id=$1)::text AS payments,(SELECT count(*) FROM client_document_delivery WHERE company_id=$1)::text AS deliveries',[companyId])).rows;
  const before=await counts(),originalProof=(await db.query('SELECT content_hash,signed_at,signer_name,signer_email,consent_text,revision FROM client_document WHERE id=$1',[fixture.primary.document])).rows[0];expect(await state(fixture.primary.estimate)).toBe('SENT');expect(originalProof.signed_at).not.toBeNull();
  await page.goto(detail(fixture.primary.document));const publicPath=new URL((await page.getByRole('link',{name:'Ouvrir le portail client',exact:true}).getAttribute('href'))!).pathname;await page.getByRole('link',{name:'Revoir et accepter la soumission signée',exact:true}).click();await expect(page).toHaveURL(review(fixture.primary.document));
  const response=await page.reload(),html=(await response!.text());expect(html).not.toContain(publicPath);expect(html).not.toContain('PRIVATE-REVIEW-');expect(html).not.toContain('canonicalPayload');await expect(page.getByRole('heading',{name:'Revoir et accepter la soumission signée',exact:true})).toBeVisible();await expect(page.locator('article')).toContainText('Camille Revue');await expect(page.locator('article')).toContainText(originalProof.content_hash);
  const approve=page.getByRole('region',{name:'Accepter la soumission source',exact:true});let posts=0;const countPost=(r:{method:()=>string;url:()=>string})=>{if(r.method()==='POST'&&new URL(r.url()).pathname===review(fixture.primary.document))posts++;};page.on('request',countPost);await approve.getByRole('button',{name:'Accepter la soumission source',exact:true}).click();expect(posts).toBe(0);page.off('request',countPost);expect(await state(fixture.primary.estimate)).toBe('SENT');await approve.getByLabel('Note interne sur la réponse',{exact:true}).fill('Accord revu après signature');await expectNoPageOverflow(page);await captureReference(page,'revue-soumission-signee',approve,false,true);
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');const enApproval=page.getByRole('region',{name:'Accept source estimate',exact:true});await expect(enApproval.getByRole('button',{name:'Accept source estimate',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'revue-soumission-signee-en-dark',enApproval,false,true);await page.emulateMedia({media:'print'});await expect(enApproval).toBeHidden();await expect(page.locator('article')).toBeVisible();await page.emulateMedia({media:'screen'});await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
  await stale.goto(review(fixture.primary.document));await stale.getByLabel('Note interne sur la réponse',{exact:true}).fill('Ancienne revue conservée');await stale.locator('input[name="confirm"]').check();await approve.getByLabel('Note interne sur la réponse',{exact:true}).fill('Accord revu après signature');await approve.locator('input[name="confirm"]').check();await approve.getByRole('button',{name:'Accepter la soumission source',exact:true}).click();await expect(page).toHaveURL(company+'/devis/'+fixture.primary.estimate);await expect(page.getByText('Accepté',{exact:true})).toBeVisible();await expect(page.getByRole('main')).toContainText('Accord revu après signature');expect(await counts()).toEqual(before);
  await stale.getByRole('button',{name:'Accepter la soumission source',exact:true}).click();await expect(stale.locator('form').getByRole('alert')).toContainText('Ce devis a changé');await expect(stale.getByLabel('Note interne sur la réponse',{exact:true})).toHaveValue('Ancienne revue conservée');const events=(await db.query("SELECT after FROM audit_log WHERE entity_id=$1 AND action='estimate.accept_signed_document'",[fixture.primary.estimate])).rows;expect(events).toHaveLength(1);expect(events[0].after).toEqual({clientDocumentId:fixture.primary.document,publicationHash:originalProof.content_hash});expect((await db.query('SELECT content_hash,signed_at,signer_name,signer_email,consent_text,revision FROM client_document WHERE id=$1',[fixture.primary.document])).rows[0]).toEqual(originalProof);
  await page.goto(review(fixture.primary.document));await expect(page.getByRole('region',{name:'Accepter la soumission source',exact:true}).getByRole('status')).toContainText('n’est plus une soumission envoyée encore valide');await expect(page.getByRole('button',{name:'Accepter la soumission source',exact:true})).toHaveCount(0);expect((await page.request.get(review(fixture.unsigned.document))).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/contrats/'+fixture.primary.document+'/accepter-soumission')).status()).toBe(404);
  const originalSnapshot=(await db.query('SELECT source_snapshot FROM client_document WHERE id=$1',[fixture.primary.document])).rows[0].source_snapshot,replace=async(value:unknown)=>{await db.query('BEGIN');try{await db.query('ALTER TABLE client_document DISABLE TRIGGER client_document_guard');await db.query('UPDATE client_document SET source_snapshot=$2::jsonb WHERE id=$1',[fixture.primary.document,JSON.stringify(value)]);await db.query('ALTER TABLE client_document ENABLE TRIGGER client_document_guard');await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}};try{await replace({...originalSnapshot,terms:'CORRUPTED-REVIEW-107'});await page.goto(review(fixture.primary.document));await expect(page.getByRole('main').getByRole('alert')).toContainText('ne correspond pas à son empreinte');await expect(page.locator('article')).toHaveCount(0);await expect(page.getByRole('button',{name:'Accepter la soumission source',exact:true})).toHaveCount(0);}finally{await replace(originalSnapshot);}
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'review-'||gen_random_uuid()::text||'@example.test','Backup review owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);await stale.goto(review(fixture.modular.document));await stale.getByLabel('Note interne sur la réponse',{exact:true}).fill('Revue non autorisée');await stale.locator('input[name="confirm"]').check();await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"sales\":\"write\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await stale.getByRole('button',{name:'Accepter la soumission source',exact:true}).click();await expect(stale.locator('form').getByRole('alert')).toContainText("Tu n'as pas les droits");expect(await state(fixture.modular.estimate)).toBe('SENT');expect((await page.request.get(review(fixture.modular.document))).status()).toBe(404);await page.goto(detail(fixture.modular.document));await expect(page.getByRole('link',{name:'Revoir et accepter la soumission signée',exact:true})).toHaveCount(0);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"sales\":\"write\",\"contacts\":\"none\",\"accounting\":\"none\",\"taxes\":\"none\",\"catalog\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(review(fixture.modular.document));await page.getByLabel('Note interne sur la réponse',{exact:true}).fill('Accord sous permissions Ventes');await page.locator('input[name="confirm"]').check();await page.getByRole('button',{name:'Accepter la soumission source',exact:true}).click();await expect(page).toHaveURL(company+'/devis/'+fixture.modular.estimate);expect(await state(fixture.modular.estimate)).toBe('ACCEPTED');await expect(page.locator('summary',{hasText:'Créer la facture brouillon'})).toHaveCount(0);await db.query("UPDATE membership SET module_access='{\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(review(fixture.modular.document))).status()).toBe(404);expect(await counts()).toEqual(before);expect(cspViolations).toEqual([]);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();await secondary.close();}
});

test("clients download verified signed copies through live links without business mutations",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);}
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 const companyId=new URL(page.url()).pathname.split('/')[2],db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();const guest=watchCsp(await browser.newContext({...devices[process.env.E2E_MOBILE==='1'?'Pixel 7':'Desktop Chrome'],viewport:page.viewportSize()??undefined})),client=await guest.newPage();
 try{
  // Isolate this quota scenario in the disposable database from earlier journeys.
  await db.query("DELETE FROM rate_limit WHERE key LIKE 'document-read:ip:%'");
  const userId=(await db.query('SELECT id FROM app_user WHERE email=$1',[EMAIL])).rows[0].id,urls=e2eUrls(),env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,APP_URL:`http://127.0.0.1:${process.env.E2E_PORT??3100}`,AUTH_SECRET:process.env.AUTH_SECRET??'e2e-only-secret-e2e-only-secret-e2e-only',ENCRYPTION_KEY:process.env.ENCRYPTION_KEY??Buffer.alloc(32,7).toString('base64'),LOG_LEVEL:'silent'};
  const f=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-public-signed-copy.ts',userId,companyId!],{encoding:'utf8',env,timeout:90_000})) as Record<'fr'|'en'|'unsigned',{id:string;url:string}>;
  const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments,(SELECT count(*) FROM client_document_delivery)::text AS deliveries')).rows;
  const proof=async(id:string)=>(await db.query('SELECT revision,updated_at,content_hash,first_viewed_at,signed_at,signer_name,signer_email,consent_text FROM client_document WHERE id=$1',[id])).rows;
  const download=async(url:string,id:string)=>{const before=await counts(),original=await proof(id),r=await guest.request.get(url+'/copie');expect(r.status()).toBe(200);expect(r.headers()['cache-control']).toBe('private, no-store');expect(r.headers()['referrer-policy']).toBe('no-referrer');expect(r.headers()['x-content-type-options']).toBe('nosniff');expect(r.headers()['content-security-policy']).toContain("default-src 'none'");expect(r.headers()['content-type']).toContain('text/html; charset=utf-8');expect(r.headers()['content-disposition']).toBe(`attachment; filename="allumi-document-${id}.html"`);const html=await r.text();expect(html).toContain('Camille Copie');expect(html).toContain(original[0].content_hash);expect(html).not.toContain(new URL(url).pathname);expect(html).not.toContain('canonicalPayload');expect(html).not.toContain('<script');expect(await counts()).toEqual(before);expect(await proof(id)).toEqual(original);return html;};
  const unavailable=await guest.request.get(f.fr.url+'/copie');expect(unavailable.status()).toBe(404);expect(await unavailable.text()).toBe('Document indisponible / Document unavailable.');expect((await proof(f.fr.id))[0].first_viewed_at).toBeNull();await client.goto(f.fr.url);await expect(client.getByRole('link',{name:'Télécharger la copie signée',exact:true})).toHaveCount(0);await client.getByRole('button',{name:'Consulter le document',exact:true}).click();await expect(client.locator('article')).toContainText('125,99 CAD/h');await expect(client.getByRole('link',{name:'Télécharger la copie signée',exact:true})).toHaveCount(0);await client.getByLabel('Ton nom complet',{exact:true}).fill('Camille Copie');await client.getByLabel('Confirme ton courriel',{exact:true}).fill('copy108@example.test');await client.locator('input[name="consent"]').check();await client.getByRole('button',{name:'Signer le document',exact:true}).click();const frLink=client.getByRole('link',{name:'Télécharger la copie signée',exact:true});await expect(frLink).toBeVisible();await expectNoPageOverflow(client);await captureReference(client,'copie-client-signee',frLink,false,true);
  const frHtml=await download(f.fr.url,f.fr.id);expect(frHtml).toContain('<html lang="fr-CA">');const saved=client.waitForEvent('download');await frLink.click();const file=await saved;expect(file.suggestedFilename()).toBe(`allumi-document-${f.fr.id}.html`);const path=await file.path();expect(path).not.toBeNull();expect(readFileSync(path!,'utf8')).toContain('Camille Copie');await client.emulateMedia({media:'print'});await expect(frLink).toBeHidden();await expect(client.locator('article')).toBeVisible();await client.emulateMedia({media:'screen'});
  await client.getByRole('button',{name:'English',exact:true}).click();await expect(client.locator('html')).toHaveAttribute('lang','en');await client.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(client.locator('html')).toHaveAttribute('data-theme','dark');await client.goto(f.en.url);await client.getByRole('button',{name:'View document',exact:true}).click();const enLink=client.getByRole('link',{name:'Download signed copy',exact:true});await expect(enLink).toBeVisible();await expectNoPageOverflow(client);await captureReference(client,'copie-client-signee-en-dark',enLink,false,true);expect(await download(f.en.url,f.en.id)).toContain('<html lang="en">');
  // The downloaded bytes remain useful with every network request blocked.
  const offline=await browser.newContext({...devices[process.env.E2E_MOBILE==='1'?'Pixel 7':'Desktop Chrome'],viewport:page.viewportSize()??undefined});try{await offline.route('**/*',r=>r.abort());const local=await offline.newPage();await local.setContent(frHtml);await expect(local.locator('html')).toHaveAttribute('lang','fr-CA');await expect(local.locator('body')).toContainText('Camille Copie');await expect(local.locator('script,a,form')).toHaveCount(0);await expect(local.locator('body')).toHaveCSS('padding-top','24px');await expectNoPageOverflow(local);}finally{await offline.close();}
  const before=await counts(),original=await proof(f.en.id);await db.query("UPDATE rate_limit SET count=120,window_start=now() WHERE key LIKE 'document-read:ip:%'");const limited=await guest.request.get(f.en.url+'/copie');expect(limited.status()).toBe(429);expect(limited.headers()['retry-after']).toBe('900');expect(limited.headers()['cache-control']).toBe('private, no-store');expect(await counts()).toEqual(before);expect(await proof(f.en.id)).toEqual(original);await db.query("DELETE FROM rate_limit WHERE key LIKE 'document-read:ip:%'");
  await db.query('UPDATE client_document SET revoked_at=now(),revision=revision+1 WHERE id=$1',[f.fr.id]);expect((await guest.request.get(f.fr.url+'/copie')).status()).toBe(404);await db.query("UPDATE client_document SET expires_at=published_at+interval '1 microsecond',revision=revision+1 WHERE id=$1",[f.en.id]);expect((await guest.request.get(f.en.url+'/copie')).status()).toBe(404);expect((await guest.request.get(f.unsigned.url+'/copie')).status()).toBe(404);expect((await guest.request.get('/document/'+'_'.repeat(43)+'/copie')).status()).toBe(404);expect((await guest.request.get('/document/bad/copie')).status()).toBe(404);expect(cspViolations).toEqual([]);
 }finally{await db.query("DELETE FROM rate_limit WHERE key LIKE 'document-read:ip:%'");await db.end();await guest.close();}
});

test("shared time log preserves exact billable minutes, full CSV and modular permissions",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);}
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2],base=company+'/temps',db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments')).rows;
 try{
  const m=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=m.user_id;role=m.role;access=m.module_access;const before=await counts();
  await page.goto(company+'/espace/projets');await page.getByRole('main').getByText('Carnet de temps→',{exact:true}).click();await page.getByRole('link',{name:'Nouvelle saisie de temps',exact:true}).click();await page.getByLabel('Date du travail',{exact:true}).fill('2026-06-15');await page.getByLabel('Projet ou dossier',{exact:true}).fill('DOS109 %_');await page.getByLabel('Intervenant déclaré',{exact:true}).fill('Camille Exemple');await page.getByLabel('Activité',{exact:true}).fill('Préparation de la prestation');await page.getByLabel('Note interne',{exact:true}).fill('Note de travail');await page.getByLabel('Durée (h:mm ou minutes)',{exact:true}).fill('1.5');await page.getByRole('button',{name:'Enregistrer le temps',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('minutes entières');await expect(page.getByLabel('Projet ou dossier',{exact:true})).toHaveValue('DOS109 %_');await page.getByLabel('Durée (h:mm ou minutes)',{exact:true}).fill('1:30');await page.getByRole('button',{name:'Enregistrer le temps',exact:true}).click();await expect(page).toHaveURL(/\/temps\/[0-9a-f-]{36}$/);const detail=page.url(),id=new URL(detail).pathname.split('/').at(-1)!;await expect(page.locator('dl')).toContainText('1:30');
  await page.locator('summary',{hasText:'Modifier le temps'}).click();const stale=await browser.newPage();try{await stale.context().addCookies(await page.context().cookies());await stale.goto(detail);await stale.locator('summary',{hasText:'Modifier le temps'}).click();await stale.getByLabel('Note interne',{exact:true}).fill('Note conservée après conflit');await page.getByLabel('Durée (h:mm ou minutes)',{exact:true}).fill('2:05');await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.locator('dl')).toContainText('2:05');await stale.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(stale.getByRole('main').getByRole('alert')).toContainText('Cette saisie a été modifiée');await expect(stale.getByLabel('Note interne',{exact:true})).toHaveValue('Note conservée après conflit');}finally{await stale.close();}
  const urls=e2eUrls(),env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:urls.owner,APP_DATABASE_URL:urls.app,LOG_LEVEL:'silent'};for(const k of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete env[k];execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-time-log.ts',userId,companyId!],{env,timeout:90_000});const filtered=base+'?du=2026-06-01&au=2026-06-30&projet=DOS109+%25_';await page.goto(filtered);await expect(page.getByText('Page 1 sur 2',{exact:true})).toBeVisible();await expect(page.locator('dl')).toContainText('2:05');await expectNoPageOverflow(page);await captureReference(page,'carnet-temps',page.getByRole('heading',{name:'Carnet de temps',exact:true}),false,true);const csv=await page.request.get(filtered.replace('/temps?','/temps/export?'));expect(csv.status()).toBe(200);expect(csv.headers()['cache-control']).toBe('private, no-store');expect((await csv.body()).subarray(0,3)).toEqual(Buffer.from([239,187,191]));expect(await csv.text()).toContain('Activité exemple 52');expect(await csv.text()).toContain(';125');expect(await csv.text()).toContain('Nombre de saisies;53');await page.getByRole('link',{name:'Suivante',exact:true}).click();await expect(page.getByText('Page 2 sur 2',{exact:true})).toBeVisible();
  await page.goto(filtered);await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.getByRole('heading',{name:'Time log',exact:true})).toBeVisible();await expectNoPageOverflow(page);await captureReference(page,'carnet-temps-en-dark',page.getByRole('heading',{name:'Time log',exact:true}),false,true);await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
  for(const q of ['du=','du=2026-06-01&du=2026-06-01','page=0','usage=OTHER'])expect((await page.request.get(base+'/export?'+q)).status()).toBe(400);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/temps/'+id)).status()).toBe(404);
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'time-'||gen_random_uuid()::text||'@example.test','Backup owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);await page.goto(detail);await page.locator('summary',{hasText:'Modifier le temps'}).click();await page.getByLabel('Note interne',{exact:true}).fill('Droits retirés');await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText("Tu n'as pas les droits");expect((await page.request.get(base+'/nouveau')).status()).toBe(404);await page.goto(detail);await expect(page.locator('summary',{hasText:'Modifier le temps'})).toHaveCount(0);
  await db.query("UPDATE membership SET role='ACCOUNTANT',module_access='{\"accounting\":\"write\",\"sales\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(detail);await page.locator('summary',{hasText:'Supprimer la saisie'}).click();await page.getByRole('button',{name:'Confirmer la suppression',exact:true}).click();await expect(page.getByRole('heading',{name:'Détail du temps',exact:true})).toBeVisible();await page.locator('input[name="confirmed"]').check();await page.getByRole('button',{name:'Confirmer la suppression',exact:true}).click();await expect(page.getByRole('heading',{name:'Carnet de temps',exact:true})).toBeVisible();expect((await page.request.get(detail)).status()).toBe(404);await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);for(const path of [base,base+'/export',company+'/espace/projets'])expect((await page.request.get(path)).status()).toBe(404);expect(await counts()).toEqual(before);expect(cspViolations).toEqual([]);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();}
});

test("time print includes every filtered page, exact hours and private read-only landscape PDF",async({page,browser})=>{
 test.setTimeout(180_000);cspViolations.length=0;watchCsp(page.context());if(updateCookies)await page.context().addCookies(updateCookies);await page.goto('/');
 if(!updateCookies){await expect(page).toHaveURL(/\/setup$/);await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');await page.getByLabel('Ton nom').fill('Alex Exemple');await page.getByLabel('Courriel').fill(EMAIL);await page.getByLabel('Mot de passe',{exact:true}).fill(PASSWORD);await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);await page.getByRole('button',{name:"Créer l'entreprise et commencer",exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);}
 if(!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))await page.getByRole('link',{name:'Atelier Exemple inc.',exact:true}).click();await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
 const company=new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0],companyId=company.split('/')[2],base=company+'/temps',query='du=2026-09-01&au=2026-09-30&projet=IMP111+%25_&page=2',source=base+'?'+query,copy=base+'/imprimer?'+query,db=new pg.Client({connectionString:e2eUrls().owner});await db.connect();let userId='',role='',access:unknown=null,backup='';
 try{
  const m=(await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2',[companyId,EMAIL])).rows[0];userId=m.user_id;role=m.role;access=m.module_access;
  const seed=(mode:string)=>{const u=e2eUrls(),env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:u.owner,APP_DATABASE_URL:u.app,LOG_LEVEL:'silent'};for(const k of ['APP_URL','AUTH_SECRET','ENCRYPTION_KEY'])delete env[k];execFileSync(process.execPath,['--conditions=react-server','--import=tsx','tests/e2e/seed-time-print.ts',userId,companyId!,mode],{env,timeout:90_000});};
  const counts=async()=>(await db.query('SELECT (SELECT count(*) FROM audit_log)::text AS audit,(SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments')).rows;
  seed('initial');await page.goto(source);await expect(page.getByText('Page 2 sur 3',{exact:true})).toBeVisible();const link=page.getByRole('link',{name:'Impression / PDF complet',exact:true});await expect(link).toHaveAttribute('href',copy);seed('extra');const before=await counts();await link.click();await expect(page).toHaveURL(copy);await expect(page.locator('.time-print tbody tr')).toHaveCount(107);await expect(page.locator('.time-print')).toContainText('Saisie relue à l’ouverture');await expect(page.locator('.time-print')).toContainText('Note interne conservée');await expect(page.locator('.time-print-summary')).toContainText('6:19');await expect(page.getByRole('link',{name:'Retour au carnet',exact:true})).toHaveAttribute('href',source);const response=await page.request.get(copy);expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');expect(await counts()).toEqual(before);await expect(page.locator('.time-print table')).toHaveCSS('table-layout','fixed');await expectNoPageOverflow(page);await captureReference(page,'impression-temps',page.getByRole('heading',{name:'Carnet de temps — copie imprimable',exact:true}),false,true);
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.getByRole('heading',{name:'Time log — print copy',exact:true})).toBeVisible();await captureReference(page,'impression-temps-en-dark',page.getByRole('heading',{name:'Time log — print copy',exact:true}),false,true);await expectNoPageOverflow(page);
  await page.emulateMedia({media:'print'});await expect(page.getByRole('button',{name:'Print / PDF',exact:true})).toBeHidden();await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');await expect(page.locator('.time-print')).toHaveCSS('color','rgb(0, 0, 0)');await expect(page.locator('.time-print table')).toHaveCSS('table-layout','fixed');if(process.env.E2E_MOBILE!=='1'){const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,4).toString()).toBe('%PDF');const boxes=[...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];expect(boxes.length).toBeGreaterThan(1);for(const b of boxes)expect(Number(b[1])).toBeGreaterThan(Number(b[2]));}await page.emulateMedia({media:'screen'});await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('light');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'Français',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','fr-CA');
  for(const q of ['du=','page=0','projet=x&projet=y','usage=OTHER']){await page.goto(base+'/imprimer?'+q);await expect(page.getByRole('main').getByRole('alert')).toBeVisible();await expect(page.locator('.time-print table')).toHaveCount(0);}await page.goto(base+'/imprimer?du=2026-08-01&au=2026-08-31');await expect(page.getByText('Aucune saisie pour ces filtres.',{exact:true})).toBeVisible();
  backup=(await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'time-print-'||gen_random_uuid()::text||'@example.test','Backup owner',now()) RETURNING id")).rows[0].id;await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())",[companyId,backup]);await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\",\"sales\":\"none\",\"contacts\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await page.goto(copy);await expect(page.locator('.time-print tbody tr')).toHaveCount(107);await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2",[companyId,userId]);expect((await page.request.get(copy)).status()).toBe(404);expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/temps/imprimer?'+query)).status()).toBe(404);
  const guest=await browser.newContext();try{const r=await guest.request.get(new URL(copy,page.url()).href,{maxRedirects:0});expect(r.status()).toBe(307);expect(r.headers()['location']).toContain('/connexion');}finally{await guest.close();}await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);seed('capacity');await page.goto(copy);await expect(page.getByRole('main').getByRole('alert')).toContainText('1 000 saisies');await expect(page.locator('.time-print table')).toHaveCount(0);await page.goto(source);await expect(page.getByRole('link',{name:'Impression / PDF complet',exact:true})).toHaveCount(0);expect((await page.request.get(base+'/export?'+query)).status()).toBe(200);expect(cspViolations).toEqual([]);
 }finally{if(userId&&role)await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2',[companyId,userId,role,JSON.stringify(access??{})]);if(backup){await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2',[companyId,backup]);await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1',[backup]);}await db.end();}
});

test('registered projects preserve time snapshots, archived history and modular customer privacy', async ({ page, browser }) => {
    test.setTimeout(240000);
    cspViolations.length = 0;
    watchCsp(page.context());
    if (updateCookies)
        await page.context().addCookies(updateCookies);
    await page.goto('/');
    if (!updateCookies) {
        await expect(page).toHaveURL(/\/setup$/);
        await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');
        await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.');
        await page.getByLabel('Ton nom').fill('Alex Exemple');
        await page.getByLabel('Courriel').fill(EMAIL);
        await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
        await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);
        await page.getByRole('button', { name: "Créer l'entreprise et commencer", exact: true }).click();
        await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    }
    if (!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname))
        await page.getByRole('link', { name: 'Atelier Exemple inc.', exact: true }).click();
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0], companyId = company.split('/')[2], base = company + '/projets', times = company + '/temps', db = new pg.Client({ connectionString: e2eUrls().owner });
    await db.connect();
    let userId = '', role = '', access: unknown = null, backup = '';
    try {
        const m = (await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2', [companyId, EMAIL])).rows[0];
        userId = m.user_id;
        role = m.role;
        access = m.module_access;
        const financial = async () => (await db.query('SELECT (SELECT count(*) FROM journal_entry)::text AS entries,(SELECT count(*) FROM sales_document)::text AS invoices,(SELECT count(*) FROM payment)::text AS payments')).rows, before = await financial();
        const customer = (await db.query("INSERT INTO contact(id,company_id,is_customer,display_name,email,updated_at) VALUES(gen_random_uuid(),$1,true,'Client Projet 112','project112@example.test',now()) RETURNING id", [companyId])).rows[0].id;
        const expand = async (box: Locator) => { if (!(await box.evaluate(el => el.hasAttribute('open'))))
            await box.locator('summary').click(); };
        await page.goto(company + '/espace/projets');
        await page.getByRole('heading', { name: 'Projets', exact: true }).locator('..').locator('..').getByRole('link', { name: 'Registre de projets', exact: true }).click();
        await expect(page).toHaveURL(base);
        await page.getByRole('link', { name: 'Créer un projet', exact: true }).click();
        await page.getByLabel('Code du projet', { exact: true }).fill('BAD CODE');
        await page.getByLabel('Nom du projet', { exact: true }).fill('Projet Démo 112');
        await page.getByLabel('Description courte', { exact: true }).fill('Planification et suivi fictifs');
        await page.getByLabel('Nom du client à rechercher', { exact: true }).fill('Client Projet 112');
        await page.getByRole('button', { name: 'Rechercher un client', exact: true }).click();
        await page.getByRole('button', { name: 'Utiliser Client Projet 112', exact: true }).click();
        await page.getByRole('button', { name: 'Créer un projet', exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert')).toContainText('Vérifie le code');
        await expect(page.getByLabel('Nom du projet', { exact: true })).toHaveValue('Projet Démo 112');
        await expect(page.locator('input[name="customerId"]')).toHaveValue(customer);
        await page.getByLabel('Code du projet', { exact: true }).fill('web112');
        await page.getByRole('button', { name: 'Créer un projet', exact: true }).click();
        await expect(page).toHaveURL(/\/projets\/[0-9a-f-]{36}$/);
        const detail = page.url(), id = new URL(detail).pathname.split('/').at(-1)!;
        await expect(page.getByRole('main')).toContainText('WEB112 — Projet Démo 112');
        await expect(page.getByRole('main')).toContainText('Client Projet 112');
        const lookup = await page.request.get(base + '/clients?q=Client+Projet+112');
        expect(lookup.status()).toBe(200);
        expect(lookup.headers()['cache-control']).toContain('no-store');
        expect(await lookup.json()).toEqual({ rows: [{ id: customer, displayName: 'Client Projet 112' }], hasMore: false });
        expect((await page.request.get(base + '/clients?q=x&q=y')).status()).toBe(400);
        const saveTime = async (task: string, minutes: string) => { await page.getByLabel('Date du travail', { exact: true }).fill('2026-09-15'); await page.getByLabel('Intervenant déclaré', { exact: true }).fill('Alex Exemple'); await page.getByLabel('Activité', { exact: true }).fill(task); await page.getByLabel('Durée (h:mm ou minutes)', { exact: true }).fill(minutes); await page.getByRole('button', { name: 'Enregistrer le temps', exact: true }).click(); await expect(page).toHaveURL(/\/temps\/[0-9a-f-]{36}$/); return page.url(); };
        await page.getByRole('link', { name: 'Saisir des heures pour ce projet', exact: true }).click();
        await expect(page.getByLabel('Code du projet enregistré', { exact: true })).toHaveValue('WEB112');
        const firstTime = await saveTime('Heures liées avant renommage', '2:05');
        await expect(page.getByRole('link', { name: 'Code du projet enregistré: WEB112', exact: true })).toBeVisible();
        await page.goto(times + '/nouveau');
        await page.getByLabel('Projet ou dossier', { exact: true }).fill('Projet Démo 112');
        await saveTime('Temps libre conservé', '5');
        await page.goto(detail);
        const edit = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Modifier le projet' }) });
        await expand(edit);
        await edit.getByLabel('Nom du projet', { exact: true }).fill('Nouveau nom projet 112');
        await edit.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
        await expect(page.getByRole('main')).toContainText('WEB112 — Nouveau nom projet 112');
        await page.goto(firstTime);
        await expect(page.getByRole('main')).toContainText('Projet Démo 112');
        await page.goto(detail);
        await page.getByRole('link', { name: 'Saisir des heures pour ce projet', exact: true }).click();
        await expect(page.getByLabel('Projet ou dossier', { exact: true })).toHaveValue('Nouveau nom projet 112');
        await saveTime('Heures liées après renommage', '60');
        const filtered = times + '?du=2026-09-01&au=2026-09-30&dossier=WEB112';
        await page.goto(filtered);
        await expect(page.getByRole('main')).toContainText('2 saisies');
        await expect(page.getByText('Temps total (h:mm)', { exact: true }).locator('..').locator('dd')).toHaveText('3:05');
        const csv = await page.request.get(times + '/export?du=2026-09-01&au=2026-09-30&dossier=WEB112');
        expect(csv.status()).toBe(200);
        const csvText = await csv.text();
        expect(csvText).toContain('WEB112 — Projet Démo 112');
        expect(csvText).toContain('WEB112 — Nouveau nom projet 112');
        expect(csvText).not.toContain('Temps libre conservé');
        await page.getByRole('link', { name: 'Impression / PDF complet', exact: true }).click();
        await expect(page.locator('.time-print tbody tr')).toHaveCount(2);
        await expect(page.locator('.time-print')).toContainText('Code du projet enregistré: WEB112');
        await page.goto(detail);
        await expectNoPageOverflow(page);
        await captureReference(page, 'projets-lies', page.getByRole('heading', { name: 'Fiche du projet', exact: true }), false, true, true);
        await page.getByRole('button', { name: 'English', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await expect(page.getByRole('heading', { name: 'Project details', exact: true })).toBeVisible();
        await expectNoPageOverflow(page);
        await captureReference(page, 'projets-lies-en-dark', page.getByRole('heading', { name: 'Project details', exact: true }), false, true, true);
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await page.getByRole('button', { name: 'Français', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
        await expect(page.getByRole('heading', { name: 'Fiche du projet', exact: true })).toBeVisible();
        await expand(edit);
        await edit.getByLabel('Nom du projet', { exact: true }).fill('Édition périmée');
        await db.query("UPDATE project SET description='Changement concurrent',revision=revision+1 WHERE id=$1", [id]);
        await edit.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert')).toContainText('Le projet a changé');
        await expect(edit.getByLabel('Nom du projet', { exact: true })).toHaveValue('Édition périmée');
        await page.getByRole('link', { name: 'Recharger la fiche', exact: true }).click();
        await expect(page.getByRole('main')).toContainText('Changement concurrent');
        const archive = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Archiver le projet' }) });
        await expand(archive);
        await archive.getByRole('checkbox').check();
        await archive.getByRole('button', { name: 'Archiver le projet', exact: true }).click();
        await expect(page.getByRole('main')).toContainText('Archivé');
        await expect(page.getByRole('link', { name: 'Saisir des heures pour ce projet', exact: true })).toHaveCount(0);
        expect((await page.request.get(times + '/nouveau?dossier=WEB112')).status()).toBe(404);
        await page.goto(firstTime);
        const timeEdit = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Modifier le temps' }) });
        await expand(timeEdit);
        await timeEdit.getByLabel('Durée (h:mm ou minutes)', { exact: true }).fill('2:30');
        await timeEdit.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
        await expect(page.getByRole('main')).toContainText('2:30');
        await expand(timeEdit);
        await timeEdit.getByLabel('Code du projet enregistré', { exact: true }).fill('');
        await timeEdit.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert')).toContainText('coche la confirmation');
        await timeEdit.getByRole('checkbox').check();
        await timeEdit.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Code du projet enregistré: WEB112', exact: true })).toHaveCount(0);
        await page.goto(detail);
        const reactivate = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Réactiver le projet' }) });
        await expand(reactivate);
        await reactivate.getByRole('checkbox').check();
        await reactivate.getByRole('button', { name: 'Réactiver le projet', exact: true }).click();
        await expect(page.getByRole('link', { name: 'Saisir des heures pour ce projet', exact: true })).toBeVisible();
        backup = (await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'projects-'||gen_random_uuid()::text||'@example.test','Backup owner',now()) RETURNING id")).rows[0].id;
        await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())", [companyId, backup]);
        await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"read\",\"sales\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]);
    await page.goto(base + '/nouveau');
    await page.getByLabel('Code du projet', { exact: true }).fill('READWEB112');
    await page.getByLabel('Nom du projet', { exact: true }).fill('Projet Contacts lecture');
    await page.getByLabel('Nom du client à rechercher', { exact: true }).fill('Client Projet 112');
    await page.getByRole('button', { name: 'Rechercher un client', exact: true }).click();
    await page.getByRole('button', { name: 'Utiliser Client Projet 112', exact: true }).click();
    await page.getByRole('button', { name: 'Créer un projet', exact: true }).click();
    await expect(page).toHaveURL(/\/projets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('main')).toContainText('Client Projet 112');
    await db.query("UPDATE membership SET role='USER',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]);
        await page.goto(detail);
        await expect(page.getByRole('main')).toContainText('Données du client masquées');
        const hidden = await (await page.request.get(detail)).text();
        expect(hidden).not.toContain('Client Projet 112');
        expect(hidden).not.toContain(customer);
        expect((await page.request.get(base + '/clients?q=Client')).status()).toBe(404);
        await expand(edit);
        await edit.getByLabel('Description courte', { exact: true }).fill('Modification autorisée sans Contacts');
        await edit.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
        await expect(page.getByRole('main')).toContainText('Modification autorisée sans Contacts');
        expect((await db.query('SELECT customer_id FROM project WHERE id=$1', [id])).rows[0].customer_id).toBe(customer);
        expect((await page.request.get(times + '/export?du=2026-09-01&au=2026-09-30&dossier=WEB112')).status()).toBe(200);
        await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\",\"contacts\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]);
        await page.goto(detail);
        await expect(page.locator('summary', { hasText: 'Modifier le projet' })).toHaveCount(0);
        await expect(page.locator('summary', { hasText: 'Archiver le projet' })).toHaveCount(0);
        expect((await page.request.get(base + '/nouveau')).status()).toBe(404);
        await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]);
        for (const path of [base, detail, company + '/espace/projets'])
            expect((await page.request.get(path)).status()).toBe(404);
        expect((await page.request.get('/c/00000000-0000-7000-8000-999999999999/projets/' + id)).status()).toBe(404);
        const guest = await browser.newContext();
        try {
            const r = await guest.request.get(detail, { maxRedirects: 0 });
            expect(r.status()).toBe(307);
            expect(r.headers()['location']).toContain('/connexion');
        }
        finally {
            await guest.close();
        }
        expect(await financial()).toEqual(before);
        expect(cspViolations).toEqual([]);
    }
    finally {
        if (userId && role)
            await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2', [companyId, userId, role, JSON.stringify(access ?? {})]);
        if (backup) {
            await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2', [companyId, backup]);
            await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1', [backup]);
        }
        await db.end();
    }
});

test('project contribution classifies immutable originals, dated reversals and private complete reports', async ({ page, browser }) => {
  test.setTimeout(180000); cspViolations.length = 0; watchCsp(page.context());
  if (updateCookies) await page.context().addCookies(updateCookies);
  await page.goto('/');
  if (!updateCookies) {
    await expect(page).toHaveURL(/\/setup$/); await page.locator('[name="setupToken"]').fill('e2e-setup-token-123456789');
    await page.getByLabel("Nom de l'entreprise").fill('Atelier Exemple inc.'); await page.getByLabel('Ton nom').fill('Alex Exemple'); await page.getByLabel('Courriel').fill(EMAIL);
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD); await page.getByLabel('Confirmation du mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: "Créer l'entreprise et commencer", exact: true }).click(); await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  }
  if (!/^\/c\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname)) await page.getByRole('link', { name: 'Atelier Exemple inc.', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const company = new URL(page.url()).pathname.match(/^\/c\/[0-9a-f-]{36}/)![0], companyId = company.split('/')[2], db = new pg.Client({ connectionString: e2eUrls().owner });
  await db.connect(); let userId = '', role = '', access: unknown = null, backup = '';
  try {
    const m = (await db.query('SELECT m.user_id,m.role,m.module_access FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2', [companyId, EMAIL])).rows[0];
    userId = m.user_id; role = m.role; access = m.module_access;
    const urls = e2eUrls(), env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: urls.owner, APP_DATABASE_URL: urls.app, LOG_LEVEL: 'silent' };
    for (const key of ['APP_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY']) delete env[key];
    const fixture = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--import=tsx', 'tests/e2e/seed-project-financials.ts', userId, companyId!], { env, timeout: 90000, encoding: 'utf8' })) as Record<'sale' | 'expense' | 'previous' | 'counter', { id: string; number: string }>;
    const ledger = async () => (await db.query('SELECT (SELECT jsonb_agg(e ORDER BY id) FROM journal_entry e) AS entries,(SELECT jsonb_agg(l ORDER BY id) FROM journal_line l) AS lines')).rows, before = await ledger();
    await page.goto(company + '/projets/nouveau'); await page.getByLabel('Code du projet', { exact: true }).fill('WEB113'); await page.getByLabel('Nom du projet', { exact: true }).fill('Services — projet exemple');
    await page.getByRole('button', { name: 'Créer un projet', exact: true }).click(); await expect(page).toHaveURL(/\/projets\/[0-9a-f-]{36}$/);
    const detail = new URL(page.url()).pathname, base = detail + '/finances', query = '?du=2023-03-01&au=2023-03-31', filtered = base + query;
    await page.getByRole('link', { name: 'Contribution comptabilisée', exact: true }).click(); await expect(page).toHaveURL(base);
    const prepare = async (number: string) => { await page.goto(base + '/rattacher'); await page.getByLabel('Numéro interne de l’écriture', { exact: true }).fill(number); await page.getByRole('button', { name: 'Revoir l’écriture', exact: true }).click(); };
    const confirm = async () => { await page.getByRole('region', { name: 'Aperçu du classement analytique', exact: true }).getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirmer le classement', exact: true }).click(); await expect(page).toHaveURL(base); };
    await prepare(fixture.counter.number); await expect(page.getByRole('main').getByRole('alert')).toContainText(/[Éé]criture originale/);
    for (const e of [fixture.sale, fixture.expense, fixture.previous]) { await prepare(e.number); await expect(page.getByRole('region', { name: 'Aperçu du classement analytique', exact: true })).toContainText('Sans projet'); await confirm(); }
    await page.goto(filtered); await expect(page.getByRole('main')).toContainText('3 écritures classées');
    await expect(page.locator('.finance-summary').getByText('Revenus comptabilisés', { exact: true }).locator('..').locator('dd')).toHaveText('2 400,00 $');
    await expect(page.locator('.finance-summary').getByText('Contribution nette', { exact: true }).locator('..').locator('dd')).toHaveText('2 050,00 $');
    await expectNoPageOverflow(page); await captureReference(page, 'contribution-projets', page.getByRole('heading', { name: 'Contribution comptabilisée du projet', exact: true }), false, true, true);
    const csv = await page.request.get(base + '/export' + query); expect(csv.status()).toBe(200); expect(csv.headers()['cache-control']).toBe('private, no-store');
    expect((await csv.body()).subarray(0, 3)).toEqual(Buffer.from([239, 187, 191])); const text = await csv.text(); expect(text).toContain('-100,00'); expect(text).toContain('2050,00'); expect(text).not.toContain('PF113-PRIVATE');
    for (const q of ['du=x', 'du=2023-03-01&du=2023-03-01', 'page=0']) expect((await page.request.get(base + '/export?' + q)).status()).toBe(400);
    await page.getByRole('link', { name: 'Impression / PDF complet', exact: true }).click(); await expect(page.locator('.project-finance-print tbody tr')).toHaveCount(3);
    await page.emulateMedia({ media: 'print' }); await expect(page.locator('.print-controls').first()).toBeHidden(); await page.emulateMedia({ media: 'screen' });
    await page.goto(filtered); await page.getByRole('button', { name: 'English', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoPageOverflow(page); await captureReference(page, 'contribution-projets-en-dark', page.getByRole('heading', { name: 'Posted project contribution', exact: true }), false, true, true);
    const en = await page.request.get(base + '/export' + query); expect(await en.text()).toContain('-100.00');
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Français', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
    await prepare(fixture.expense.number); await db.query('UPDATE project_entry_assignment SET project_id=NULL,revision=revision+1 WHERE entry_id=$1', [fixture.expense.id]);
    await page.getByRole('region', { name: 'Aperçu du classement analytique', exact: true }).getByRole('checkbox').check(); await page.getByRole('button', { name: 'Détacher cette écriture', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Le classement a changé');
    await prepare(fixture.expense.number); await confirm();
    backup = (await db.query("INSERT INTO app_user(id,email,display_name,updated_at) VALUES(gen_random_uuid(),'finance-'||gen_random_uuid()::text||'@example.test','Backup owner',now()) RETURNING id")).rows[0].id;
    await db.query("INSERT INTO membership(id,company_id,user_id,role,updated_at) VALUES(gen_random_uuid(),$1,$2,'OWNER',now())", [companyId, backup]);
    await db.query("UPDATE membership SET role='READ_ONLY',module_access='{\"accounting\":\"write\",\"contacts\":\"none\",\"sales\":\"none\",\"taxes\":\"none\",\"audit\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]);
    await page.goto(filtered); await expect(page.getByRole('link', { name: 'Préparer un classement', exact: true })).toHaveCount(0);
    expect((await page.request.get(base + '/rattacher?ecriture=' + fixture.sale.number)).status()).toBe(404); expect((await page.request.get(base + '/export' + query)).status()).toBe(200);
    expect(await (await page.request.get(filtered)).text()).not.toContain('PF113-PRIVATE');
    await db.query("UPDATE membership SET module_access='{\"accounting\":\"none\"}' WHERE company_id=$1 AND user_id=$2", [companyId, userId]);
    for (const path of [filtered, base + '/export' + query, base + '/imprimer' + query]) expect((await page.request.get(path)).status()).toBe(404);
    const guest = await browser.newContext(); try { const r = await guest.request.get(new URL(filtered, page.url()).href, { maxRedirects: 0 }); expect(r.status()).toBe(307); expect(r.headers()['location']).toContain('/connexion'); } finally { await guest.close(); }
    expect(await ledger()).toEqual(before); expect(cspViolations).toEqual([]);
  } finally {
    if (userId && role) await db.query('UPDATE membership SET role=$3::member_role,module_access=$4::jsonb WHERE company_id=$1 AND user_id=$2', [companyId, userId, role, JSON.stringify(access ?? {})]);
    if (backup) { await db.query('DELETE FROM membership WHERE company_id=$1 AND user_id=$2', [companyId, backup]); await db.query('UPDATE app_user SET disabled_at=now() WHERE id=$1', [backup]); }
    await db.end();
  }
});
