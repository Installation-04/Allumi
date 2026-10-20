import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

const VERSION = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

const EMAIL = "admin@exemple.test";
const PASSWORD = "une phrase de passe très longue 2026";

/** Optional wiki references from the isolated, fictional browser-test company only. */
async function captureReference(page: Page, name: string) {
  if (process.env.ALLUMI_SCREENSHOTS !== "1") return;
  mkdirSync("docs/images", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ scale: "css", path: `docs/images/${name}-${process.env.E2E_MOBILE === "1" ? "mobile" : "desktop"}.png`, fullPage: process.env.E2E_MOBILE !== "1", animations: "disabled" });
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}


test("setup, sign-in, two-factor enrollment and sign-in with a code", async ({ page, browser }) => {
  // This complete journey covers setup, MFA, accounting, both locales and optional reference captures.
  test.setTimeout(120_000);
  // Install metadata must be public, including before the first session.
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  expect(await manifestResponse.json()).toMatchObject({ name: 'Allumi', display: 'standalone', start_url: '/' });
  // Fresh instance: everything leads to /setup.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Bienvenue dans Allumi" })).toBeVisible();
  await expect(page.getByText(`Version ${VERSION}`)).toBeVisible();

  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/allumi-180.png');
  await captureReference(page, "premier-demarrage");

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
  await expect(page.getByText("Ton rôle : Propriétaire")).toBeVisible();

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
  const visitor = await browser.newContext();
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
  const recoveryCodes = await page.locator("main li").allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);

  // The codes are shown once: switching the language while they are on screen must not lose them.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeVisible();
  await expect(page.locator("main li")).toHaveText(recoveryCodes);
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

  // The code that enabled 2FA cannot be replayed (rejected whether or not its window is still open)...
  await page.getByLabel("Code à 6 chiffres").fill(totp.generate({ timestamp: enrolledAt }));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page.getByText("Code invalide ou déjà utilisé.")).toBeVisible();

  // ...while a recovery code works.
  await page.getByLabel("Code à 6 chiffres").fill(recoveryCodes[0] ?? "");
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);

  await ledgerJourney(page, totp);
  await contactsJourney(page);
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
  await expect(page.getByText("Your role: Owner")).toBeVisible();
  await captureReference(page, "dashboard-en");
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

async function contactsJourney(page: Page) {
  await openSection(page, "Contacts");
  await page.getByRole("link", { name: "Nouveau contact" }).click();
  await page.getByLabel("Nom affiché").fill("Atelier Boréal");
  await page.getByLabel("Type de contact").selectOption("BOTH");
  await page.getByLabel("Courriel", { exact: true }).fill("bonjour@boreal.example");
  await page.getByLabel("Téléphone", { exact: true }).fill("514 555-0142");
  await page.getByLabel("Délai de paiement (jours)").fill("-1");
  await page.getByRole("button", { name: "Créer le contact" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Vérifiez les champs du contact" })).toBeVisible();
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
}
