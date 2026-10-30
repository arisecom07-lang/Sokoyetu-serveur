/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — robustesse (sans toucher aux données) :
 *  - index des recherches fréquentes : jeton de commande, dates des commandes, articles en vente ;
 *  - un jeton ne sert qu'à une seule commande (index unique) : deux envois simultanés ne créent jamais deux commandes ;
 *  - compteurs du jour partagés par tout le serveur (plafond des appels payants, comme l'assistant IA) ;
 *  - limites anti-abus des nouvelles routes et des pages d'articles ; photos plus largement permises (plusieurs clients
 *    d'un même opérateur mobile partagent souvent une seule adresse IP) ;
 *  - journal du serveur gardé 30 jours, limité aux avertissements et aux erreurs (requêtes refusées ou en échec,
 *    erreurs du serveur et des navigateurs) : les visites ordinaires sont déjà comptées par l'audience, sans gonfler le disque ;
 *  - pas d'e-mail « connexion depuis un nouvel appareil » tant que le serveur n'a pas d'envoi d'e-mails (SMTP) : chaque essai
 *    échoué remplissait le journal. À réactiver dans le tableau technique (/_/) une fois l'envoi d'e-mails réglé.
 */
const COMPTES = ['admins', 'clients', '_superusers'];
const LIMITES = [
  { label: '/api/sokoyetu/erreur', audience: '', maxRequests: 20, duration: 60 },
  { label: '/api/sokoyetu/sante', audience: '', maxRequests: 60, duration: 60 },
  { label: '/api/sokoyetu/journal', audience: '', maxRequests: 60, duration: 60 },
  { label: '/p/', audience: '', maxRequests: 600, duration: 60 },
  { label: '/c/', audience: '', maxRequests: 600, duration: 60 },
  { label: '/api/files/', audience: '', maxRequests: 900, duration: 10 }
];

migrate((app) => {
  const orders = app.findCollectionByNameOrId('orders');
  // Jetons déjà en double (anciennes versions) : simple index, pour ne pas bloquer la mise à jour.
  const doublons = arrayOf(new DynamicModel({ n: 0 }));
  app.db().newQuery("SELECT COUNT(*) AS n FROM (SELECT token FROM orders WHERE token != '' GROUP BY token HAVING COUNT(*) > 1)").all(doublons);
  const unique = !(doublons.length && Number(doublons[0].n) > 0);
  orders.removeIndex('idx_orders_token');
  orders.addIndex('idx_orders_token', unique, 'token', "token != ''");
  orders.addIndex('idx_orders_created', false, 'created', '');
  orders.addIndex('idx_orders_updated', false, 'updated', '');
  app.save(orders);

  const products = app.findCollectionByNameOrId('products');
  products.addIndex('idx_products_active', false, 'active, updated', '');
  app.save(products);

  app.db().newQuery('CREATE TABLE IF NOT EXISTS sokoyetu_compteurs (cle TEXT PRIMARY KEY NOT NULL, n INTEGER NOT NULL DEFAULT 0, maj INTEGER NOT NULL DEFAULT 0)').execute();

  const s = app.settings();
  const labels = LIMITES.map((r) => r.label);
  const regles = s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0);
  // Avant la règle générale « /api/ » (la première règle qui correspond s'applique).
  const generale = regles.findIndex((r) => r.label === '/api/');
  regles.splice(generale < 0 ? regles.length : generale, 0, ...LIMITES);
  s.rateLimits.enabled = true;
  s.rateLimits.rules = regles;
  s.logs.maxDays = 30;
  s.logs.minLevel = 4;
  app.save(s);

  if (!app.settings().smtp.enabled) {
    COMPTES.forEach((n) => {
      try { const c = app.findCollectionByNameOrId(n); c.authAlert.enabled = false; app.save(c); } catch (e) { /* collection absente */ }
    });
  }
}, (app) => {
  COMPTES.forEach((n) => {
    try { const c = app.findCollectionByNameOrId(n); c.authAlert.enabled = true; app.save(c); } catch (e) { /* collection absente */ }
  });
  const orders = app.findCollectionByNameOrId('orders');
  ['idx_orders_token', 'idx_orders_created', 'idx_orders_updated'].forEach((n) => orders.removeIndex(n));
  app.save(orders);
  const products = app.findCollectionByNameOrId('products');
  products.removeIndex('idx_products_active');
  app.save(products);
  app.db().newQuery('DROP TABLE IF EXISTS sokoyetu_compteurs').execute();
  const s = app.settings();
  const labels = LIMITES.map((r) => r.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0);
  s.logs.maxDays = 14;
  s.logs.minLevel = 0;
  app.save(s);
});
