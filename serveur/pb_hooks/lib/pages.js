/*
 * Sokoyetu — pages servies par le serveur pour le référencement et les partages (WhatsApp, Facebook) :
 * aperçus d'articles, de paniers partagés et de rayons, plan du site, catalogue public en une seule requête.
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

/* Image d'aperçu d'un article : sa carte (logo de la boutique et photo, 1200 × 630, faite par l'administration),
   sinon sa photo principale, sinon l'image de la boutique. */
function imageArticle(doc, racine) {
  const c = doc && doc.share;
  if (c && c.type === 'pb' && c.id && c.f) return { image: urlImage(c, racine, false), largeur: 1200, hauteur: 630 };
  const photo = urlImage(R.imagePrincipale(doc), racine, true);
  return photo ? { image: photo } : IMAGE_BOUTIQUE(racine);
}
const IMAGE_BOUTIQUE = (racine) => ({ image: racine + '/og-image.png', largeur: 1200, hauteur: 630 });
/* « Bukavu et Goma » (zones de livraison hors retrait), sinon la ville de la boutique. */
function villesLivrees(cfg) {
  const l = (cfg.zones || []).filter((z) => !R.estRetrait(z)).map((z) => z.name);
  return l.length ? (l.length > 1 ? l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1] : l[0]) : cfg.city;
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
    m.largeur && m.hauteur ? `<meta property="og:image:width" content="${m.largeur}"><meta property="og:image:height" content="${m.hauteur}">` : '',
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
    return e.html(200, avecSeo(indexHtml(), Object.assign({ titre: `Article introuvable · ${cfg.name}`, description: cfg.tagline, url: racine + '/', boutique: cfg.name, noindex: true }, IMAGE_BOUTIQUE(racine))));
  }
  const pa = R.prixAffiche(doc, '', '', Date.now());
  const prix = (pa.des ? 'dès ' : '') + R.dollars(pa.prix);
  const imp = R.estImport(doc);
  const description = `${prix}${imp ? ` · Import Chine, livré en ~${cfg.importDays} jours` : ` · En stock à ${cfg.city}`} · Paiement Mobile Money. ${String(doc.description || '').replace(/\s+/g, ' ').slice(0, 110)}`.trim();
  const img = R.imagePrincipale(doc);
  return e.html(200, avecSeo(indexHtml(), Object.assign({
    titre: `${doc.title} · ${prix} · ${cfg.name}`, titreCourt: `${doc.title} · ${prix}`, description: description.slice(0, 200),
    url: `${racine}/p/${encodeURIComponent(id)}/${R.slug(doc.title)}`,
    imageAlt: (img && img.alt) || doc.title, boutique: cfg.name, type: 'product', prix: pa.prix.toFixed(2)
  }, imageArticle(doc, racine))));
}

/*
 * Panier partagé (/panier/partage?a=…) : l'aperçu annonce les articles disponibles et le total estimé du jour (même calcul que
 * le message envoyé et que la page), avec l'image du premier article en vente. Le lien ne contient que des articles : jamais référencé.
 */
function pagePanier(e) {
  const racine = base(e);
  const cfg = S.configuration(e.app);
  const lignes = R.panierDepuisLien(String(e.request.url.rawQuery || ''));
  const P = S.lecteurProduits(e.app);
  const enVente = (id) => { const rec = P.rec(id); const d = rec && rec.getBool('active') ? P.doc(id) : null; return d && R.estEnVente(d) ? d : null; };
  const a = R.apercuPartage({ cfg, produit: enVente, lignes, maintenant: Date.now() });
  if (!a.disponibles.length) return e.html(200, avecSeo(indexHtml(), Object.assign({ titre: `Panier partagé · ${cfg.name}`, description: cfg.tagline, url: racine + '/', boutique: cfg.name, noindex: true }, IMAGE_BOUTIQUE(racine))));
  const resume = `${R.pluriel(a.n, 'article')} · ${R.dollars(a.total)}`;
  const noms = a.disponibles.slice(0, 3).map((x) => x.title + (x.qty > 1 ? ` ×${x.qty}` : ''));
  const reste = a.disponibles.length - noms.length;
  const premier = enVente(a.disponibles[0].productId);
  return e.html(200, avecSeo(indexHtml(), Object.assign({
    titre: `Panier partagé · ${resume} · ${cfg.name}`, titreCourt: `Panier partagé · ${resume}`,
    description: `${noms.join(', ')}${reste > 0 ? ` et ${R.pluriel(reste, 'autre article', 'autres articles')}` : ''}. Livraison à ${villesLivrees(cfg)}, paiement Mobile Money.`.slice(0, 200),
    url: `${racine}/panier/partage?${R.lienPanier(lignes)}`, imageAlt: premier.title, boutique: cfg.name, noindex: true
  }, imageArticle(premier, racine))));
}

function pageRayon(e) {
  const racine = base(e);
  const cfg = S.configuration(e.app);
  const segments = String(e.request.url.path || '').split('/').filter(Boolean);
  const id = R.valider.identifiant(decodeURIComponent(segments[1] || ''));
  let doc = null;
  if (id) { try { doc = S.lire(e.app.findRecordById('collections', id)); } catch (err) { } }
  if (!doc || doc.visible === false) return e.html(200, avecSeo(indexHtml(), Object.assign({ titre: `${cfg.name} · ${cfg.tagline}`, description: cfg.tagline, url: racine + '/', boutique: cfg.name, noindex: true }, IMAGE_BOUTIQUE(racine))));
  return e.html(200, avecSeo(indexHtml(), Object.assign({
    titre: `${doc.name} · ${cfg.name}`, description: `${doc.name} chez ${cfg.name} : livraison à Bukavu et Goma, paiement Mobile Money, import Chine en ~${cfg.importDays} jours.`,
    url: `${racine}/c/${encodeURIComponent(id)}/${R.slug(doc.name)}`, boutique: cfg.name
  }, urlImage(doc.image, racine, true) ? { image: urlImage(doc.image, racine, true) } : IMAGE_BOUTIQUE(racine))));
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
/*
 * Catalogue public, gardé en mémoire : reconstruit au plus une fois toutes les 30 secondes, et dès la première visite
 * qui suit un changement (article, stock, rayon, bannière, réglages : voir catalogueChange, appelé par sokoyetu.pb.js).
 * Quand beaucoup de visiteurs arrivent ensemble, un seul le reconstruit ; les autres reçoivent aussitôt la version
 * d'avant (vieille de quelques instants : prix et stock sont de toute façon revérifiés au devis et à la commande).
 */
const VIE_CATALOGUE = 30000;
function catalogue(e) {
  const st = $app.store();
  let json = st.get('catalogue:json'), etag = st.get('catalogue:etag');
  if (!json || Date.now() - Number(st.get('catalogue:t') || 0) > VIE_CATALOGUE) {
    const moi = $security.randomString(16);
    const seul = st.getOrSet('catalogue:verrou', () => moi) === moi;
    if (seul || !json) {
      try {
        json = JSON.stringify(construireCatalogue(e.app)); etag = '"' + $security.md5(json) + '"';
        st.set('catalogue:json', json); st.set('catalogue:etag', etag); st.set('catalogue:t', Date.now());
      } finally { if (seul) st.remove('catalogue:verrou'); }
    }
  }
  e.response.header().set('ETag', etag);
  e.response.header().set('Cache-Control', 'no-cache');
  if (String(e.request.header.get('If-None-Match') || '') === etag) return e.noContent(304);
  return e.blob(200, 'application/json; charset=utf-8', json);
}
/* Un article, un rayon, une bannière ou les réglages ont changé : le catalogue sera reconstruit à la prochaine visite. */
function catalogueChange() { $app.store().set('catalogue:t', 0); }

function construireCatalogue(app) {
  const liste = (col, filtre) => app.findRecordsByFilter(col, filtre, '', 10000, 0).map(S.versRecord);
  let config = null;
  try { config = S.versRecord(app.findRecordById('config', 'store')); } catch (err) { }
  // Le fournisseur de paiement (sans aucune clé) : la boutique n'affiche que les moyens réellement encaissables.
  const cfg = S.configuration(app);
  // Comptes clients : proposés seulement si l'envoi des codes (WhatsApp ou SMS) est prêt ; sinon, commande sans compte.
  const codes = require(`${__hooks}/lib/envoi.js`).etat();
  config = Object.assign({ id: 'store' }, config || {}, {
    payment: { provider: cfg.payment.provider, holdMinutes: cfg.payment.holdMinutes, test: cfg.payment.provider === 'simulation' },
    accounts: { open: codes.pret, test: codes.test, channels: codes.canaux }
  });
  // Note moyenne et nombre d'avis publiés de chaque article (lib/avis.js).
  const notes = cfg.reviews.enabled ? require(`${__hooks}/lib/avis.js`).resumes(app) : {};
  return {
    config,
    collections: liste('collections', 'id != ""'),
    banners: liste('banners', 'id != ""'),
    products: liste('products', 'active = true').map((d) => Object.assign(S.produitPublic(d), notes[d.id] ? { avis: notes[d.id] } : {}))
  };
}

module.exports = { pageArticle, pagePanier, pageRayon, planDuSite, catalogue, catalogueChange, avecSeo, urlImage };
