// Sokoyetu — génère les icônes d'application et l'image de partage à partir des SVG de medias/marque (Chromium).
//   node outils/images-marque.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = join(RACINE, 'medias', 'marque');
const B = join(RACINE, 'src', 'boutique', 'public');
const A = join(RACINE, 'src', 'admin', 'public');
await mkdir(B, { recursive: true }); await mkdir(A, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage();
async function png(svgFichier, taille, sortie) {
  const svg = await readFile(join(M, svgFichier), 'utf8');
  await page.setViewportSize({ width: taille, height: taille });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${taille}" height="${taille}" `)}</body></html>`);
  await page.screenshot({ path: sortie, omitBackground: true, clip: { x: 0, y: 0, width: taille, height: taille } });
}
for (const [svg, dest, prefixe] of [['icone.svg', B, 'icone'], ['admin.svg', A, 'icone']]) {
  await png(svg, 192, join(dest, `${prefixe}-192.png`));
  await png(svg, 512, join(dest, `${prefixe}-512.png`));
  await png(svg, 180, join(dest, 'apple-touch-icon.png'));
  await png(svg, 32, join(dest, 'favicon-32.png'));
}
await png('icone-masquable.svg', 512, join(B, 'icone-masquable-512.png'));
await png('admin-masquable.svg', 512, join(A, 'icone-masquable-512.png'));

// Image de partage (WhatsApp, Facebook) : le port, la marque, la promesse.
const police = (await readFile(join(RACINE, 'src/commun/polices/fraunces.woff2'))).toString('base64');
const policeTexte = (await readFile(join(RACINE, 'src/commun/polices/plus-jakarta-sans.woff2'))).toString('base64');
const port = (await readFile(join(RACINE, 'medias/photos/ban-port.webp'))).toString('base64');
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><head><style>
@font-face{font-family:F;src:url(data:font/woff2;base64,${police}) format('woff2');font-weight:100 900}
@font-face{font-family:J;src:url(data:font/woff2;base64,${policeTexte}) format('woff2');font-weight:200 800}
body{margin:0;width:1200px;height:630px;position:relative;overflow:hidden;font-family:J;color:#fff}
.f{position:absolute;inset:0;background:url(data:image/webp;base64,${port}) center/cover}
.v{position:absolute;inset:0;background:linear-gradient(90deg,rgba(22,14,9,.88) 0%,rgba(22,14,9,.62) 52%,rgba(22,14,9,.15) 100%)}
.c{position:absolute;left:84px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:18px;width:720px}
.k{display:inline-flex;align-self:flex-start;align-items:center;gap:10px;height:40px;padding:0 18px;border-radius:99px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);font-weight:800;font-size:17px;letter-spacing:.06em;text-transform:uppercase}
.m{font-family:F;font-weight:640;font-size:132px;letter-spacing:-.035em;line-height:.95}.m i{font-style:normal;color:#C8902E}
.t{font-size:34px;font-weight:600;line-height:1.25;color:rgba(255,255,255,.94)}
.p{display:flex;gap:12px;margin-top:10px}.p span{height:46px;padding:0 20px;border-radius:99px;background:#FFF8F1;color:#1E1611;font-weight:750;font-size:19px;display:flex;align-items:center}
</style></head><body><div class="f"></div><div class="v"></div><div class="c"><span class="k">Chine → Bukavu · Goma</span><div class="m">Sokoyetu<i>.</i></div><div class="t">Vos achats en Chine, dédouanés et livrés chez vous.</div><div class="p"><span>Paiement Mobile Money</span><span>Livraison à domicile</span></div></div></body></html>`);
await page.waitForTimeout(300);
await page.screenshot({ path: join(B, 'og-image.png') });
await b.close();
console.log('Icônes et image de partage générées.');
