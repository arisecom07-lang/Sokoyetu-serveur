/*
 * Sokoyetu — import d'articles depuis un site fournisseur (1688, Alibaba, AliExpress, Taobao…) et copie de photos par adresse.
 * Réservé à l'administration. La page du fournisseur est lue côté serveur : titre, photos, prix d'usine.
 * Ces sites changent souvent et demandent parfois une connexion : en cas d'échec, l'administration propose la photo + l'assistant IA.
 */
const SITES = ['1688.com', 'alibaba.com', 'aliexpress.com', 'aliexpress.us', 'taobao.com', 'tmall.com', 'temu.com', 'shein.com', 'made-in-china.com', 'dhgate.com'];
const MAX_PHOTOS = 12;
const MAX_OCTETS = 10 * 1048576; // photo copiée depuis un fournisseur : 10 Mo au plus

const hoteDe = (url) => { const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || '').trim()); return m ? m[1].toLowerCase() : ''; };
const surSite = (hote, sites) => sites.some((s) => hote === s || hote.slice(-(s.length + 1)) === '.' + s);

/* Adresse d'une page produit acceptée ('' sinon) : https, sur un site fournisseur connu. */
function adresseFournisseur(url) {
  const u = String(url || '').trim().replace(/^http:\/\//i, 'https://');
  if (!/^https:\/\/[^\s]+$/i.test(u) || u.length > 600) return '';
  return surSite(hoteDe(u), SITES) ? u : '';
}

/* Adresse d'une photo à copier : http(s) publique, jamais une adresse du réseau local. */
function adressePhoto(url) {
  const u = String(url || '').trim().replace(/^\/\//, 'https://');
  if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 1000) return '';
  const h = hoteDe(u);
  if (!h || h === 'localhost' || /\.(local|internal|localhost)$/.test(h) || h.indexOf(':') >= 0 || /^\[/.test(h)) return '';
  if (/^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^\d+$/.test(h)) return '';
  return u;
}

function decoder(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10))).replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/').replace(/\s+/g, ' ').trim();
}
function meta(html, nom) {
  const a = new RegExp('<meta[^>]+(?:property|name)=["\']' + nom + '["\'][^>]*content=["\']([^"\']*)["\']', 'i').exec(html);
  const b = a || new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + nom + '["\']', 'i').exec(html);
  return b ? decoder(b[1]) : '';
}
/* Photo en grand : sans le suffixe de miniature des CDN chinois (…jpg_220x220.jpg, …_50x50q90.jpg). */
function photoEnGrand(src) {
  let u = decoder(src).replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://');
  u = u.replace(/(\.(?:jpe?g|png|webp))_[^/]*$/i, '$1').replace(/_\d+x\d+(?:q\d+)?(\.(?:jpe?g|png|webp))$/i, '$1').replace(/\?.*$/, '');
  return u;
}
function blocsJsonLd(html) {
  const out = []; const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { try { const j = JSON.parse(m[1]); (Array.isArray(j) ? j : [j]).forEach((x) => out.push(x)); } catch (e) { } }
  return out;
}

/*
 * Lit une page produit : { title, description, images, price, currency }.
 * Fonction pure (testée hors serveur) : html = texte de la page, url = son adresse.
 */
function extraire(html, url) {
  html = String(html || '').slice(0, 3000000);
  const hote = hoteDe(url);
  const ld = blocsJsonLd(html).find((x) => x && /Product/i.test(String(x['@type'] || ''))) || {};
  const offre = Array.isArray(ld.offers) ? ld.offers[0] || {} : ld.offers || {};
  const titreBrut = ld.name || meta(html, 'og:title') || meta(html, 'twitter:title') || ((/"subject"\s*:\s*"([^"]{4,200})"/.exec(html) || [])[1]) || ((/<title[^>]*>([^<]{2,200})<\/title>/i.exec(html) || [])[1]) || '';
  const title = decoder(titreBrut).replace(/\s*[-|_–]\s*(1688|阿里巴巴|Alibaba|AliExpress|淘宝|天猫|Temu|SHEIN)[^-|_–]*$/i, '').slice(0, 200);
  const description = decoder(ld.description || meta(html, 'og:description') || meta(html, 'description')).slice(0, 1500);

  const images = []; const ajouter = (src) => {
    if (!src || images.length >= MAX_PHOTOS) return;
    const u = photoEnGrand(src);
    if (!/^https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp)$/i.test(u) || /(sprite|icon|logo|avatar|loading|placeholder|blank|tps-\d+-\d+)/i.test(u)) return;
    if (images.indexOf(u) < 0) images.push(u);
  };
  (Array.isArray(ld.image) ? ld.image : [ld.image]).forEach((x) => ajouter(typeof x === 'string' ? x : x && x.url));
  ajouter(meta(html, 'og:image'));
  const re = /(?:https?:)?\/\/[a-z0-9.-]*(?:alicdn\.com|aliexpress-media\.com|ltwebstatic\.com|kwcdn\.com|1688\.com)\/[^"'\s<>()\\]+?\.(?:jpe?g|png|webp)(?:_[^"'\s<>()\\]*)?/gi;
  let m; while ((m = re.exec(html)) && images.length < MAX_PHOTOS) ajouter(m[0]);

  let price = parseFloat(offre.price || offre.lowPrice || meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || '');
  let currency = String(offre.priceCurrency || meta(html, 'product:price:currency') || '').toUpperCase();
  if (!(price > 0)) {
    const p = /"(?:price|salePrice|minPrice|priceRange[^"]*|beginAmount)"\s*:\s*"?(\d{1,6}(?:\.\d{1,2})?)/i.exec(html) || /[¥￥]\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(html) || /US\s?\$\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(html);
    price = p ? parseFloat(p[1]) : 0;
  }
  if (!/^[A-Z]{3}$/.test(currency)) currency = surSite(hote, ['1688.com', 'taobao.com', 'tmall.com']) ? 'CNY' : 'USD';
  return { title, description, images, price: price > 0 ? Math.round(price * 100) / 100 : 0, currency };
}

/* Texte lisible pour l'assistant : titre, description et caractéristiques trouvées sur la page. */
function texteDe(html, lu) {
  const attributs = [];
  const re = /"(?:attributeName|attrName|name)"\s*:\s*"([^"]{1,30})"\s*,\s*"(?:value|attrValue|values?)"\s*:\s*"([^"]{1,60})"/g; let m;
  while ((m = re.exec(String(html || ''))) && attributs.length < 25) attributs.push(decoder(m[1]) + ' : ' + decoder(m[2]));
  return [lu.title, lu.description, attributs.join('\n')].filter(Boolean).join('\n').slice(0, 2500);
}

/* Lit la page d'un fournisseur. Lève { code, status } : bad_url, blocked, network. */
function lirePage(url) {
  const u = adresseFournisseur(url);
  if (!u) throw { code: 'bad_url', status: 400 };
  let res;
  try {
    res = $http.send({ url: u, method: 'GET', timeout: 25, headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
      'accept': 'text/html,application/xhtml+xml', 'accept-language': 'fr,en;q=0.8,zh-CN;q=0.6'
    } });
  } catch (err) { throw { code: 'network', status: 502 }; }
  if (res.statusCode >= 400) throw { code: 'blocked', status: 502 };
  const html = typeof res.body === 'string' ? res.body : res.body ? toString(res.body) : String(res.raw || '');
  const lu = extraire(html, u);
  // Page de connexion ou de vérification (fréquent sur 1688 et Taobao) : rien d'utile à lire.
  if (!lu.images.length && !lu.price) throw { code: 'blocked', status: 502 };
  return { url: u, lu, texte: texteDe(html, lu) };
}

/* Copie une photo dans la médiathèque de la boutique : { type: 'pb', id, f }. */
function copierPhoto(app, url) {
  const u = adressePhoto(url);
  if (!u) throw { code: 'bad_url', status: 400 };
  // Taille annoncée par le site avant de télécharger : une « photo » de plusieurs centaines de Mo ne passe pas.
  try {
    const tete = $http.send({ url: u, method: 'HEAD', timeout: 10 });
    const taille = Number(tete.headers && (tete.headers['Content-Length'] || tete.headers['content-length']) && [].concat(tete.headers['Content-Length'] || tete.headers['content-length'])[0]);
    if (taille > MAX_OCTETS) throw { code: 'too_big', status: 400 };
  } catch (err) { if (err && err.code === 'too_big') throw err; /* certains sites refusent HEAD : on télécharge quand même */ }
  let fichier;
  try { fichier = $filesystem.fileFromURL(u, 30); } catch (err) { throw { code: 'network', status: 502 }; }
  if (Number(fichier.size) > MAX_OCTETS) throw { code: 'too_big', status: 400 };
  const rec = new Record(app.findCollectionByNameOrId('media'));
  rec.set('file', fichier);
  try { app.save(rec); } catch (err) { throw { code: 'not_image', status: 400 }; }
  // La médiathèque accepte aussi les vidéos : une « photo » qui n'en est pas une est retirée.
  if (!/\.(jpe?g|png|webp|gif)$/i.test(rec.getString('file'))) { try { app.delete(rec); } catch (err) { } throw { code: 'not_image', status: 400 }; }
  return { type: 'pb', id: rec.id, f: rec.getString('file') };
}

module.exports = { SITES, adresseFournisseur, adressePhoto, extraire, texteDe, photoEnGrand, lirePage, copierPhoto };
