/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — sécurité des comptes de l'administration (version 3.3.0).
 *   - Rôle dans l'équipe : un membre ne peut plus changer son propre rôle par l'API des collections (la demande ne doit
 *     pas contenir « role ») ; seul le propriétaire le change, page « Équipe » (routes /api/sokoyetu/equipe).
 *     Un rôle inconnu est ramené au plus limité (livreur).
 *   - Mots de passe de l'administration : 10 caractères au moins, comme le demande déjà l'administration.
 *   - sokoyetu_echecs : mots de passe refusés par compte, pour verrouiller un compte attaqué (pb_hooks/lib/securite.js).
 */
const AVANT = 'id = @request.auth.id';
const APRES = 'id = @request.auth.id && @request.body.role:isset = false';
const ROLES = ['', 'proprietaire', 'vendeur', 'livreur'];

migrate((app) => {
  const admins = app.findCollectionByNameOrId('admins');
  admins.updateRule = APRES;
  const mdp = admins.fields.getByName('password');
  if (mdp && mdp.min < 10) mdp.min = 10;
  app.save(admins);
  app.findAllRecords('admins').forEach((r) => {
    if (ROLES.indexOf(r.getString('role')) < 0) { r.set('role', 'livreur'); app.save(r); }
  });
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_echecs (
    cle TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, debut INTEGER NOT NULL DEFAULT 0, dernier INTEGER NOT NULL DEFAULT 0)`).execute();
}, (app) => {
  const admins = app.findCollectionByNameOrId('admins');
  admins.updateRule = AVANT;
  app.save(admins);
  app.db().newQuery('DROP TABLE IF EXISTS sokoyetu_echecs').execute();
});
