import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import pg from "pg";
import { e2eUrls } from "./db";

const VERSION = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

const EMAIL = "admin@exemple.test";
const PASSWORD = "une phrase de passe très longue 2026";

/** Optional wiki references from the isolated, fictional browser-test company only. */
async function captureReference(page: Page, name: string, mobileHeading?: string) {
  if (process.env.ALLUMI_SCREENSHOTS !== "1") return;
  if (process.env.ALLUMI_SCREENSHOT_PREFIX && !name.startsWith(process.env.ALLUMI_SCREENSHOT_PREFIX)) return;
  mkdirSync("docs/images", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (mobileHeading && process.env.E2E_MOBILE === "1") await page.getByRole("heading", { name: mobileHeading, exact: true }).evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  await page.screenshot({ scale: "css", path: `docs/images/${name}-${process.env.E2E_MOBILE === "1" ? "mobile" : "desktop"}.png`, fullPage: process.env.E2E_MOBILE !== "1", animations: "disabled" });
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
  test.setTimeout(240_000);
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

  await securityJourney(page, browser, recoveryCodes);
  await ledgerJourney(page, totp);
  await contactsJourney(page, recoveryCodes[3] ?? "");
  await catalogJourney(page);
  await companyJourney(page);
  await draftsJourney(page);
  await page.goto('/versions');
  await expect(page.getByRole('heading', { name: 'Versions et mises à jour' })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, 'versions');
  await page.goto('/');
  await openSection(page, "Ventes");
  await expect(page.getByRole("heading", { name: "Ventes", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "À venir — non disponible" })).toBeVisible();
  await expectNoPageOverflow(page);
  await captureReference(page, "espace-ventes");
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
  await appearanceJourney(page);
  await postingJourney(page);
  const paidInvoiceUrl = await creditPostingJourney(page);
  await paymentsJourney(page, paidInvoiceUrl);
  await integrationsJourney(page);
  await onlinePaymentsJourney(page, paidInvoiceUrl);
  await membersJourney(page, browser);
  // Nothing in the whole journey (both locales, every form, the security pages, a second browser) was blocked.
  expect(cspViolations, "Content-Security-Policy violations").toEqual([]);
});

/** Today in the company's time zone (the application uses America/Toronto), as YYYY-MM-DD. */
const todayInToronto = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

/** A link of the company navigation (the dashboard cards carry the same names). */
const openSection = async (page: Page, name: string) => {
  const nav = page.getByRole("navigation", { name: "Navigation de l'entreprise", exact: true });
  const link = nav.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) await nav.getByRole("button", { name: "Menu", exact: true }).click();
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
  await anonymizeJourney(page, recoveryCode);
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
  await page.getByLabel("Date de l’avoir",{exact:true}).fill("2026-07-01");
  await page.getByLabel("Motif de l’avoir",{exact:true}).fill("Ajustement du service");
  await page.getByLabel("Consultation comptable",{exact:true}).fill("25");
  await page.getByRole("button",{name:"Enregistrer le brouillon d’avoir",exact:true}).click();
  await page.locator("summary",{hasText:"Valider et affecter l’avoir"}).click();
  await page.getByLabel("Date comptable",{exact:true}).fill("2026-06-01");
  await page.getByLabel("Je confirme la validation et l’affectation intégrale de cet avoir.").check();
  await page.getByRole("button",{name:"Valider et affecter l’avoir",exact:true}).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await page.getByLabel("Date comptable",{exact:true}).fill("2026-07-01");
  await page.getByLabel("Je confirme la validation et l’affectation intégrale de cet avoir.").check();
  await captureReference(page,"validation-avoir");
  await page.getByRole("button",{name:"Valider et affecter l’avoir",exact:true}).click();
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
  await page.getByLabel("Reversal date",{exact:true}).fill("2026-06-30");
  await page.getByLabel("Reason",{exact:true}).fill("Incorrect adjustment");
  await page.getByLabel("I confirm permanently voiding this credit note.").check();
  await page.getByRole("button",{name:"Void credit note",exact:true}).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await page.getByLabel("Reversal date",{exact:true}).fill("2026-07-02");
  await page.getByLabel("I confirm permanently voiding this credit note.").check();
  await page.getByRole("button",{name:"Void credit note",exact:true}).click();
  await expect(page.getByText("Voided credit note",{exact:true})).toBeVisible();
  await expect(page.getByText("Unapplied on 2026-07-02",{exact:true})).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Transactions importées", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Imported transactions", exact: true })).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "STRIPE PAYOUT" })).toContainText("Payout");
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Français", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transactions importées", exact: true })).toBeVisible();
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
  await captureReference(page, "utilisateurs-permissions");
  await invite.getByRole("button", { name: "Inviter un utilisateur", exact: true }).click();
  const code = await page.getByTestId("invitation-code").textContent();
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const context = await newWatchedContext(browser);
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
  await guest.goto(`${company}/contacts`);
  await expect(guest.getByRole("link", { name: "Nouveau contact", exact: true })).toHaveCount(0);

  await page.reload(); // the invitation code is deliberately not retained on a refreshed page
  await expect(page.getByTestId("invitation-code")).toHaveCount(0);
  const member = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Collègue Exemple" }) });
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
