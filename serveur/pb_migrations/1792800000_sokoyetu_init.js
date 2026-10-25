/// <reference path="../pb_data/types.d.ts" />
// Sokoyetu — structure de la base, règles d'accès, limites anti-spam et sauvegardes.
migrate((app) => {
  const ADMIN = '@request.auth.collectionName = "admins"';
  const idField = { name: 'id', type: 'text', primaryKey: true, required: true, system: true, min: 2, max: 40, pattern: '^[a-z0-9-]+$', autogeneratePattern: '[a-z0-9]{15}' };
  const dates = [{ name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }];
  const doc = { name: 'doc', type: 'json', maxSize: 2000000 };

  // Comptes administrateurs (connexion à admin.html)
  const admins = new Collection({
    type: 'auth', name: 'admins',
    listRule: 'id = @request.auth.id', viewRule: 'id = @request.auth.id', createRule: null, updateRule: 'id = @request.auth.id', deleteRule: null,
    passwordAuth: { enabled: true, identityFields: ['email'] },
    fields: [{ name: 'name', type: 'text', max: 80 }, ...dates]
  });
  app.save(admins);

  // Catalogue public en lecture, modifiable par les administrateurs uniquement
  for (const name of ['config', 'collections', 'banners']) {
    app.save(new Collection({ type: 'base', name, listRule: '', viewRule: '', createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN, fields: [idField, doc, ...dates] }));
  }
  app.save(new Collection({
    type: 'base', name: 'products',
    listRule: `active = true || ${ADMIN}`, viewRule: `active = true || ${ADMIN}`, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN,
    fields: [idField, doc, { name: 'active', type: 'bool' }, ...dates]
  }));
  // Codes promo : invisibles du public (vérifiés par le serveur)
  app.save(new Collection({
    type: 'base', name: 'discounts', listRule: ADMIN, viewRule: ADMIN, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN,
    fields: [idField, doc, { name: 'code', type: 'text', max: 20 }, ...dates],
    indexes: ['CREATE UNIQUE INDEX idx_discounts_code ON discounts (code)']
  }));
  // Commandes : tout client peut en créer une (contrôlée par le serveur) ; il ne peut relire que la sienne, avec son jeton
  app.save(new Collection({
    type: 'base', name: 'orders',
    listRule: ADMIN, viewRule: `${ADMIN} || (token != "" && token = @request.query.t)`, createRule: '', updateRule: ADMIN, deleteRule: ADMIN,
    fields: [idField, doc, { name: 'token', type: 'text', max: 64 }, { name: 'phone', type: 'text', max: 20 }, { name: 'status', type: 'text', max: 20 }, ...dates],
    indexes: ['CREATE INDEX idx_orders_phone ON orders (phone)']
  }));
  // Photos des produits
  app.save(new Collection({
    type: 'base', name: 'media', listRule: ADMIN, viewRule: '', createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN,
    fields: [{ name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 8388608, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], thumbs: ['600x0', '1200x0'] }, ...dates]
  }));

  const s = app.settings();
  s.meta.appName = 'Sokoyetu';
  s.meta.appURL = 'https://sokoyakwetu.com';
  s.meta.hideControls = false;
  s.backups.cron = '0 3 * * *';
  s.backups.cronMaxKeep = 7;
  s.rateLimits.enabled = true;
  s.rateLimits.rules = [
    { label: '*:auth', audience: '', maxRequests: 3, duration: 10 },
    { label: 'orders:create', audience: '@guest', maxRequests: 6, duration: 60 }, // par adresse IP : les clients d'un même opérateur mobile peuvent partager une IP
    { label: '*:create', audience: '@guest', maxRequests: 10, duration: 60 },
    { label: '/api/sokoyetu/', audience: '', maxRequests: 20, duration: 60 },
    { label: '/api/', audience: '', maxRequests: 300, duration: 10 }
  ];
  app.save(s);
}, (app) => {
  for (const n of ['media', 'orders', 'discounts', 'products', 'banners', 'collections', 'config', 'admins']) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (e) { }
  }
});
