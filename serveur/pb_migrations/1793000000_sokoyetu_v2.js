/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu v2 — ajustements de la base, sans toucher aux données existantes :
 *  - les commandes ne se créent plus que par /api/sokoyetu/commander (prix, stock et total recalculés, stock réservé) ;
 *  - miniatures de photos adaptées aux téléphones ;
 *  - limites anti-abus par route.
 */
migrate((app) => {
  const orders = app.findCollectionByNameOrId('orders');
  orders.createRule = null;
  app.save(orders);

  const media = app.findCollectionByNameOrId('media');
  const fichier = media.fields.getByName('file');
  fichier.thumbs = ['400x0', '800x0', '1200x0', '600x0'];
  fichier.maxSize = 10485760;
  app.save(media);

  const s = app.settings();
  s.meta.appName = 'Sokoyetu';
  s.logs.maxDays = 14;
  s.rateLimits.enabled = true;
  s.rateLimits.rules = [
    { label: '*:auth', audience: '', maxRequests: 5, duration: 15 },
    { label: '/api/sokoyetu/commander', audience: '', maxRequests: 10, duration: 60 },
    { label: '/api/sokoyetu/discount', audience: '@guest', maxRequests: 12, duration: 60 },
    { label: '/api/sokoyetu/devis', audience: '', maxRequests: 40, duration: 60 },
    { label: '/api/sokoyetu/ia/', audience: '', maxRequests: 12, duration: 60 },
    { label: '*:create', audience: '@guest', maxRequests: 10, duration: 60 },
    { label: '/api/', audience: '', maxRequests: 300, duration: 10 }
  ];
  app.save(s);
}, (app) => {
  const orders = app.findCollectionByNameOrId('orders');
  orders.createRule = '';
  app.save(orders);
});
