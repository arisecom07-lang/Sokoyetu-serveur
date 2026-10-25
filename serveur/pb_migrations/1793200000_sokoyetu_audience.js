/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — fréquentation de la boutique (voir pb_hooks/lib/audience.js) : trois petites tables de compteurs,
 * sans nom, téléphone ni adresse IP, et la limite anti-abus des nouvelles routes.
 */
migrate((app) => {
  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_visiteurs (
    jour TEXT NOT NULL, visiteur TEXT NOT NULL, vu INTEGER NOT NULL DEFAULT 0, vues INTEGER NOT NULL DEFAULT 0, produit TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (jour, visiteur))`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_visiteurs_vu ON sokoyetu_visiteurs (vu)').execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_visiteurs_visiteur ON sokoyetu_visiteurs (visiteur, jour)').execute();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_articles (
    jour TEXT NOT NULL, produit TEXT NOT NULL, visiteur TEXT NOT NULL,
    vues INTEGER NOT NULL DEFAULT 0, panier INTEGER NOT NULL DEFAULT 0, favori INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (jour, produit, visiteur))`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_articles_produit ON sokoyetu_articles (produit, jour)').execute();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_etats (
    visiteur TEXT NOT NULL, produit TEXT NOT NULL, type TEXT NOT NULL, depuis INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (visiteur, type, produit))`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_etats_produit ON sokoyetu_etats (produit, type)').execute();

  const s = app.settings();
  const regles = s.rateLimits.rules.filter((r) => ['/api/sokoyetu/visite', '/api/sokoyetu/audience'].indexOf(r.label) < 0);
  // Une visite = un signal toutes les 45 s, plus un par article ouvert ; plusieurs clients partagent souvent une adresse IP.
  regles.splice(regles.length - 1, 0,
    { label: '/api/sokoyetu/visite', audience: '', maxRequests: 600, duration: 60 },
    { label: '/api/sokoyetu/audience', audience: '', maxRequests: 120, duration: 60 });
  s.rateLimits.rules = regles;
  app.save(s);
}, (app) => {
  for (const t of ['sokoyetu_visiteurs', 'sokoyetu_articles', 'sokoyetu_etats']) app.db().newQuery('DROP TABLE IF EXISTS ' + t).execute();
});
