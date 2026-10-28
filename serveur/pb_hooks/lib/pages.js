/*
 * Sokoyetu — pages servies par le serveur pour le référencement et les partages (WhatsApp, Facebook) :
 * aperçus d'articles et de rayons, plan du site, catalogue public en une seule requête.
 */
const S = require(`${__hooks}/lib/serveur.js`);
const R = S.R;

const attr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (e) => 'https://' + String(e.request.host || 'sokoyakwetu.com').toLowerCase().split(':')[0].replace(/^www\./, '');

function urlImage(m, racine, grande) {
  if (!m) return '';
  if (m.type === 'pb' && m.id && m.f) return `${racine}/api/files/media/${encodeURIComponent(m.id)}/${encodeURIComponent(m.f)}${grande ? '?thumb=1200x0' : ''}`;
  if (m.type === 'url' && m.src) return /^https:\/\//.test(m.src) ? m.src : racine + '/' + String(m.src).replace(/^\/+/, '');
  return '';
}

function indexHtml() {
  return toString($os.readFile(`${__hooks}/../pb_public/index.html`));
}

/* Remplace le bloc <!--seo-->…<!--/seo--> de la boutique par les balises propres à la page. */
function avecSeo(html, m) {
  const bloc = [
    `<title>${attr(m.titre)}</title>`,
    `<meta name="description" content="${attr(m.description)}">`,
    `<link rel="canonical" href="${attr(m.url)}">`,
    `<meta property="og:type" content="${m.type || 'website'}">`,
    `<meta property="og:site_name" content="${attr(m.boutique)}">`,
    `<meta property="og:locale" content="fr_CD">`,
    `<meta property="og:title" content="${attr(m.titreCourt || m.titre)}">`,
    `<meta property="og:description" content="${attr(m.description)}">`,
    `<meta property="og:url" content="${attr(m.url)}">`,
    `<meta property="og:image" content="${attr(m.image)}">`,
    m.imageAlt ? `<meta property="og:image:alt" content="${attr(m.imageAlt)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    m.prix ? `<meta property="product:price:amount" content="${attr(m.prix)}"><meta property="product:price:currency" content="USD">` : '',
    m.noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow">'
  ].filter(Boolean).join('');
  const a = html.indexOf('<!--seo-->'), b = html.indexOf('<!--/seo-->');
  if (a < 0 || b < a) return html;
  return html.slice(0, a) + '<!--seo-->' + bloc + html.slice(b);
}

function pageArticle(e) {
  const racine = base(e);
  const cfg = S.configuration(e.app);
  const segments = String(e.request.url.path || '').split('/').filter(Boolean); // ['p', id, slug?]
  const id = R.valider.identifiant(decodeURIComponent(segments[1] || ''));
  let doc = null;
  if (id) { try { const rec = e.app.findRecordById('products', id); if (rec.getBool('active')) doc = S.lire(rec); } catch (err) { } }
  if (!doc || !R.estEnVente(doc)) {
    return e.html(200, avecSeo(indexHtml(), { titre: `Article introuvable · ${cfg.name}`, description: cfg.tagline, url: racine + '/', image: racine + '/og-image.png', boutique: cfg.name, noindex: true }));
  }
  const pa = R.prixAffiche(doc, '', '', Date.now());
  const prix = (pa.des ? 'dès ' : '') + R.dollars(pa.prix);
  const imp = R.estImport(doc);
  const description = `${prix}${imp ? ` · Import Chine, livré en ~${cfg.importDays} jours` : ` · En stock à ${cfg.city}`} · Paiement Mobile Money. ${String(doc.description || '').replace(/\s+/g, ' ').slice(0, 110)}`.trim();
  const img = R.imagePrincipale(doc);
  return e.html(200, avecSeo(indexHtml(), {
    titre: `${doc.title} · ${prix} · ${cfg.name}`, titreCourt: `${doc.title} · ${prix}`, description: description.slice(0, 200),
    url: `${racine}/p/${encodeURIComponent(id)}/${R.slug(doc.title)}`, image: urlImage(img, racine, true) || racine + '/og-image.png',
    imageAlt: (img && img.alt) || doc.title, boutique: cfg.name, type: 'product', prix: pa.prix.toFixed(2)
  }));
}

function pageRayon(e) {
  const racine = base(e);
  const cfg = S.configuration(e.app);
  const segments = String(e.request.url.path || '').split('/').filter(Boolean);
  const id = R.valider.identifiant(decodeURIComponent(segments[1] || ''));
  let doc = null;
  if (id) { try { doc = S.lire(e.app.findRecordById('collections', id)); } catch (err) { } }
  if (!doc || doc.visible === false) return e.html(200, avecSeo(indexHtml(), { titre: `${cfg.name} · ${cfg.tagline}`, description: cfg.tagline, url: racine + '/', image: racine + '/og-image.png', boutique: cfg.name, noindex: true }));
  return e.html(200, avecSeo(indexHtml(), {
    titre: `${doc.name} · ${cfg.name}`, description: `${doc.name} chez ${cfg.name} : livraison à Bukavu et Goma, paiement Mobile Money, import Chine en ~${cfg.importDays} jours.`,
    url: `${racine}/c/${encodeURIComponent(id)}/${R.slug(doc.name)}`, image: urlImage(doc.image, racine, true) || racine + '/og-image.png', boutique: cfg.name
  }));
}

function planDuSite(e) {
  const racine = base(e);
  const jour = (t) => { try { return new Date(t).toISOString().slice(0, 10); } catch (err) { return ''; } };
  const urls = [{ loc: racine + '/', freq: 'daily', prio: '1.0' }, { loc: racine + '/nouveautes', freq: 'daily', prio: '0.8' }, { loc: racine + '/categories', freq: 'weekly', prio: '0.6' },
    { loc: racine + '/en-stock', freq: 'daily', prio: '0.8' }, { loc: racine + '/import-chine', freq: 'daily', prio: '0.8' }];
  e.app.findRecordsByFilter('collections', 'id != ""', '', 500, 0).forEach((rec) => {
    const d = S.lire(rec); if (d.visible === false) return;
    urls.push({ loc: `${racine}/c/${rec.id}/${R.slug(d.name)}`, freq: 'weekly', prio: '0.7', mod: jour(rec.getString('updated').replace(' ', 'T')) });
  });
  e.app.findRecordsByFilter('products', 'active = true', '-updated', 5000, 0).forEach((rec) => {
    const d = S.lire(rec);
    urls.push({ loc: `${racine}/p/${rec.id}/${R.slug(d.title)}`, freq: 'weekly', prio: '0.6', mod: jour(rec.getString('updated').replace(' ', 'T')) });
  });
  ['conditions', 'retours', 'confidentialite', 'mentions-legales'].forEach((k) => urls.push({ loc: `${racine}/infos/${k}`, freq: 'monthly', prio: '0.2' }));
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${attr(u.loc)}</loc>${u.mod ? `<lastmod>${u.mod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`).join('\n') + '\n</urlset>\n';
  e.response.header().set('Cache-Control', 'public, max-age=3600');
  return e.blob(200, 'application/xml; charset=utf-8', xml);
}

/* Le catalogue public complet en une seule réponse (au lieu de quatre), avec validation de cache. */
function catalogue(e) {
  const liste = (col, filtre) => e.app.findRecordsByFilter(col, filtre, '', 10000, 0).map(S.versRecord);
  let config = null;
  try { config = S.versRecord(e.app.findRecordById('config', 'store')); } catch (err) { }
  // Le fournisseur de paiement (sans aucune clé) : la boutique n'affiche que les moyens réellement encaissables.
  const cfg = S.configuration(e.app);
  // Comptes clients : proposés seulement si l'envoi des codes (WhatsApp ou SMS) est prêt ; sinon, commande sans compte.
  const codes = require(`${__hooks}/lib/envoi.js`).etat();
  config = Object.assign({ id: 'store' }, config || {}, {
    payment: { provider: cfg.payment.provider, holdMinutes: cfg.payment.holdMinutes, test: cfg.payment.provider === 'simulation' },
    accounts: { open: codes.pret, test: codes.test, channels: codes.canaux }
  });
  const donnees = {
    config,
    collections: liste('collections', 'id != ""'),
    banners: liste('banners', 'id != ""'),
    products: liste('products', 'active = true').map(S.produitPublic)
  };
  const json = JSON.stringify(donnees);
  const etag = '"' + $security.md5(json) + '"';
  e.response.header().set('ETag', etag);
  e.response.header().set('Cache-Control', 'no-cache');
  if (String(e.request.header.get('If-None-Match') || '') === etag) return e.noContent(304);
  return e.blob(200, 'application/json; charset=utf-8', json);
}

module.exports = { pageArticle, pageRayon, planDuSite, catalogue, avecSeo, urlImage };
