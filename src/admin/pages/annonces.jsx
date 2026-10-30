// Sokoyetu (administration) — annonces aux clients (propriétaire) : une promotion ou une nouveauté, en notification
// gratuite (ni SMS ni WhatsApp) sur les téléphones qui acceptent les annonces de la boutique.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Cabas } from '../../commun/js/logo.jsx';
import { Champ, Note, Vide, toast, confirmer } from '../../commun/js/interface.jsx';
import { dollars, pluriel, classes, date, dateHeure, ilya } from '../../commun/js/outils.js';
import { cfg, produits, rayons, remises, lireAnnonces, envoyerAnnonce, gererErreur } from '../etat.js';
import { TetePage, Kpi } from '../composants/cadre.jsx';

const lienArticle = (p) => `/p/${p.id}/${R.slug(p.title)}`;
const lienRayon = (r) => `/c/${r.id}/${R.slug(r.name)}`;
const VIDE = { titre: '', texte: '', url: '/', erreurs: {} };

/* Idées d'annonces tirées de la boutique : ventes flash en cours, codes promo actifs, nouveautés de la semaine. */
function idees() {
  const now = Date.now(); const l = [];
  produits.value.filter((p) => R.estEnVente(p) && R.venteFlash(p, now)).slice(0, 3).forEach((p) => {
    const pa = R.prixAffiche(p, '', '', now); const f = pa.flash;
    l.push({ icone: 'horloge', titre: `Vente flash −${f.pct} %`, texte: `« ${p.title} » à ${dollars(pa.prix)}${pa.barre ? ` au lieu de ${dollars(pa.barre)}` : ''}, jusqu’au ${date(f.fin, { day: 'numeric', month: 'long' })}.`, url: lienArticle(p) });
  });
  remises.value.filter((d) => d.active !== false && !(d.endsAt && R.num(d.endsAt) < now) && R.num(d.value) > 0).slice(0, 2).forEach((d) => {
    const v = d.type === 'percent' ? `−${R.num(d.value)} %` : `−${dollars(d.value)}`;
    l.push({ icone: 'pourcent', titre: `${v} avec le code ${d.code}`, texte: `Entrez le code ${d.code} au moment de payer${R.num(d.minSubtotal) ? `, dès ${dollars(d.minSubtotal)} d’achat` : ''}.${d.endsAt ? ` Valable jusqu’au ${date(d.endsAt, { day: 'numeric', month: 'long' })}.` : ''}`, url: '/' });
  });
  const nouveaux = produits.value.filter((p) => R.estEnVente(p) && now - R.num(p.createdAt) < 7 * R.JOUR);
  if (nouveaux.length) {
    l.push({ icone: 'etincelle', titre: nouveaux.length > 1 ? `${nouveaux.length} nouveautés cette semaine` : 'Nouveauté de la semaine',
      texte: `${nouveaux.slice(0, 3).map((p) => p.title).join(', ')}${nouveaux.length > 3 ? '…' : ''} : venez voir !`, url: nouveaux.length > 1 ? '/nouveautes' : lienArticle(nouveaux[0]) });
  }
  return l.slice(0, 4).map((x) => ({ ...x, titre: x.titre.slice(0, 60), texte: x.texte.slice(0, 180) }));
}

/* L'annonce telle qu'elle s'affiche sur le téléphone du client. */
function Apercu({ f }) {
  return (
    <div class="apercu-notif" aria-label="Aperçu de la notification">
      <span class="apercu-notif-icone" aria-hidden="true"><Cabas taille={24} /></span>
      <span class="apercu-notif-texte">
        <small>{cfg.value.name} · maintenant</small>
        <b>{f.titre.trim() || 'Titre de l’annonce'}</b>
        <span>{f.texte.trim() || 'Votre message : la promotion, la nouveauté, jusqu’à quand…'}</span>
      </span>
    </div>
  );
}

export function Annonces() {
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState('');
  const [f, setF] = useState(VIDE);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { lireAnnonces().then((r) => { setEtat(r); setErreur(''); }).catch((e) => setErreur(e.message || 'Annonces indisponibles')); }, []);
  const maj = (p) => setF((x) => ({ ...x, ...p, erreurs: {} }));
  const restantes = etat ? etat.restantes : 0;
  const promos = etat ? etat.abonnes.promos : 0;

  async function envoyer(e) {
    e && e.preventDefault();
    if (envoi) return;
    let a;
    try { a = R.annonceNettoyee(f); } catch (err) { setF((x) => ({ ...x, erreurs: { [err.champ || 'texte']: err.message } })); return; }
    const texte = promos
      ? `Elle arrive dans la minute sur ${pluriel(promos, 'téléphone')} qui accepte${promos > 1 ? 'nt' : ''} les annonces de la boutique. Une fois envoyée, elle ne peut plus être retirée.`
      : 'Aucun téléphone n’accepte encore les annonces : elle sera seulement gardée dans l’historique.';
    if (!(await confirmer({ titre: 'Envoyer cette annonce ?', texte, ok: 'Envoyer' }))) return;
    setEnvoi(true);
    try {
      const r = await envoyerAnnonce(a);
      setEtat(r); setF(VIDE);
      toast(`Annonce envoyée à ${pluriel((r.annonces[0] && r.annonces[0].destinataires) || 0, 'téléphone')}`, { icone: 'envoyer' });
    } catch (err) { gererErreur(err, 'Envoi impossible'); }
    setEnvoi(false);
  }

  const l = idees();
  return (
    <>
      <TetePage titre="Annonces aux clients" sous="Promotions et nouveautés, en notification gratuite" parent="/plus" />
      <div class="pile-l">
        {erreur ? <Note ton="danger" icone="alerte">{erreur}</Note> : null}
        <div class="kpis">
          <Kpi libelle="Acceptent les annonces" icone="megaphone" valeur={etat ? String(promos) : '…'} sous={etat ? `sur ${pluriel(etat.abonnes.telephones, 'téléphone abonné', 'téléphones abonnés')}` : ''} />
          <Kpi libelle="Encore possibles" icone="horloge" valeur={etat ? `${restantes} / ${etat.parJour}` : '…'} sous="sur 24 heures" ton={etat && !restantes ? 'danger' : ''} />
        </div>
        <div class="formulaire-grille">
          <form class="pile-l" onSubmit={envoyer} noValidate>
            {l.length ? (
              <section class="carte">
                <h2 class="carte-titre"><Icone n="etincelle" />Idées tirées de votre boutique</h2>
                <div class="pile">{l.map((x, i) => <button key={i} type="button" class="choix" onClick={() => { maj({ titre: x.titre, texte: x.texte, url: x.url }); document.getElementById('annonce-titre')?.focus(); }}><span class="choix-icone"><Icone n={x.icone} /></span><span class="choix-texte"><b>{x.titre}</b><small>{x.texte}</small></span></button>)}</div>
              </section>
            ) : null}
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="crayon" />Nouvelle annonce</h2>
              <Champ libelle="Titre" erreur={f.erreurs.titre} aide={`${f.titre.length}/60`} id="annonce-titre">{(a) => <input class="saisie" {...a} value={f.titre} onInput={(e) => maj({ titre: e.currentTarget.value })} maxlength="60" placeholder="Ex. : Arrivage de pagnes wax" />}</Champ>
              <Champ libelle="Message" erreur={f.erreurs.texte} aide={`${f.texte.length}/180 · court et précis : le prix, la date limite`}>{(a) => <textarea class="saisie" {...a} rows="3" value={f.texte} onInput={(e) => maj({ texte: e.currentTarget.value })} maxlength="180" placeholder="Ex. : 40 nouveaux modèles en stock à Bukavu, dès $8. Livraison en 24 h." />}</Champ>
              <Champ libelle="En touchant la notification, le client arrive sur" erreur={f.erreurs.url}>{(a) => (
                <select class="saisie" {...a} value={f.url} onChange={(e) => maj({ url: e.currentTarget.value })}>
                  <option value="/">L’accueil de la boutique</option>
                  <option value="/nouveautes">Les nouveautés</option>
                  <option value="/en-stock">Les articles en stock</option>
                  <option value="/import-chine">Les articles importés de Chine</option>
                  {rayons.value.length ? <optgroup label="Un rayon">{rayons.value.map((r) => <option key={r.id} value={lienRayon(r)}>{r.name}</option>)}</optgroup> : null}
                  <optgroup label="Un article">{produits.value.filter(R.estEnVente).slice(0, 300).map((p) => <option key={p.id} value={lienArticle(p)}>{p.title}</option>)}</optgroup>
                </select>
              )}</Champ>
            </section>
            <section class="carte seulement-mobile">
              <h2 class="carte-titre"><Icone n="mobile" />Aperçu sur le téléphone</h2>
              <Apercu f={f} />
            </section>
            <button class={classes('btn btn-primaire btn-l btn-bloc', envoi && 'charge')} type="submit" disabled={!etat || !restantes}><Icone n="envoyer" />{etat && !restantes ? 'Limite atteinte : réessayez demain' : 'Envoyer l’annonce'}</button>
          </form>
          <div class="pile-l colonne-cote">
            <section class="carte seulement-ordi">
              <h2 class="carte-titre"><Icone n="mobile" />Aperçu sur le téléphone</h2>
              <Apercu f={f} />
            </section>
            <Note icone="info">Gratuit : ni SMS ni WhatsApp. Seuls les clients qui ont activé les notifications et accepté « Promotions et nouveautés » la reçoivent. {R.ANNONCES_PAR_JOUR} annonces par 24 heures au plus, pour qu’ils les gardent activées.</Note>
          </div>
        </div>
        <section class="carte">
          <h2 class="carte-titre"><Icone n="horloge" />Annonces envoyées</h2>
          {etat && !etat.annonces.length ? <Vide icone="megaphone" titre="Aucune annonce pour le moment" texte="Votre première annonce apparaîtra ici, avec le nombre de téléphones qui l’ont reçue." /> : null}
          {etat && etat.annonces.length ? (
            <div class="liste sans-bord">
              {etat.annonces.map((a) => (
                <div key={a.id} class="ligne">
                  <span class="ligne-vignette"><Icone n="megaphone" /></span>
                  <span class="ligne-texte"><b>{a.titre}</b><small>{a.texte}</small><small>{dateHeure(a.cree)} · {ilya(a.cree)} · {pluriel(a.destinataires, 'téléphone')}{a.auteur ? ` · ${a.auteur}` : ''}</small></span>
                </div>
              ))}
            </div>
          ) : null}
          {!etat && !erreur ? <div class="squelette" style={{ height: 120 }} /> : null}
        </section>
      </div>
    </>
  );
}
