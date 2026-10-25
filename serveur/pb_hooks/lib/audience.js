/*
 * Sokoyetu — fréquentation de la boutique, comptée par le serveur lui-même (aucun outil extérieur).
 *
 * Chaque appareil reçoit un identifiant tiré au sort, gardé dans le navigateur : il ne contient ni nom, ni téléphone,
 * ni adresse IP. Le serveur n'en garde que des compteurs :
 *   sokoyetu_visiteurs  une ligne par appareil et par jour (dernière activité, article affiché, nombre d'articles vus)
 *   sokoyetu_articles   une ligne par appareil, article et jour (vues, ajouts au panier, ajouts aux favoris)
 *   sokoyetu_etats      ce qui est en ce moment dans chaque panier et chaque liste de favoris
 * Tout est effacé au bout de GARDE_JOURS jours. Les jours suivent l'heure de Bukavu et Goma (UTC+2).
 */
const FUSEAU = 2 * 3600e3;
const JOUR = 864e5;
const EN_LIGNE = 90e3;      // la boutique se signale toutes les 45 s tant qu'elle est à l'écran
const GARDE_JOURS = 90;
const MAX_ETAT = 60;

const ID_VISITEUR = /^[a-z0-9]{16,40}$/;
const ID_PRODUIT = /^[a-z0-9-]{2,40}$/;
const ROBOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|headless|lighthouse|curl|wget|python|java\//i;

const jour = (t) => new Date(t + FUSEAU).toISOString().slice(0, 10);
const listeIds = (l) => (Array.isArray(l) ? l : []).map(String).filter((x) => ID_PRODUIT.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_ETAT);

/* Ce que la boutique annonce : { v, p (article à l'écran), a (vue | panier | favori), panier: [ids], favoris: [ids] }. */
function enregistrer(app, b, agent) {
  const v = String((b && b.v) || '');
  if (!ID_VISITEUR.test(v) || ROBOT.test(String(agent || ''))) return false;
  const now = Date.now(); const j = jour(now);
  const p = ID_PRODUIT.test(String(b.p || '')) ? String(b.p) : '';
  const a = ['vue', 'panier', 'favori'].indexOf(b.a) >= 0 && p ? b.a : '';
  app.runInTransaction((tx) => {
    const db = tx.db();
    db.newQuery(`INSERT INTO sokoyetu_visiteurs (jour, visiteur, vu, vues, produit) VALUES ({:j}, {:v}, {:t}, {:n}, {:p})
      ON CONFLICT (jour, visiteur) DO UPDATE SET vu = excluded.vu, vues = vues + excluded.vues, produit = excluded.produit`)
      .bind({ j, v, t: now, n: a === 'vue' ? 1 : 0, p }).execute();
    if (a) {
      db.newQuery(`INSERT INTO sokoyetu_articles (jour, produit, visiteur, vues, panier, favori) VALUES ({:j}, {:p}, {:v}, {:vu}, {:pa}, {:fa})
        ON CONFLICT (jour, produit, visiteur) DO UPDATE SET vues = vues + excluded.vues, panier = panier + excluded.panier, favori = favori + excluded.favori`)
        .bind({ j, p, v, vu: a === 'vue' ? 1 : 0, pa: a === 'panier' ? 1 : 0, fa: a === 'favori' ? 1 : 0 }).execute();
    }
    for (const [type, cle] of [['panier', 'panier'], ['favori', 'favoris']]) {
      if (!Array.isArray(b[cle])) continue;
      const ids = listeIds(b[cle]);
      const params = { v, type }; ids.forEach((x, i) => { params['p' + i] = x; });
      const garder = ids.length ? ` AND produit NOT IN (${ids.map((_, i) => '{:p' + i + '}').join(', ')})` : '';
      db.newQuery(`DELETE FROM sokoyetu_etats WHERE visiteur = {:v} AND type = {:type}${garder}`).bind(params).execute();
      ids.forEach((x) => db.newQuery('INSERT OR IGNORE INTO sokoyetu_etats (visiteur, produit, type, depuis) VALUES ({:v}, {:p}, {:type}, {:t})').bind({ v, p: x, type, t: now }).execute());
    }
  });
  return true;
}

function lignes(app, sql, modele, params) {
  const l = arrayOf(new DynamicModel(modele));
  app.db().newQuery(sql).bind(params || {}).all(l);
  return l.map((x) => { const o = {}; Object.keys(modele).forEach((k) => { o[k] = typeof modele[k] === 'number' ? Number(x[k]) || 0 : String(x[k] || ''); }); return o; });
}
const nombre = (app, sql, params) => (lignes(app, sql, { n: 0 }, params)[0] || { n: 0 }).n;

function periode(jours) {
  const n = Math.max(1, Math.min(GARDE_JOURS, parseInt(jours, 10) || 7));
  const now = Date.now();
  return { n, now, debut: jour(now - (n - 1) * JOUR), jours: Array.from({ length: n }, (_, i) => jour(now - (n - 1 - i) * JOUR)) };
}

/*
 * Vue d'ensemble pour l'administration : en ligne maintenant, chiffres de chaque article sur la période (jours),
 * et visiteurs jour par jour sur au moins « graphe » jours (l'histogramme garde 7 colonnes même pour « aujourd'hui »).
 */
function resume(app, jours, graphe) {
  const P = periode(jours); const recent = P.now - EN_LIGNE;
  const G = periode(Math.max(P.n, parseInt(graphe, 10) || 0));
  const parJour = {};
  lignes(app, 'SELECT jour, COUNT(*) AS visiteurs, COALESCE(SUM(vues), 0) AS vues FROM sokoyetu_visiteurs WHERE jour >= {:d} GROUP BY jour', { jour: '', visiteurs: 0, vues: 0 }, { d: G.debut })
    .forEach((x) => { parJour[x.jour] = x; });
  const nouveaux = {};
  lignes(app, 'SELECT premier AS jour, COUNT(*) AS n FROM (SELECT MIN(jour) AS premier FROM sokoyetu_visiteurs GROUP BY visiteur) WHERE premier >= {:d} GROUP BY premier', { jour: '', n: 0 }, { d: G.debut })
    .forEach((x) => { nouveaux[x.jour] = x.n; });

  const produits = {};
  const fiche = (id) => (produits[id] = produits[id] || { id, vues: 0, visiteurs: 0, paniers: 0, favoris: 0, dansPaniers: 0, dansFavoris: 0, enLigne: 0 });
  lignes(app, `SELECT produit, COALESCE(SUM(vues), 0) AS vues, SUM(vues > 0) AS visiteurs, SUM(panier > 0) AS paniers, SUM(favori > 0) AS favoris
    FROM sokoyetu_articles WHERE jour >= {:d} GROUP BY produit`, { produit: '', vues: 0, visiteurs: 0, paniers: 0, favoris: 0 }, { d: P.debut })
    .forEach((x) => Object.assign(fiche(x.produit), { vues: x.vues, visiteurs: x.visiteurs, paniers: x.paniers, favoris: x.favoris }));
  lignes(app, 'SELECT produit, type, COUNT(*) AS n FROM sokoyetu_etats GROUP BY produit, type', { produit: '', type: '', n: 0 })
    .forEach((x) => { fiche(x.produit)[x.type === 'panier' ? 'dansPaniers' : 'dansFavoris'] = x.n; });
  lignes(app, "SELECT produit, COUNT(DISTINCT visiteur) AS n FROM sokoyetu_visiteurs WHERE vu > {:r} AND produit != '' GROUP BY produit", { produit: '', n: 0 }, { r: recent })
    .forEach((x) => { fiche(x.produit).enLigne = x.n; });

  return {
    maintenant: P.now, periode: P.n,
    enLigne: nombre(app, 'SELECT COUNT(DISTINCT visiteur) AS n FROM sokoyetu_visiteurs WHERE vu > {:r}', { r: recent }),
    visiteurs: nombre(app, 'SELECT COUNT(DISTINCT visiteur) AS n FROM sokoyetu_visiteurs WHERE jour >= {:d}', { d: P.debut }),
    nouveaux: P.jours.reduce((a, j) => a + (nouveaux[j] || 0), 0),
    vues: P.jours.reduce((a, j) => a + ((parJour[j] || {}).vues || 0), 0),
    visiteursTotal: nombre(app, 'SELECT COUNT(DISTINCT visiteur) AS n FROM sokoyetu_visiteurs'),
    gardeJours: GARDE_JOURS,
    jours: G.jours.map((j) => ({ jour: j, visiteurs: (parJour[j] || {}).visiteurs || 0, vues: (parJour[j] || {}).vues || 0, nouveaux: nouveaux[j] || 0 })),
    produits: Object.values(produits)
  };
}

/* Un article jour par jour (au moins « graphe » jours), et ses totaux sur la période. */
function article(app, id, jours, graphe) {
  const P = periode(Math.max(parseInt(jours, 10) || 7, parseInt(graphe, 10) || 0)); const n = periode(jours).n;
  if (!ID_PRODUIT.test(String(id || ''))) return null;
  const parJour = {};
  lignes(app, `SELECT jour, COALESCE(SUM(vues), 0) AS vues, SUM(vues > 0) AS visiteurs, SUM(panier > 0) AS paniers, SUM(favori > 0) AS favoris
    FROM sokoyetu_articles WHERE produit = {:p} AND jour >= {:d} GROUP BY jour`, { jour: '', vues: 0, visiteurs: 0, paniers: 0, favoris: 0 }, { p: id, d: P.debut })
    .forEach((x) => { parJour[x.jour] = x; });
  const etats = {};
  lignes(app, 'SELECT type, COUNT(*) AS n FROM sokoyetu_etats WHERE produit = {:p} GROUP BY type', { type: '', n: 0 }, { p: id }).forEach((x) => { etats[x.type] = x.n; });
  const r = {
    maintenant: P.now, id,
    enLigne: nombre(app, 'SELECT COUNT(DISTINCT visiteur) AS n FROM sokoyetu_visiteurs WHERE vu > {:r} AND produit = {:p}', { r: P.now - EN_LIGNE, p: id }),
    dansPaniers: etats.panier || 0, dansFavoris: etats.favori || 0,
    jours: P.jours.map((j) => { const x = parJour[j] || {}; return { jour: j, vues: x.vues || 0, visiteurs: x.visiteurs || 0, paniers: x.paniers || 0, favoris: x.favoris || 0 }; })
  };
  r.periode = n;
  r.total = r.jours.slice(-n).reduce((a, j) => ({ vues: a.vues + j.vues, paniers: a.paniers + j.paniers, favoris: a.favoris + j.favoris }), { vues: 0, paniers: 0, favoris: 0 });
  // Visiteurs différents sur la période (un même appareil revenu plusieurs jours compte une fois).
  r.total.visiteurs = nombre(app, 'SELECT COUNT(DISTINCT visiteur) AS n FROM sokoyetu_articles WHERE produit = {:p} AND jour >= {:d} AND vues > 0', { p: id, d: periode(jours).debut });
  return r;
}

/* Chaque nuit : ce qui a plus de GARDE_JOURS jours disparaît, ainsi que les paniers et favoris des appareils disparus. */
function purger(app) {
  const limite = jour(Date.now() - GARDE_JOURS * JOUR);
  const db = app.db();
  db.newQuery('DELETE FROM sokoyetu_visiteurs WHERE jour < {:l}').bind({ l: limite }).execute();
  db.newQuery('DELETE FROM sokoyetu_articles WHERE jour < {:l}').bind({ l: limite }).execute();
  db.newQuery('DELETE FROM sokoyetu_etats WHERE visiteur NOT IN (SELECT DISTINCT visiteur FROM sokoyetu_visiteurs)').execute();
}

module.exports = { enregistrer, resume, article, purger, jour, GARDE_JOURS };
