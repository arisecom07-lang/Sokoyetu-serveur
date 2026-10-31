/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — relance des paniers laissés (pb_hooks/lib/comptes.js, relancerPaniers) : le client avec compte qui laisse
 * son panier reçoit une notification gratuite (centre de notifications et téléphone), une fois par panier.
 *   clients.relance   date de la dernière relance (une par semaine au plus), montrée à la boutique dans Audience et Clients
 */
migrate((app) => {
  const clients = app.findCollectionByNameOrId('clients');
  if (!clients.fields.getByName('relance')) clients.fields.add(new NumberField({ name: 'relance' }));
  app.save(clients);
}, (app) => {
  const clients = app.findCollectionByNameOrId('clients');
  clients.fields.removeByName('relance');
  app.save(clients);
});
