/*
 * Sokoyetu — l'équipe : les comptes de l'administration et leur rôle (regles.ROLES : propriétaire, vendeur, livreur).
 * Seul le propriétaire les gère. Un nouveau membre reçoit un mot de passe provisoire, montré une seule fois au propriétaire
 * qui le lui transmet ; le membre le change ensuite dans « Mon compte ». La boutique garde toujours au moins un propriétaire.
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;

const vue = (rec) => ({ id: rec.id, email: rec.email(), name: rec.getString('name'), role: R.roleNettoye(rec.getString('role')), created: rec.getString('created') });
const ORDRE = { proprietaire: 0, vendeur: 1, livreur: 2 };

function liste(app) {
  return app.findAllRecords('admins').map(vue).sort((a, b) => ORDRE[a.role] - ORDRE[b.role] || String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

/* Mot de passe provisoire facile à dicter : « KQZT-mhrw-4827 ». */
const motDePasse = () => [$security.randomStringWithAlphabet(4, 'ABCDEFGHJKMNPQRSTUVWXYZ'), $security.randomStringWithAlphabet(4, 'abcdefghjkmnpqrstuvwxyz'), $security.randomStringWithAlphabet(4, '23456789')].join('-');

const proprietaires = (app) => app.findAllRecords('admins').filter((r) => R.roleNettoye(r.getString('role')) === 'proprietaire');
function membre(app, id) {
  try { return app.findRecordById('admins', String(id || '')); } catch (e) { throw new NotFoundError('Ce membre de l’équipe n’existe plus.'); }
}
function roleSaisi(r) {
  if (!R.estRole(r)) throw new BadRequestError('Choisissez un rôle : propriétaire, vendeur ou livreur.');
  return r;
}

/* Nouveau membre : { name, email, role } → { membre, motDePasse }. */
function ajouter(app, b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw new BadRequestError('Adresse e-mail invalide.');
  const role = roleSaisi(b.role);
  const nom = R.valider.nom(b.name);
  if (!nom) throw new BadRequestError('Indiquez le nom du membre (2 à 60 lettres).');
  try { app.findAuthRecordByEmail('admins', email); throw new BadRequestError('Cette adresse a déjà un compte dans l’équipe.'); } catch (e) { if (e instanceof BadRequestError) throw e; }
  const rec = new Record(app.findCollectionByNameOrId('admins'));
  const mdp = motDePasse();
  rec.setEmail(email); rec.setPassword(mdp); rec.setVerified(true);
  rec.set('name', nom); rec.set('role', role);
  app.save(rec);
  S.trace('warn', 'Membre ajouté à l’équipe', { module: 'equipe', email, role });
  return { membre: vue(rec), motDePasse: mdp };
}

/* Rôle, nom, ou nouveau mot de passe provisoire (reinitialiser: true). moi : identifiant du compte qui fait la demande. */
function modifier(app, id, b, moi) {
  const rec = membre(app, id);
  let mdp = '';
  if (b.role !== undefined) {
    const role = roleSaisi(b.role);
    const avant = R.roleNettoye(rec.getString('role'));
    if (avant === 'proprietaire' && role !== 'proprietaire' && proprietaires(app).length <= 1) throw new BadRequestError('La boutique doit garder au moins un propriétaire.');
    rec.set('role', role);
  }
  if (b.name !== undefined) { const nom = R.valider.nom(b.name); if (!nom) throw new BadRequestError('Nom invalide (2 à 60 lettres).'); rec.set('name', nom); }
  if (b.reinitialiser) {
    if (rec.id === moi) throw new BadRequestError('Changez votre propre mot de passe dans « Mon compte ».');
    mdp = motDePasse(); rec.setPassword(mdp);
  }
  app.save(rec);
  return { membre: vue(rec), motDePasse: mdp };
}

function retirer(app, id, moi) {
  const rec = membre(app, id);
  if (rec.id === moi) throw new BadRequestError('Vous ne pouvez pas retirer votre propre compte.');
  if (R.roleNettoye(rec.getString('role')) === 'proprietaire' && proprietaires(app).length <= 1) throw new BadRequestError('La boutique doit garder au moins un propriétaire.');
  app.delete(rec);
  S.trace('warn', 'Membre retiré de l’équipe', { module: 'equipe', email: rec.email() });
  return { ok: true };
}

module.exports = { liste, ajouter, modifier, retirer, vue };
