/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — fidélité : cagnotte et parrainage (pb_hooks/lib/fidelite.js), fermés tant que la boutique ne les ouvre pas
 * (Réglages → Fidélité et parrainage).
 *   sokoyetu_cagnotte     gains des clients, par téléphone : commande livrée (« achat ») et parrainage récompensé, jamais
 *                         deux fois le même (cle) ; ce que le client dépense se lit dans ses commandes (doc.wallet)
 *   clients.parrain_code  code de parrainage du client (lien /?parrain=CODE), créé la première fois qu'il ouvre sa cagnotte
 */
const LIMITES = [
  { label: '/api/sokoyetu/cagnotte', audience: '', maxRequests: 60, duration: 60 },
  { label: '/api/sokoyetu/parrainage', audience: '', maxRequests: 30, duration: 60 }
];

migrate((app) => {
  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_cagnotte (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telephone TEXT NOT NULL, montant REAL NOT NULL DEFAULT 0, type TEXT NOT NULL,
    commande TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}', cle TEXT NOT NULL, cree INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_cagnotte_telephone ON sokoyetu_cagnotte (telephone, cree)').execute();
  db.newQuery('CREATE UNIQUE INDEX IF NOT EXISTS idx_sokoyetu_cagnotte_cle ON sokoyetu_cagnotte (cle)').execute();

  const clients = app.findCollectionByNameOrId('clients');
  if (!clients.fields.getByName('parrain_code')) clients.fields.add(new TextField({ name: 'parrain_code', max: 12 }));
  clients.addIndex('idx_clients_parrain_code', true, 'parrain_code', "parrain_code != ''");
  app.save(clients);

  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  const liste = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  const generale = liste.findIndex((x) => x.label === '/api/');
  liste.splice(generale < 0 ? liste.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = liste;
  app.save(s);
}, (app) => {
  app.db().newQuery('DROP TABLE IF EXISTS sokoyetu_cagnotte').execute();
  const clients = app.findCollectionByNameOrId('clients');
  clients.removeIndex('idx_clients_parrain_code');
  clients.fields.removeByName('parrain_code');
  app.save(clients);
  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  app.save(s);
});
