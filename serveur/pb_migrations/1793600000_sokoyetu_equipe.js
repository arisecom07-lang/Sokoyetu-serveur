/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — l'équipe : chaque compte de l'administration a un rôle (regles.ROLES), propriétaire, vendeur ou livreur.
 * Les comptes existants (rôle vide) sont ceux du propriétaire : rien ne change pour eux.
 *   admins.role    rôle du compte (géré par le propriétaire, page « Équipe », routes /api/sokoyetu/equipe)
 *   orders.etape   étape de préparation (unfulfilled, preparing, shipped, delivered), pour suivre les changements d'étape.
 * Le livreur ne voit que les commandes payées, ouvertes et à livrer (pas les retraits en boutique) ; les routes du serveur
 * vérifient aussi chaque rôle (serveur.exigerGerant).
 * Réglages et codes promo : propriétaire seulement. Catalogue, médias, comptes clients : propriétaire et vendeurs.
 */
const TOUS = '@request.auth.collectionName = "admins"';
const EQUIPE = `${TOUS} && @request.auth.role != "livreur"`;
const PROPRIO = `${TOUS} && (@request.auth.role = "" || @request.auth.role = "proprietaire")`;
const LIVREUR = `${TOUS} && @request.auth.role = "livreur" && status = "open" && pay_status = "paid" && doc.shipping.pickup != true`;
const LIMITES = [{ label: '/api/sokoyetu/equipe', audience: '', maxRequests: 30, duration: 60 }];

function regles(app, r) {
  const c = (n) => app.findCollectionByNameOrId(n);
  const config = c('config'); config.createRule = r.proprio; config.updateRule = r.proprio; config.deleteRule = r.proprio; app.save(config);
  for (const n of ['collections', 'banners']) { const x = c(n); x.createRule = r.equipe; x.updateRule = r.equipe; x.deleteRule = r.equipe; app.save(x); }
  const products = c('products');
  products.listRule = `active = true || ${r.equipe}`; products.viewRule = `active = true || ${r.equipe}`;
  products.createRule = r.equipe; products.updateRule = r.equipe; products.deleteRule = r.equipe;
  app.save(products);
  const discounts = c('discounts');
  discounts.listRule = r.proprio; discounts.viewRule = r.proprio; discounts.createRule = r.proprio; discounts.updateRule = r.proprio; discounts.deleteRule = r.proprio;
  app.save(discounts);
  const orders = c('orders');
  orders.listRule = r.commandes; orders.viewRule = `${r.commandes} || (token != "" && token = @request.query.t)`; orders.deleteRule = r.proprio;
  app.save(orders);
  const media = c('media'); media.listRule = r.equipe; media.createRule = r.equipe; media.updateRule = r.equipe; media.deleteRule = r.equipe; app.save(media);
  try { const clients = c('clients'); clients.listRule = r.equipe; clients.viewRule = r.equipe; app.save(clients); } catch (e) { /* comptes clients absents */ }
}

migrate((app) => {
  const admins = app.findCollectionByNameOrId('admins');
  if (!admins.fields.getByName('role')) admins.fields.add(new TextField({ name: 'role', max: 20 }));
  app.save(admins);

  const orders = app.findCollectionByNameOrId('orders');
  if (!orders.fields.getByName('etape')) orders.fields.add(new TextField({ name: 'etape', max: 20 }));
  orders.addIndex('idx_orders_etape', false, 'status, pay_status, etape', '');
  app.save(orders);
  // Commandes existantes : étape reprise de leur document.
  app.db().newQuery("UPDATE orders SET etape = COALESCE(NULLIF(json_extract(doc, '$.fulfillment'), ''), 'unfulfilled')").execute();

  regles(app, { proprio: PROPRIO, equipe: EQUIPE, commandes: `(${EQUIPE}) || (${LIVREUR})` });

  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  const liste = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  const generale = liste.findIndex((x) => x.label === '/api/');
  liste.splice(generale < 0 ? liste.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = liste;
  app.save(s);
}, (app) => {
  regles(app, { proprio: TOUS, equipe: TOUS, commandes: TOUS });
  const orders = app.findCollectionByNameOrId('orders');
  orders.removeIndex('idx_orders_etape');
  orders.fields.removeByName('etape');
  app.save(orders);
  const admins = app.findCollectionByNameOrId('admins');
  admins.fields.removeByName('role');
  app.save(admins);
  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  app.save(s);
});
