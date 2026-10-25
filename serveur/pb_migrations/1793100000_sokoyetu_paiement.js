/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — paiement automatique : champs de recherche des commandes et limites anti-abus des nouvelles routes.
 *   number      numéro de commande (reçu, recherche par le client)
 *   pay_status  état du paiement (pending, failed, paid, expired, refunded)
 *   pay_ref     référence de la demande chez le fournisseur (notifications)
 *   expires     échéance du paiement (millisecondes)
 * Les commandes ne se modifient plus que par les routes du serveur (paiement, étapes, effacement), qui tiennent le stock à jour.
 */
migrate((app) => {
  const orders = app.findCollectionByNameOrId('orders');
  for (const [nom, max] of [['number', 12], ['pay_status', 20], ['pay_ref', 100]]) {
    if (!orders.fields.getByName(nom)) orders.fields.add(new TextField({ name: nom, max }));
  }
  if (!orders.fields.getByName('expires')) orders.fields.add(new NumberField({ name: 'expires' }));
  orders.addIndex('idx_orders_number', false, 'number', '');
  orders.addIndex('idx_orders_pay', false, 'status, pay_status', '');
  orders.addIndex('idx_orders_pay_ref', false, 'pay_ref', '');
  orders.updateRule = null;
  app.save(orders);

  // Commandes existantes : champs remplis depuis leur document.
  app.findAllRecords('orders').forEach((rec) => {
    let d = {};
    try { d = JSON.parse(rec.getString('doc') || '{}') || {}; } catch (e) { }
    rec.set('number', String(d.number || ''));
    rec.set('pay_status', String((d.payment && d.payment.status) || ''));
    rec.set('pay_ref', '');
    rec.set('expires', 0);
    app.save(rec);
  });

  const s = app.settings();
  const regles = s.rateLimits.rules.filter((r) => ['/api/sokoyetu/paiement/', '/api/sokoyetu/retrouver', '/api/sokoyetu/notification/'].indexOf(r.label) < 0);
  // Une seule demande par commande désormais (les nouvelles tentatives passent par /paiement/…/relancer).
  regles.forEach((r) => { if (r.label === '/api/sokoyetu/commander') r.maxRequests = 20; });
  // Les clients d'un même opérateur mobile partagent souvent une adresse IP : limites larges pour le suivi du paiement.
  regles.splice(regles.length - 1, 0,
    { label: '/api/sokoyetu/paiement/', audience: '', maxRequests: 240, duration: 60 },
    { label: '/api/sokoyetu/retrouver', audience: '', maxRequests: 10, duration: 60 },
    { label: '/api/sokoyetu/notification/', audience: '', maxRequests: 600, duration: 60 });
  s.rateLimits.rules = regles;
  app.save(s);
}, (app) => {
  const orders = app.findCollectionByNameOrId('orders');
  orders.removeIndex('idx_orders_number'); orders.removeIndex('idx_orders_pay'); orders.removeIndex('idx_orders_pay_ref');
  for (const nom of ['number', 'pay_status', 'pay_ref', 'expires']) orders.fields.removeByName(nom);
  orders.updateRule = '@request.auth.collectionName = "admins"';
  app.save(orders);
});
