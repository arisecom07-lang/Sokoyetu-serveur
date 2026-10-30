/*
 * Sokoyetu — comptes clients facultatifs : on peut toujours commander sans compte.
 *
 * Connexion sans mot de passe : le client donne son téléphone, reçoit un code à 6 chiffres sur WhatsApp (ou par SMS
 * en secours, lib/envoi.js), le saisit, et reste connecté 90 jours sur cet appareil. Le premier code validé crée le compte.
 * Le compte garde le panier, les favoris et les coordonnées (champ doc, voir regles.docCompte) ; ses commandes sont
 * celles passées connecté (orders.client) et celles passées sans compte avec le même téléphone (le code reçu prouve que c'est bien le sien).
 *
 * Codes : seule une empreinte est gardée (sokoyetu_codes) ; valable CODE_MINUTES minutes, ESSAIS essais.
 * Envois : un nouveau code au plus toutes les RENVOI secondes, ENVOIS_MAX par numéro sur FENETRE, et un plafond
 * quotidien pour toute la boutique (SOKOYETU_SMS_MAX_JOUR), car chaque message coûte.
 */
const R = require(`${__hooks}/lib/regles.js`);
const S = require(`${__hooks}/lib/serveur.js`);
const ENVOI = require(`${__hooks}/lib/envoi.js`);

const CODE_MINUTES = 10;
const ESSAIS = 5;
const RENVOI = 60;
const ENVOIS_MAX = 5;
const FENETRE = 3 * 3600e3;
const FUSEAU = 2 * 3600e3;

const jour = (t) => new Date(t + FUSEAU).toISOString().slice(0, 10);
const empreinte = (tel, code, sel) => $security.sha256(sel + ':' + tel + ':' + code);

function ligneCode(app, tel) {
  const l = arrayOf(new DynamicModel({ empreinte: '', sel: '', expire: 0, essais: 0, envoye: 0, envois: 0, fenetre: 0 }));
  app.db().newQuery('SELECT empreinte, sel, expire, essais, envoye, envois, fenetre FROM sokoyetu_codes WHERE telephone = {:t}').bind({ t: tel }).all(l);
  if (!l.length) return null;
  const x = l[0];
  return { empreinte: String(x.empreinte), sel: String(x.sel), expire: Number(x.expire), essais: Number(x.essais), envoye: Number(x.envoye), envois: Number(x.envois), fenetre: Number(x.fenetre) };
}

class ErreurCompte extends Error {
  constructor(message, status, extra) { super(message); this.status = status || 400; Object.assign(this, extra || {}); }
}

/*
 * Envoie un code de connexion sur WhatsApp, ou par SMS (canal 'sms', ou WhatsApp fermé).
 * Renvoie { telephone, canal, canaux, renvoi (secondes avant d'en redemander un), test, code (mode test seulement) }.
 */
function demanderCode(app, saisie, hote, demande) {
  const ouverts = ENVOI.canaux();
  if (!ouverts.length) throw new ErreurCompte('Les comptes ne sont pas encore ouverts. Vous pouvez commander sans compte.', 503);
  const canal = ouverts.indexOf(demande) >= 0 ? demande : ouverts[0];
  const tel = R.valider.telephone(saisie); const dest = R.telephoneInternational(tel);
  if (!tel || !dest) throw new ErreurCompte('Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.', 400, { champ: 'telephone' });
  const now = Date.now();
  const x = ligneCode(app, tel);
  // Un code encore valable vient de partir : on ne le renvoie pas tout de suite (un code déjà utilisé n'attend pas).
  if (x && x.empreinte && now < x.expire && now - x.envoye < RENVOI * 1000) return { telephone: tel, canal, canaux: ouverts, renvoi: Math.ceil((RENVOI * 1000 - (now - x.envoye)) / 1000), test: ENVOI.enTest(canal), deja: true };
  const debut = x && now - x.fenetre < FENETRE ? x.fenetre : now;
  const envois = x && debut === x.fenetre ? x.envois : 0;
  if (envois >= ENVOIS_MAX) throw new ErreurCompte('Trop de codes demandés pour ce numéro. Réessayez dans quelques heures, ou commandez sans compte.', 429, { code: 'limite' });
  const j = jour(now);
  const l = arrayOf(new DynamicModel({ n: 0 }));
  app.db().newQuery('SELECT n FROM sokoyetu_envois_jours WHERE jour = {:j}').bind({ j }).all(l);
  if (l.length && Number(l[0].n) >= ENVOI.maxParJour()) throw new ErreurCompte('La connexion aux comptes est momentanément saturée. Réessayez plus tard, ou commandez sans compte.', 429, { code: 'limite' });

  const code = $security.randomStringWithAlphabet(R.CODE_CHIFFRES, '0123456789');
  const sel = $security.randomString(16);
  const nom = S.configuration(app).name || 'Sokoyetu';
  // Dernière ligne au format « @domaine #code » : sur Android, le code se remplit tout seul (WebOTP).
  const texte = `${nom} : votre code de connexion est ${code}. Il expire dans ${CODE_MINUTES} minutes. Ne le donnez à personne.` + (hote ? `\n\n@${hote} #${code}` : '');
  const r = ENVOI.envoyer(canal, dest, code, texte);
  if (!r.ok) throw new ErreurCompte(r.message, 502);
  app.runInTransaction((tx) => {
    tx.db().newQuery(`INSERT INTO sokoyetu_codes (telephone, empreinte, sel, expire, essais, envoye, envois, fenetre) VALUES ({:t}, {:e}, {:s}, {:x}, 0, {:n}, {:c}, {:f})
      ON CONFLICT (telephone) DO UPDATE SET empreinte = excluded.empreinte, sel = excluded.sel, expire = excluded.expire, essais = 0, envoye = excluded.envoye, envois = excluded.envois, fenetre = excluded.fenetre`)
      .bind({ t: tel, e: empreinte(tel, code, sel), s: sel, x: now + CODE_MINUTES * 60000, n: now, c: envois + 1, f: debut }).execute();
    tx.db().newQuery('INSERT INTO sokoyetu_envois_jours (jour, n) VALUES ({:j}, 1) ON CONFLICT (jour) DO UPDATE SET n = n + 1').bind({ j }).execute();
  });
  const sortie = { telephone: tel, canal, canaux: ouverts, renvoi: RENVOI, test: ENVOI.enTest(canal) };
  if (sortie.test) sortie.code = code;
  return sortie;
}

/* Vérifie le code ; renvoie le compte (créé au premier code validé). Un code ne sert qu'une fois. */
function verifierCode(app, saisie, saisieCode, nom) {
  const tel = R.valider.telephone(saisie); const code = R.codeConnexion(saisieCode);
  if (!tel) throw new ErreurCompte('Numéro invalide.', 400, { champ: 'telephone' });
  if (!code) throw new ErreurCompte(`Le code compte ${R.CODE_CHIFFRES} chiffres.`, 400, { champ: 'code' });
  const x = ligneCode(app, tel); const now = Date.now();
  if (!x || !x.empreinte || now > x.expire) throw new ErreurCompte('Ce code a expiré. Demandez-en un nouveau.', 400, { champ: 'code', expire: true });
  if (x.essais >= ESSAIS) throw new ErreurCompte('Trop d’essais avec ce code. Demandez-en un nouveau.', 400, { champ: 'code', expire: true });
  if (empreinte(tel, code, x.sel) !== x.empreinte) {
    app.db().newQuery('UPDATE sokoyetu_codes SET essais = essais + 1 WHERE telephone = {:t}').bind({ t: tel }).execute();
    const reste = ESSAIS - x.essais - 1;
    throw new ErreurCompte(reste > 0 ? `Code incorrect. Encore ${reste} essai${reste > 1 ? 's' : ''}.` : 'Code incorrect. Demandez un nouveau code.', 400, { champ: 'code', expire: reste <= 0 });
  }
  let rec = null;
  app.runInTransaction((tx) => {
    tx.db().newQuery("UPDATE sokoyetu_codes SET empreinte = '', expire = 0 WHERE telephone = {:t}").bind({ t: tel }).execute();
    try { rec = tx.findFirstRecordByData('clients', 'phone', tel); } catch (e) { rec = null; }
    if (!rec) {
      rec = new Record(tx.findCollectionByNameOrId('clients'));
      rec.set('phone', tel);
      rec.setPassword($security.randomString(40));
      rec.setVerified(true);
      rec.set('doc', R.docCompte({}));
    }
    const n = R.valider.nom(nom);
    if (n && !rec.getString('name')) rec.set('name', n);
    rec.set('seen', now);
    tx.save(rec);
  });
  return rec;
}

/* Compte connecté (jeton envoyé par la boutique), sinon null. */
function compteDe(e) {
  const a = e.auth;
  try { return a && a.collection().name === 'clients' ? a : null; } catch (err) { return null; }
}
function exigerCompte(e) {
  const a = compteDe(e);
  if (!a) throw new UnauthorizedError('Connectez-vous à votre compte.');
  return a;
}

const vue = (rec) => ({ id: rec.id, phone: rec.getString('phone'), name: rec.getString('name'), created: rec.getString('created'), doc: R.docCompte(S.lire(rec)) });

/*
 * Enregistre ce que la boutique envoie : panier, favoris, coordonnées, nom (chaque partie est facultative).
 * fusionner : première connexion sur un appareil, ce qui y était mis de côté rejoint le compte au lieu de le remplacer.
 */
function enregistrer(app, rec, b, fusionner) {
  const avant = R.docCompte(S.lire(rec));
  let d;
  if (fusionner) d = R.fusionCompte(avant, b);
  else {
    d = R.copie(avant);
    if (Array.isArray(b.panier)) d.panier = R.panierCompte(b.panier);
    if (Array.isArray(b.favoris)) d.favoris = R.favorisCompte(b.favoris);
    if (R.estObjet(b.profil)) d.profil = R.profilCompte(Object.assign({}, avant.profil, b.profil));
  }
  rec.set('doc', R.daterCompte(d, Date.now()));
  if (b.name !== undefined) { const n = R.valider.nom(b.name); if (n || !String(b.name || '').trim()) rec.set('name', n); }
  rec.set('seen', Date.now());
  app.save(rec);
  return vue(rec);
}

/* Commandes du compte : passées connecté, ou sans compte avec le même téléphone. Identifiant et jeton de suivi de chacune. */
function commandes(app, rec) {
  const tel = R.chiffres(rec.getString('phone'));
  return app.findRecordsByFilter('orders', 'client = {:c} || (phone != "" && phone = {:p})', '-created', 200, 0, { c: rec.id, p: tel })
    .map((o) => ({ id: o.id, t: o.getString('token') })).filter((x) => x.t);
}

/* Le client supprime son compte : ses commandes restent (comptabilité), simplement détachées du compte. */
function supprimer(app, rec) {
  app.runInTransaction((tx) => {
    tx.findRecordsByFilter('orders', 'client = {:c}', '', 10000, 0, { c: rec.id }).forEach((o) => { o.set('client', ''); tx.saveNoValidate(o); });
    tx.db().newQuery('DELETE FROM sokoyetu_codes WHERE telephone = {:t}').bind({ t: rec.getString('phone') }).execute();
    tx.delete(tx.findRecordById('clients', rec.id));
  });
  try { require(`${__hooks}/lib/notifications.js`).detacher(app, rec.id); } catch (e) { require(`${__hooks}/lib/serveur.js`).trace('warn', 'Notifications du compte non détachées', { module: 'comptes', erreur: String(e) }); }
}

/* Droit à l'effacement demandé à la boutique (administration) : le compte de ce téléphone disparaît aussi. */
function effacerParTelephone(app, chiffres) {
  let n = 0;
  app.findRecordsByFilter('clients', 'phone = {:a} || phone = {:b}', '', 10, 0, { a: chiffres, b: '+' + chiffres }).forEach((rec) => { supprimer(app, rec); n++; });
  return n;
}

/* Chaque nuit : compteurs d'envois de plus de 30 jours effacés. */
function purger(app) {
  app.db().newQuery('DELETE FROM sokoyetu_codes WHERE envoye < {:l}').bind({ l: Date.now() - 30 * 864e5 }).execute();
  app.db().newQuery('DELETE FROM sokoyetu_envois_jours WHERE jour < {:j}').bind({ j: jour(Date.now() - 400 * 864e5) }).execute();
}

/* Exécute une route des comptes : une ErreurCompte devient une réponse { message, champ, code, expire }. */
function repondre(e, fn) {
  try { return fn(module.exports); }
  catch (err) {
    if (err instanceof ErreurCompte) return e.json(err.status, { message: err.message, champ: err.champ || '', code: err.code || '', expire: !!err.expire });
    throw err;
  }
}

/* Ce que l'administration et la boutique ont le droit de savoir. */
const etat = () => ENVOI.etat();

module.exports = { ErreurCompte, demanderCode, verifierCode, compteDe, exigerCompte, vue, enregistrer, commandes, supprimer, effacerParTelephone, purger, repondre, etat };
