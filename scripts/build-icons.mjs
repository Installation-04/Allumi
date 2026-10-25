// Génère toutes les icônes d'Allumi à partir d'une seule définition : le SVG maître, les PNG (navigateur, iOS,
// PWA, « maskable ») et les fichiers .ico (onglet du navigateur, client Windows). Rien n'est dessiné à la main
// ailleurs : modifier le dessin ici, puis lancer `npm run icons` et valider les fichiers produits.
//
// Le logo : une flamme (« allumé ») posée sur un signe égal (débit = crédit). Dessin original.
// Rendu par le Chromium de Playwright (PLAYWRIGHT_CHROMIUM_PATH pour en choisir un autre).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const VIEW = 512;

const DEFS = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b9b72"/><stop offset="1" stop-color="#055b45"/></linearGradient>
    <linearGradient id="fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd34d"/><stop offset="1" stop-color="#f97316"/></linearGradient>
  </defs>`;

// Flamme extérieure, flamme intérieure, puis les deux barres du signe égal.
const MARK = `<path fill="#fff" d="M268 46C296 104 380 150 380 250C380 322 326 368 256 368C186 368 132 322 132 250C132 202 156 164 186 134C188 168 206 190 226 194C208 144 232 90 268 46Z"/>
  <path fill="url(#fire)" d="M262 204C280 238 310 262 310 302C310 334 286 350 256 350C226 350 202 334 202 302C202 268 234 248 262 204Z"/>
  <rect x="132" y="396" width="248" height="26" rx="13" fill="#fff" fill-opacity=".94"/>
  <rect x="132" y="438" width="248" height="26" rx="13" fill="#fff" fill-opacity=".94"/>`;

/**
 * @param {{ size?: number, radius?: number, scale?: number }} options
 * radius : arrondi du fond (0 = plein cadre, que iOS et Android arrondissent eux-mêmes).
 * scale : réduction du dessin autour du centre (zone sûre des icônes « maskable »).
 */
function svg({ size = VIEW, radius = 112, scale = 1 } = {}) {
  const mark = scale === 1 ? MARK : `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${MARK}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}">
  <title>Allumi</title>
  ${DEFS}
  <rect width="${VIEW}" height="${VIEW}" rx="${radius}" fill="url(#bg)"/>
  ${mark}
</svg>
`;
}

/** Fichier .ico dont chaque image est un PNG (lu par Windows depuis Vista; 256 px = octet de taille 0). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
// Fenêtre de taille normale : Chromium déforme le rendu sous une quinzaine de pixels (icônes 16 et 32). On ne
// photographie que le coin de la taille voulue.
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 640, height: 640 } });

/** Rend le SVG à sa taille native (net, sans réduction d'une grande image) sur fond transparent. */
async function png(options) {
  const size = options.size;
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(options)}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${path} (${data.length} octets)`);
}

write("public/icons/allumi.svg", svg());
// iOS arrondit lui-même l'icône d'écran d'accueil : plein cadre, sans transparence.
write("public/icons/allumi-180.png", await png({ size: 180, radius: 0 }));
write("public/icons/allumi-192.png", await png({ size: 192 }));
write("public/icons/allumi-512.png", await png({ size: 512 }));
// Android recadre (cercle, goutte…) : fond plein cadre et dessin dans les 80 % centraux.
write("public/icons/allumi-maskable-512.png", await png({ size: 512, radius: 0, scale: 0.78 }));
/** Une seule page sert à tout : les rendus se font l'un après l'autre (en parallèle, ils s'écraseraient). */
async function icoFor(sizes) {
  const images = [];
  for (const size of sizes) images.push({ size, png: await png({ size }) });
  return ico(images);
}

write("public/favicon.ico", await icoFor([16, 32, 48]));
write("desktop/icon.ico", await icoFor([16, 24, 32, 48, 64, 128, 256]));

await browser.close();
