/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — « Prévenez-moi » au retour en stock, et annonces de la boutique (pb_hooks/lib/alertes.js), en notifications
 * gratuites (centre de notifications et téléphone, lib/notifications.js).
 *   sokoyetu_alertes    un client (compte et/ou appareil) attend le retour d'un article épuisé, ou d'une de ses options
 *                       (variante « Rouge|M », '' pour l'article entier) ; la ligne disparaît une fois le client prévenu
 *   sokoyetu_annonces   promotions et nouveautés envoyées par la boutique aux téléphones qui les acceptent
 */
const LIMITES = [
  { label: '/api/sokoyetu/alertes', audience: '', maxRequests: 30, duration: 60 }
];

migrate((app) => {
  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_alertes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, produit TEXT NOT NULL, variante TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL DEFAULT '', appareil TEXT NOT NULL DEFAULT '', cree INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE UNIQUE INDEX IF NOT EXISTS idx_sokoyetu_alertes_unique ON sokoyetu_alertes (produit, variante, client, appareil)').execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_alertes_client ON sokoyetu_alertes (client)').execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_alertes_appareil ON sokoyetu_alertes (appareil)').execute();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_annonces (
    id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT NOT NULL, texte TEXT NOT NULL, url TEXT NOT NULL DEFAULT '/',
    auteur TEXT NOT NULL DEFAULT '', cree INTEGER NOT NULL DEFAULT 0, destinataires INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_annonces_cree ON sokoyetu_annonces (cree)').execute();

  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  const liste = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  const generale = liste.findIndex((x) => x.label === '/api/');
  liste.splice(generale < 0 ? liste.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = liste;
  app.save(s);
}, (app) => {
  const db = app.db();
  ['sokoyetu_alertes', 'sokoyetu_annonces'].forEach((t) => db.newQuery(`DROP TABLE IF EXISTS ${t}`).execute());
  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  app.save(s);
});
