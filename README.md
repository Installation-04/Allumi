<p align="center">
  <img src="docs/images/allumi-banner-en.png" alt="Allumi — Your accounting. Your data." width="1200">
</p>

<h1 align="center">Allumi</h1>

<p align="center">
  <strong>Self-hosted accounting for small businesses in Quebec and Canada.</strong><br>
  Estimates, invoices, payments, taxes and reports, on your own server.
</p>

<p align="center">
  <a href="https://github.com/Installation-04/Allumi/actions/workflows/ci.yml"><img src="https://github.com/Installation-04/Allumi/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/Installation-04/Allumi/releases"><img src="https://img.shields.io/github/v/release/Installation-04/Allumi?include_prereleases&amp;label=version&amp;color=087f5b" alt="Latest version, including prereleases"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-087f5b" alt="MIT license"></a>
  <a href="docs/Installation-Docker.md"><img src="https://img.shields.io/badge/Docker-AMD64%20%7C%20ARM64-2496ed" alt="Docker AMD64 and ARM64"></a>
</p>

<p align="center"><strong>English</strong> · <a href="README.fr.md" lang="fr">Français</a></p>

<p align="center">
  <a href="#install-allumi"><strong>Install Allumi</strong></a> ·
  <a href="#screenshots">Explore the app</a> ·
  <a href="https://github.com/Installation-04/Allumi/wiki">Documentation</a> ·
  <a href="https://github.com/Installation-04/Allumi/releases">Downloads</a>
</p>

Allumi brings sales workflows and accounting together in a web application for small businesses and self-employed professionals. Prepare an estimate, turn it into an invoice, record a payment, reconcile transactions and review your financial reports. The app supports **English and French**, **light and dark themes**, and layouts for desktop and mobile.

You choose where to host your instance and its data. The source code is available under the **MIT license**, and the web, Windows and iPhone clients connect to the same server.

> [!NOTE]
> **Pre-alpha software.** The features below are available in prereleases intended for testing with fictional data. Review the [features and limitations](docs/Fonctionnalites-et-limites.md) before evaluating Allumi for your business.

## Install Allumi

In a **dedicated Ubuntu 22.04/24.04 VM**, open a terminal with `curl` and an account with root or `sudo` privileges, then run:

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh
```

The launcher is downloaded directly from this GitHub repository. It detects your operating system and CPU, displays a summary, asks for confirmation and retrieves the latest tagged version, **including prereleases**. It then starts the appropriate installer.

The wizard guides you through the instance address, port and language settings. On Ubuntu, the full installer can install Docker, set up the app and a private PostgreSQL database, configure the firewall and schedule encrypted backups. Images are available for **AMD64 and ARM64**. Allow at least **2 GB of RAM and 5 GB of free disk space** for the images and database.

- **Default port: `28080`.** You can change it in the wizard.
- **Local HTTPS over an IP address:** approve the internal certificate on your devices. [Set up HTTPS trust](docs/HTTPS-local.md).
- **First sign-in:** use the URL and setup token shown at the end to create the administrator and first company.
- **On Proxmox:** run the command **inside an Ubuntu VM**, not on the Proxmox host. [Proxmox guide](docs/Proxmox.md).

[Full installation guide](docs/Installation-Docker.md) · [Read the script before running it](scripts/get.sh) · [First-time setup](docs/Premier-demarrage.md)

<details>
<summary>Check compatibility, select a version or use an existing Docker installation</summary>

<br>

**Diagnostics only**, without installing or changing anything:

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --check
```

**Install a specific version:**

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --version v0.4.0-alpha.73
```

**Docker Engine and Compose v2 already installed:**

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --docker-only
```

This mode uses your existing Docker and Compose installation without configuring the firewall or scheduling backups. The launcher may install Git if it is missing on Debian/Ubuntu and the required privileges are available. See the [installation options](docs/Installation-Docker.md).

</details>

## What you can do

| For your business | In Allumi |
| --- | --- |
| **Manage sales and invoices** | [Estimates](docs/Devis.md), conversion to draft invoices, posted invoices, credit notes, customer payments and refunds. |
| **Stay in touch with customers** | Manually email [estimates](docs/Envoi-des-devis.md) and [invoices](docs/Envoi-des-factures.md) through SMTP, with previews, confirmations and history; prepare [individual reminders](docs/Relances-clients.md) for overdue invoices. |
| **Prepare recurring invoices** | [Monthly, quarterly or annual schedules](docs/Factures-recurrentes.md), confirmed draft generation, pause controls and occurrence history. |
| **Track purchases** | Supplier bills, [available supplier credits](docs/Credits-fournisseurs-disponibles.md), [bill applications with dated releases](docs/Affectation-des-credits-fournisseurs.md), expenses, partial or full payments, and [searchable payment history with CSV export](docs/Recherche-des-paiements-fournisseurs.md); customers, suppliers and a products/services catalog. |
| **Organize transactions** | Import CSV/OFX statements and Stripe/PayPal transactions, match them to journal entries, preview categorization rules, group deposits and reconcile bank accounts. |
| **Manage taxes** | Dated tax codes and rates, GST/QST/HST calculations, consultation and confirmed import of [official CRA and Revenu Québec rates](docs/Sources-fiscales-officielles.md), with provenance. |
| **Understand your finances** | Balance sheet, income statement, general ledger, trial balance, aging reports, customer/supplier statements, monthly/quarterly/annual or custom tax summaries, comparisons and CSV exports; browser printing and PDF output. |
| **Work with your team** | Multiple companies, invitations, roles and [modular permissions](docs/Utilisateurs-et-permissions.md), two-factor authentication and an audit trail. |

The accounting system uses **double-entry bookkeeping**, exact amounts in cents or Decimal, and immutable posted entries corrected through reversals. Access is enforced in the application and database, with isolation between companies.

Direct bank feeds, inventory tracking, payroll, multiple currencies, electronic signatures and scheduled execution of recurring invoices/reminders remain under development. Tax features do not file returns. [Detailed availability and limitations](docs/Fonctionnalites-et-limites.md).

## Screenshots

### Your business at a glance

The dashboard brings your company’s indicators together. Activity-based navigation gives you access to sales, expenses, transactions and reports. Shown here in English with the dark theme.

![Allumi desktop dashboard in English with the dark theme](docs/images/dashboard-en-dark-desktop.png)

### Two languages, two themes

Choose your language and appearance in the header. Your preferences are saved in your browser. The same dashboard is shown below in French with the light theme.

![Allumi desktop dashboard in French with the light theme](docs/images/tableau-de-bord-desktop.png)

### What’s new, inside the app

Open **Versions and updates** to see new features, improvements, fixes and installation instructions for your installed server version, in French or English. Notes are bundled with Allumi and include links to guides. [Release notes guide](docs/Nouveautes-des-versions.md).

![In-app release notes in English with the dark theme](docs/images/nouveautes-versions-en-dark-desktop.png)

### Sales-tax reports for your reporting period

Choose monthly, quarterly or annual calendar periods, or enter custom dates for your filing schedule. The report and CSV use the same inclusive dates and recorded tax amounts. [Tax reporting guide](docs/Sommaire-des-taxes.md).

Compare posted sales taxes across two periods, with exact changes, separate settlements and ledger checks for each period. Export private aggregates or print a browser PDF. [Tax comparison guide](docs/Comparaison-des-taxes.md).

![Tax period comparison in English and dark theme](docs/images/taxes-comparatif-periodes-en-dark-desktop.png)

![Quarterly tax report in English with the dark theme](docs/images/taxes-periodes-trimestre-en-dark-desktop.png)

### Print supplier documents

Open an internal accounting copy of a posted or voided supplier bill or credit, then print or save it as PDF. Frozen supplier details and exact recorded amounts are included; private notes are excluded. [Printing guide](docs/Impression-des-achats.md).

![Supplier credit accounting copy in English with the dark theme](docs/images/achats-impression-credit-en-dark-desktop.png)

### Apply supplier credits

Apply available supplier credits to bills for the same supplier, with reviewed balances and dated releases. [Application guide](docs/Affectation-des-credits-fournisseurs.md).

![Supplier credit application in English with the dark theme](docs/images/affectation-credit-fournisseur-en-dark-desktop.png)

### Refunds received from suppliers

Record money already received against an available supplier credit, review its origins and reverse it on a chosen date. Supplier balances and historical reports stay aligned; taxes are preserved. [Supplier refund guide](docs/Remboursements-fournisseurs.md).

![Supplier refund in English with the dark theme](docs/images/remboursement-fournisseur-en-dark-desktop.png)

Export all filtered supplier refunds to CSV, including results beyond the displayed page. Exact amounts, original dates and current status are included; private notes are excluded. [Refund export guide](docs/Export-des-remboursements-fournisseurs.md).

![Supplier refund CSV filters in English with the dark theme](docs/images/export-remboursements-fournisseurs-en-dark-desktop.png)

Print a private accounting copy of a supplier refund, including the original amount, all credit origins and any reversal date. Save it as PDF with your browser, in English or French. [Refund printing guide](docs/Impression-des-remboursements-fournisseurs.md).

![Supplier refund accounting copy in English and dark theme](docs/images/impression-remboursement-fournisseur-en-dark-desktop.png)

Find authorized matches while typing in the header: up to eight suggestions, keyboard/touch navigation and full-search fallback. [Search suggestions guide](docs/Suggestions-de-recherche.md).

![Search suggestions in English with dark theme](docs/images/suggestions-recherche-en-dark-desktop.png)

### Reuse a budget

Duplicate annual targets into a new scenario or fiscal year after reviewing the source. Inactive targets require explicit exclusion; stale previews are refused. The source stays independent and no journal entries are created. [Guide](https://github.com/Installation-04/Allumi/wiki/Duplication-des-budgets).

![Budget copy preview in English with dark theme](docs/images/duplication-budget-en-dark-desktop.png)

[Mobile reference](docs/images/duplication-budget-en-dark-mobile.png)

### Annual budgets

Create fiscal-year scenarios, set revenue and expense targets, and compare them with posted actuals. Missing targets remain visible; concurrent changes are refused. Export exact CSV in English or French. Annual totals include all dated entries in the fiscal year; monthly forecasting is not included. [Guide](https://github.com/Installation-04/Allumi/wiki/Budgets-annuels).

![Annual budget in English with dark theme](docs/images/budgets-annuels-en-dark-desktop.png)

[Mobile reference](docs/images/budgets-annuels-en-dark-mobile.png)


Find 13 existing financial report forms by French/English names and explicit synonyms, with destinations filtered by your permissions. [Report search guide](docs/Recherche-des-rapports.md).

![Report search in English with dark theme](docs/images/recherche-rapports-en-dark-desktop.png)

Search imported CAD bank transactions by statement description/payee, date, current state and exact net amount. Signed amounts and direct detail links are preserved. [Bank search guide](docs/Recherche-bancaire.md).

![Bank search in English with dark theme](docs/images/recherche-bancaire-en-dark-desktop.png)

Compare existing imported or manually configured tax codes with official standard rates for a province and date. Review exact component differences and dated coverage in a read-only view. [Official-rate comparison guide](docs/Comparaison-des-codes-fiscaux.md).

![Official-rate comparison in English with dark theme](docs/images/comparaison-code-fiscal-en-dark-desktop.png)

Find ledger accounts in either language and open their history, including inactive accounts. Search manual/opening entries and reversals by journal number, date and exact total debits, without searching private notes. [Accounting search guide](docs/Recherche-comptable.md).

![Accounting search in English with dark theme](docs/images/recherche-comptable-ecriture-en-dark-desktop.png)

### Supplier payment history

Find payments by supplier, number or reference, narrow the dates and status, and export all matching results to CSV. [Payment history guide](docs/Recherche-des-paiements-fournisseurs.md).

![Supplier payment filters and CSV export in English with the dark theme](docs/images/decaissements-recherche-en-dark-desktop.png)

### On your phone, too

<table>
  <tr>
    <td align="center"><strong>Dashboard · French, light</strong></td>
    <td align="center"><strong>Contacts · English, dark</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tableau-de-bord-mobile.png" alt="Allumi mobile dashboard in French with the light theme" width="280"></td>
    <td align="center"><img src="docs/images/contacts-en-dark-mobile.png" alt="Allumi mobile contacts in English with the dark theme" width="280"></td>
  </tr>
</table>

Real application screenshots using fictional data; mobile views are emulated in Chromium. [Explore the full screenshot gallery in the wiki](https://github.com/Installation-04/Allumi/wiki/References-visuelles).

## Choose how you connect

| Access | How to use it |
| --- | --- |
| **Web browser** | Open your server URL on a desktop, tablet or phone. |
| **Windows x64** | Download the `.exe` installer from [Releases](https://github.com/Installation-04/Allumi/releases), then connect the client to your server. [Windows guide](docs/Client-Windows.md). |
| **iPhone / iPad** | In Safari, choose **Share → Add to Home Screen**, then open Allumi from its icon. [iOS guide](docs/Application-mobile.md). |
| **Docker server** | Deploy the Linux AMD64/ARM64 images on your own infrastructure. [Docker guide](docs/Installation-Docker.md). |

The Windows client and home-screen web app require a connection to the server; they are not offline accounting applications.

## Run your instance

Authorized operators can view the installed version and request a server update from the administration pages, confirming the backup and service interruption first. The installer enables the web update agent by default on compatible Linux hosts when run as root with Python 3 and active systemd. For existing installations, follow the [update guide](docs/Mise-a-jour.md).

Encrypted backups, restoration, operation logs and administration roles are covered in the wiki. Server and Windows client updates are separate; the browser and iOS web app follow the server version.

[Server administration](docs/Administration-serveur.md) · [Backup and restore](docs/Sauvegardes.md) · [Security](SECURITY.md)

## Documentation and contributing

Most detailed guides are currently in French; the app interface supports both English and French. A [French version of this page](README.fr.md) is also available.

- **Get started:** [user guide](docs/Guide-utilisateur.md), [GitHub wiki](https://github.com/Installation-04/Allumi/wiki), [FAQ](docs/FAQ.md) and [English language and appearance guide](docs/Appearance-and-language.md).
- **Install and configure:** [Docker](docs/Installation-Docker.md), [Proxmox](docs/Proxmox.md), [configuration](docs/Configuration.md) and [troubleshooting](docs/Depannage.md).
- **Develop and contribute:** [local development](docs/Developpement-local.md), [cloud environment](docs/Developpement-cloud.md), [architecture](docs/Architecture.md) and [contribution guide](CONTRIBUTING.md).
- **Follow the project:** [versions and changelog](CHANGELOG.md), [public roadmap](docs/Feuille-de-route.md) and [issue tracker](https://github.com/Installation-04/Allumi/issues).

Source documentation and screenshots live in [`docs/`](docs/). Suggestions, fixes, translations and testing feedback are welcome.

## License

Allumi is released under the [MIT license](LICENSE). It does not replace professional accounting or tax advice; check the rules and rates that apply to your situation.
