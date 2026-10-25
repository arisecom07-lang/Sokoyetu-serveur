/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — comptes clients facultatifs (voir pb_hooks/lib/comptes.js) : on peut toujours commander sans compte.
 *   clients               un compte par numéro de téléphone, sans mot de passe (connexion par code reçu sur WhatsApp ou par SMS),
 *                         avec ses favoris, son panier et ses coordonnées (champ doc) ; lisible par l'administration seulement
 *   orders.client         compte qui a passé la commande (vide : commande sans compte)
 *   sokoyetu_codes        codes de connexion en cours (empreinte seulement, jamais le code), essais et envois
 *   sokoyetu_envois_jours codes envoyés chaque jour (plafond contre les abus : chaque message coûte)
 */
migrate((app) => {
  const ADMIN = '@request.auth.collectionName = "admins"';
  const clients = new Collection({
    type: 'auth', name: 'clients',
    listRule: ADMIN, viewRule: ADMIN, createRule: null, updateRule: null, deleteRule: null,
    passwordAuth: { enabled: false, identityFields: ['email'] },
    otp: { enabled: false }, mfa: { enabled: false }, oauth2: { enabled: false },
    authToken: { duration: 90 * 86400 },
    fields: [
      { name: 'phone', type: 'text', required: true, max: 20 },
      { name: 'name', type: 'text', max: 60 },
      { name: 'doc', type: 'json', maxSize: 200000 },
      { name: 'seen', type: 'number' },
      { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_clients_phone ON clients (phone)']
  });
  app.save(clients);
  // L'adresse e-mail n'est pas demandée : le compte se reconnaît à son téléphone.
  const cree = app.findCollectionByNameOrId('clients');
  cree.fields.getByName('email').required = false;
  app.save(cree);

  const orders = app.findCollectionByNameOrId('orders');
  if (!orders.fields.getByName('client')) orders.fields.add(new TextField({ name: 'client', max: 20 }));
  orders.addIndex('idx_orders_client', false, 'client', '');
  app.save(orders);

  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_codes (
    telephone TEXT PRIMARY KEY NOT NULL, empreinte TEXT NOT NULL DEFAULT '', sel TEXT NOT NULL DEFAULT '',
    expire INTEGER NOT NULL DEFAULT 0, essais INTEGER NOT NULL DEFAULT 0, envoye INTEGER NOT NULL DEFAULT 0,
    envois INTEGER NOT NULL DEFAULT 0, fenetre INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE TABLE IF NOT EXISTS sokoyetu_envois_jours (jour TEXT PRIMARY KEY NOT NULL, n INTEGER NOT NULL DEFAULT 0)').execute();

  const s = app.settings();
  const labels = ['/api/sokoyetu/compte/code', '/api/sokoyetu/compte/connexion', '/api/sokoyetu/compte'];
  const regles = s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0);
  // Chaque code envoyé coûte : peu de demandes par adresse IP (le serveur limite aussi par numéro et par jour).
  regles.splice(regles.length - 1, 0,
    { label: '/api/sokoyetu/compte/code', audience: '', maxRequests: 6, duration: 300 },
    { label: '/api/sokoyetu/compte/connexion', audience: '', maxRequests: 20, duration: 300 },
    { label: '/api/sokoyetu/compte', audience: '', maxRequests: 120, duration: 60 });
  s.rateLimits.rules = regles;
  app.save(s);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('clients')); } catch (e) { }
  const orders = app.findCollectionByNameOrId('orders');
  orders.removeIndex('idx_orders_client');
  orders.fields.removeByName('client');
  app.save(orders);
  for (const t of ['sokoyetu_codes', 'sokoyetu_envois_jours']) app.db().newQuery('DROP TABLE IF EXISTS ' + t).execute();
});
