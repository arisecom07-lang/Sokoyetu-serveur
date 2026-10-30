/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — notifications gratuites du client (pb_hooks/lib/notifications.js et lib/push.js) : centre de notifications
 * de la boutique, et notifications du téléphone (Web Push, sans contenu : le téléphone vient chercher le texte). Ni SMS ni WhatsApp.
 *   sokoyetu_notifications   une ligne par notification : compte client et/ou appareil destinataire, type, détails, lue
 *                            (cle : une même notification n'est jamais créée deux fois, par exemple « commande livrée »)
 *   sokoyetu_abonnements     navigateurs abonnés aux notifications du téléphone (adresse chez leur service de notification)
 *   sokoyetu_cles            clés du serveur (clé VAPID des notifications, créée au premier besoin, jamais changée)
 *   orders.appareil          empreinte de l'appareil qui a passé la commande : ses notifications y arrivent, même sans compte
 */
const LIMITES = [
  { label: '/api/sokoyetu/notifications', audience: '', maxRequests: 120, duration: 60 },
  { label: '/api/sokoyetu/push/', audience: '', maxRequests: 60, duration: 60 }
];

migrate((app) => {
  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL DEFAULT '', appareil TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', url TEXT NOT NULL DEFAULT '', cle TEXT NOT NULL DEFAULT '',
    cree INTEGER NOT NULL DEFAULT 0, lu INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_notifications_client ON sokoyetu_notifications (client, cree)').execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_notifications_appareil ON sokoyetu_notifications (appareil, cree)').execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_notifications_cree ON sokoyetu_notifications (cree)').execute();
  db.newQuery("CREATE UNIQUE INDEX IF NOT EXISTS idx_sokoyetu_notifications_cle ON sokoyetu_notifications (cle) WHERE cle != ''").execute();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_abonnements (
    endpoint TEXT PRIMARY KEY NOT NULL, auth TEXT NOT NULL, p256dh TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL DEFAULT '', appareil TEXT NOT NULL DEFAULT '', langue TEXT NOT NULL DEFAULT 'fr', promos INTEGER NOT NULL DEFAULT 0,
    cree INTEGER NOT NULL DEFAULT 0, vu INTEGER NOT NULL DEFAULT 0, curseur INTEGER NOT NULL DEFAULT 0, pousse INTEGER NOT NULL DEFAULT 0,
    echecs INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_abonnements_client ON sokoyetu_abonnements (client)').execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_abonnements_appareil ON sokoyetu_abonnements (appareil)').execute();
  db.newQuery('CREATE TABLE IF NOT EXISTS sokoyetu_cles (nom TEXT PRIMARY KEY NOT NULL, valeur TEXT NOT NULL)').execute();

  const orders = app.findCollectionByNameOrId('orders');
  if (!orders.fields.getByName('appareil')) orders.fields.add(new TextField({ name: 'appareil', max: 64, hidden: true }));
  orders.addIndex('idx_orders_appareil', false, 'appareil', '');
  app.save(orders);

  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  const liste = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  const generale = liste.findIndex((x) => x.label === '/api/');
  liste.splice(generale < 0 ? liste.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = liste;
  app.save(s);
}, (app) => {
  const db = app.db();
  ['sokoyetu_notifications', 'sokoyetu_abonnements', 'sokoyetu_cles'].forEach((t) => db.newQuery(`DROP TABLE IF EXISTS ${t}`).execute());
  const orders = app.findCollectionByNameOrId('orders');
  orders.removeIndex('idx_orders_appareil');
  orders.fields.removeByName('appareil');
  app.save(orders);
  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  app.save(s);
});
