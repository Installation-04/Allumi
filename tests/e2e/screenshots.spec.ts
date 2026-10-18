import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

/**
 * Screenshots of the application for the README and the wiki (docs/images/*.png).
 *
 * Not a test of behaviour: it runs a demo company ("Atelier Exemple inc.", all data fictional) through the real
 * screens and photographs them. It only runs on request, on a fresh database, so that `npm run test:e2e` is not
 * affected:
 *
 *   npm run build && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run screenshots
 *
 * The folder is rewritten in full each time; commit the result when the screens changed.
 */
test.skip(process.env.SCREENSHOTS !== "1", "set SCREENSHOTS=1 (npm run screenshots)");

const OUT = process.env.SCREENSHOTS_DIR ?? "docs/images";
const EMAIL = "alex@exemple.test";
const PASSWORD = "une phrase de passe très longue 2026";

test.use({
  viewport: { width: 1280, height: 860 },
  timezoneId: "America/Toronto",
  reducedMotion: "reduce",
  // dates and pickers in the pictures follow the language of the interface
  launchOptions: { args: ["--lang=fr-CA"], env: { ...process.env, LANGUAGE: "fr_CA:fr" } as Record<string, string>, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
});

/** Today in the company's time zone, as YYYY-MM-DD. */
const todayInToronto = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
const dayOfMonth = (day: number) => `${todayInToronto().slice(0, 7)}-${String(day).padStart(2, "0")}`;

async function shot(page: Page, name: string, options: { full?: boolean } = {}) {
  await page.waitForLoadState("networkidle");
  // no caret, focus ring or hover state in the pictures
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: options.full ?? false });
}

const openSection = (page: Page, name: string) => page.getByRole("navigation", { name: "Navigation de l'entreprise" }).getByRole("link", { name, exact: true }).click();

/** Picks the account whose option starts with the code ("6050 – Loyer"). */
async function pickAccount(page: Page, label: string, code: string) {
  const select = page.getByLabel(label);
  const options = await select.locator("option").allInnerTexts();
  const wanted = options.find((text) => text.startsWith(`${code} –`));
  if (!wanted) throw new Error(`no account ${code} among the options`);
  await select.selectOption({ label: wanted });
}

async function postEntry(page: Page, entry: { date: string; kind?: string; memo: string; debit: string; credit: string; amount: string }) {
  await openSection(page, "Journal");
  await page.getByRole("link", { name: "Nouvelle écriture" }).click();
  await page.getByLabel("Date", { exact: true }).fill(entry.date);
  if (entry.kind) await page.getByLabel("Type d'écriture").selectOption(entry.kind);
  await page.getByLabel("Description").fill(entry.memo);
  await pickAccount(page, "Ligne 1 – Compte", entry.debit);
  await page.getByLabel("Ligne 1 – Débit").fill(entry.amount);
  await pickAccount(page, "Ligne 2 – Compte", entry.credit);
  await page.getByLabel("Ligne 2 – Crédit").fill(entry.amount);
  await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
  await expect(page.getByRole("heading", { name: /^Écriture J-/ })).toBeVisible();
}

async function addContact(page: Page, contact: { name: string; supplier?: boolean; email: string; phone: string; address: string; city: string; postal: string; terms: string }) {
  await openSection(page, "Contacts");
  await page.getByRole("link", { name: "Nouveau contact" }).click();
  await page.getByLabel("Nom affiché").fill(contact.name);
  await page.getByLabel("Client", { exact: true }).setChecked(!contact.supplier);
  await page.getByLabel("Fournisseur", { exact: true }).setChecked(Boolean(contact.supplier));
  await page.getByLabel("Courriel").fill(contact.email);
  await page.getByLabel("Téléphone").fill(contact.phone);
  await page.getByLabel("Adresse", { exact: true }).fill(contact.address);
  await page.getByLabel("Ville").fill(contact.city);
  await page.getByLabel("Province ou territoire").selectOption("QC");
  await page.getByLabel("Code postal").fill(contact.postal);
  await page.getByLabel("Délai de paiement (jours)").fill(contact.terms);
  await page.getByRole("button", { name: "Créer le contact" }).click();
  await expect(page.getByRole("heading", { name: contact.name, level: 1 })).toBeVisible();
}

async function addItem(page: Page, item: { code: string; name: string; price: string; account: string }) {
  await openSection(page, "Produits et services");
  await page.getByRole("link", { name: "Nouveau produit ou service" }).click();
  await page.getByLabel("Code", { exact: true }).fill(item.code);
  await page.getByLabel("Nom", { exact: true }).fill(item.name);
  await page.getByLabel("Prix unitaire").fill(item.price);
  await pickAccount(page, "Compte de revenus", item.account);
  await page.getByLabel("Code de taxe par défaut").selectOption({ label: "TPS-TVQ – TPS + TVQ" });
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("heading", { name: item.name, level: 1 })).toBeVisible();
}

test("photographs the demo company", async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  // First start: the /setup page of a fresh instance.
  await page.goto("/setup");
  await page.getByLabel("Nom de l'entreprise").fill("Atelier Exemple inc.");
  await page.getByLabel("Premier mois de l'exercice financier").selectOption("1");
  await page.getByLabel("Ton nom").fill("Alex Tremblay");
  await page.getByLabel("Courriel").fill(EMAIL);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirmation du mot de passe").fill(PASSWORD);
  await shot(page, "premier-demarrage");
  await page.getByRole("button", { name: "Créer l'entreprise et commencer" }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Ton rôle : Propriétaire")).toBeVisible();

  // Sign-in page, seen by a visitor.
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-CA", timezoneId: "America/Toronto" });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto("/connexion");
  await shot(visitorPage, "connexion");
  await visitor.close();

  // The company: identity and registration numbers (examples, not real numbers).
  await openSection(page, "Entreprise");
  await page.getByLabel("Nom légal").fill("Atelier Exemple inc.");
  await page.getByLabel("Numéro de TPS/TVH").fill("123456789 RT 0001");
  await page.getByLabel("Numéro de TVQ").fill("1234567890 TQ 0001");
  await page.getByLabel("Adresse", { exact: true }).fill("245, rue des Forges");
  await page.getByLabel("Ville").fill("Trois-Rivières");
  await page.getByLabel("Province ou territoire").selectOption("QC");
  await page.getByLabel("Code postal").fill("G9A 2G6");
  await page.getByLabel("Courriel").fill("bonjour@atelier-exemple.test");
  await page.getByLabel("Téléphone").fill("819 555-0142");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await shot(page, "entreprise");
  await page.setViewportSize({ width: 1280, height: 860 });

  // The taxes of Québec, in one click.
  await openSection(page, "Taxes");
  await page.getByRole("button", { name: "Installer la TPS et la TVQ" }).click();
  await expect(page.getByText("Taux actuel : 9,975 %")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1250 });
  await shot(page, "taxes");
  await page.setViewportSize({ width: 1280, height: 860 });

  // Contacts: customers and a supplier.
  await addContact(page, { name: "Boulangerie Dupuis", email: "compta@dupuis.exemple.test", phone: "819 555-0101", address: "12, rue Notre-Dame", city: "Trois-Rivières", postal: "G9A 1B2", terms: "30" });
  await addContact(page, { name: "Clinique vétérinaire du Fleuve", email: "admin@fleuve.exemple.test", phone: "418 555-0166", address: "880, boulevard Laurier", city: "Québec", postal: "G1V 4T2", terms: "15" });
  await addContact(page, { name: "Studio Lumière", email: "info@studio-lumiere.exemple.test", phone: "514 555-0123", address: "3300, rue Saint-Denis", city: "Montréal", postal: "H2X 3K8", terms: "30" });
  await addContact(page, { name: "Papeterie Beauce", supplier: true, email: "ventes@papeterie-beauce.exemple.test", phone: "418 555-0188", address: "55, avenue du Pont", city: "Saint-Georges", postal: "G5Y 3R4", terms: "45" });
  await openSection(page, "Contacts");
  await expect(page.getByRole("link", { name: "Papeterie Beauce" })).toBeVisible();
  await shot(page, "contacts");
  await page.getByRole("link", { name: "Nouveau contact" }).click();
  await shot(page, "contact-nouveau");

  // Products and services.
  await addItem(page, { code: "DEV-H", name: "Développement sur mesure (heure)", price: "95", account: "4000" });
  await addItem(page, { code: "CONS-H", name: "Consultation (heure)", price: "85,5", account: "4000" });
  await addItem(page, { code: "FORF-MAINT", name: "Forfait de maintenance mensuel", price: "450", account: "4000" });
  await addItem(page, { code: "MAT-LIC", name: "Licence logicielle (annuelle)", price: "1 200", account: "4100" });
  await openSection(page, "Produits et services");
  await expect(page.getByRole("cell", { name: "85,50 $" })).toBeVisible();
  await shot(page, "produits");

  // The journal: an opening balance and a few ordinary entries.
  await postEntry(page, { date: dayOfMonth(1), kind: "OPENING_BALANCE", memo: "Capital de départ", debit: "1000", credit: "3000", amount: "25 000,00" });
  await postEntry(page, { date: dayOfMonth(2), memo: "Mandat de développement – acompte reçu", debit: "1000", credit: "4000", amount: "4 200,00" });
  await postEntry(page, { date: dayOfMonth(3), memo: "Loyer du mois", debit: "6050", credit: "1000", amount: "1 500,00" });

  // The entry form, as it looks while the entry does not balance yet.
  await openSection(page, "Journal");
  await page.getByRole("link", { name: "Nouvelle écriture" }).click();
  await page.getByLabel("Date", { exact: true }).fill(dayOfMonth(3));
  await page.getByLabel("Description").fill("Achat d'un poste de travail");
  await pickAccount(page, "Ligne 1 – Compte", "1500");
  await page.getByLabel("Ligne 1 – Débit").fill("3 200,00");
  await pickAccount(page, "Ligne 2 – Compte", "1000");
  await page.getByLabel("Ligne 2 – Crédit").fill("3 000,00");
  await expect(page.getByText(/Écart : 200,00/)).toBeVisible();
  await shot(page, "ecriture-nouvelle");
  await page.getByLabel("Ligne 2 – Crédit").fill("3 200,00");
  await expect(page.getByText("L'écriture est équilibrée.")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer l'écriture" }).click();
  await expect(page.getByRole("heading", { name: /^Écriture J-/ })).toBeVisible();
  await shot(page, "ecriture");

  await openSection(page, "Journal");
  await expect(page.getByText("Achat d'un poste de travail")).toBeVisible();
  await shot(page, "journal");

  await openSection(page, "Balance de vérification");
  await expect(page.getByText("La balance est équilibrée")).toBeVisible();
  await shot(page, "balance");

  await openSection(page, "Plan comptable");
  await expect(page.getByRole("cell", { name: "Banque – compte courant" })).toBeVisible();
  await shot(page, "plan-comptable");

  await openSection(page, "Exercices");
  await shot(page, "exercices");

  await openSection(page, "Piste d'audit");
  await expect(page.getByRole("cell", { name: "row.insert" }).first()).toBeVisible();
  await shot(page, "piste-d-audit");

  // Dashboard, light and dark, then in English.
  await openSection(page, "Tableau de bord");
  await shot(page, "tableau-de-bord");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "tableau-de-bord-sombre");
  await openSection(page, "Journal");
  await shot(page, "journal-sombre");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("navigation", { name: "Company navigation" })).toBeVisible();
  await page.getByRole("navigation", { name: "Company navigation" }).getByRole("link", { name: "Trial balance", exact: true }).click();
  await shot(page, "balance-en");
  await page.getByRole("button", { name: "Français" }).click();
  await expect(page.getByRole("navigation", { name: "Navigation de l'entreprise" })).toBeVisible();

  // Account security: two-factor authentication (a throwaway secret of this demo database).
  await page.goto("/compte/securite");
  await page.getByRole("button", { name: "Activer la 2FA" }).click();
  await expect(page.locator("main img").first()).toBeVisible();
  const manualKey = await page.locator("code").first().innerText();
  const totp = new TOTP({ secret: Secret.fromBase32(manualKey), digits: 6, period: 30 });
  await page.getByLabel("Code à 6 chiffres").fill(totp.generate());
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await shot(page, "securite-2fa");
});
