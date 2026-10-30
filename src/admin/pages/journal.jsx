// Sokoyetu (administration) — santé du serveur (sauvegardes, paiement, alerte) et journal des erreurs du site.
import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icone } from '../../commun/js/icones.jsx';
import { Note, Vide, Pastille, Segment, toast, useParPage, AfficherPlus } from '../../commun/js/interface.jsx';
import { requete, DEMO } from '../../commun/js/api.js';
import { Local } from '../../commun/js/stockage.js';
import { dateHeure, ilya, pluriel, classes, copier } from '../../commun/js/outils.js';
import { etatServeur, sante, lireSante, gererErreur } from '../etat.js';
import { TetePage, adresseBoutique } from '../composants/cadre.jsx';

const PERIODES = [[1, '24 h'], [7, '7 jours'], [30, '30 jours']];
const LIBELLES = {
  app: 'Application', genre: 'Type', page: 'Page', source: 'Fichier', ligne: 'Ligne', version: 'Version', agent: 'Navigateur',
  module: 'Module', commande: 'Commande', erreur: 'Erreur', detail: 'Détail', statut: 'Réponse', method: 'Méthode', url: 'Adresse',
  status: 'Statut', error: 'Erreur', details: 'Détails', pile: 'Pile d’appels'
};
const APPS = { boutique: 'Boutique', admin: 'Administration' };

/* D'où vient l'erreur, en clair : navigateur d'un client, serveur, ou requête qui a échoué. */
function origine(x) {
  const d = x.details || {};
  if (d.type === 'navigateur') return `${APPS[d.app] || 'Navigateur'} · navigateur${d.page ? ' · ' + d.page : ''}`;
  if (d.type === 'request') return `Requête ${d.method || ''} ${String(d.url || '').replace(/[?#].*$/, '')}${d.status ? ' · ' + d.status : ''}`.replace(/\s+/g, ' ');
  return `Serveur${d.module ? ' · ' + d.module : ''}`;
}
const enTexte = (x) => [`${x.niveau === 'erreur' ? 'Erreur' : 'Alerte'} · ${dateHeure(x.quand)}`, x.message, origine(x),
  ...Object.keys(x.details || {}).filter((k) => k !== 'type').map((k) => `${LIBELLES[k] || k} : ${x.details[k]}`)].join('\n');

function EntreeJournal({ x }) {
  const d = x.details || {};
  const cles = Object.keys(d).filter((k) => k !== 'type' && k !== 'pile');
  return (
    <details class="entree-journal">
      <summary>
        <Pastille ton={x.niveau === 'erreur' ? 'danger' : 'alerte'} point>{x.niveau === 'erreur' ? 'Erreur' : 'Alerte'}</Pastille>
        <span class="ej-texte"><b>{x.message}</b><small>{dateHeure(x.quand)} · {origine(x)}</small></span>
      </summary>
      <div class="ej-detail">
        {cles.length ? <dl class="infos">{cles.map((k) => <Fragment key={k}><dt>{LIBELLES[k] || k}</dt><dd>{String(d[k])}</dd></Fragment>)}</dl> : null}
        {d.pile ? <pre class="ej-pile">{d.pile}</pre> : null}
        <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(enTexte(x))) toast('Détail copié : vous pouvez l’envoyer à votre développeur'); }}><Icone n="copier" />Copier le détail</button>
      </div>
    </details>
  );
}

/* Paiement : branché, en mode test, ou ne répond plus (le serveur fait une pause après trois échecs). */
const duree = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
function textePaiement(p) {
  if (!p || !p.pret) return 'Non branché';
  if (p.panne) return `Ne répond plus depuis ${duree(p.panne)}`;
  return p.test ? 'Mode test (aucun argent)' : `${p.fournisseur === 'flexpay' ? 'FlexPay' : p.fournisseur} · répond`;
}

export function Journal() {
  const [jours, setJours] = useState(Local.lire('joursJournal', 7));
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [santeKo, setSanteKo] = useState('');
  const actualiser = async () => {
    setOccupe(true);
    await Promise.all([
      requete(`sokoyetu/journal?jours=${jours}&limite=200`).then((j) => { setListe((j && j.erreurs) || []); setErreur(''); })
        .catch((e) => { if (e.status === 401) gererErreur(e); setErreur(e.message || 'Journal indisponible pour le moment.'); }),
      lireSante().then(() => setSanteKo('')).catch((e) => setSanteKo(e.message || 'Le serveur ne répond pas.'))
    ]);
    setOccupe(false);
  };
  useEffect(() => { actualiser(); }, [jours]);
  const changer = (j) => { setJours(j); Local.ecrire('joursJournal', j); };
  const page = useParPage(liste || [], 40, String(jours));

  const s = sante.value; const d = s && s.details; const ia = etatServeur.value.iaQuota;
  const problemes = (d && d.problemes) || [];
  const v = d && d.sauvegardes && d.sauvegardes.verification;
  const urlSante = adresseBoutique('/api/sokoyetu/sante');

  return (
    <>
      <TetePage titre="Santé et journal" sous="Sauvegardes, paiement et erreurs du site" parent="/plus"
        actions={<button class={classes('btn btn-secondaire btn-s', occupe && 'charge')} disabled={occupe} onClick={actualiser}><Icone n="actualiser" />Actualiser</button>} />
      <div class="pile-l formulaire-etroit">
        {santeKo && !d ? <Note ton="danger" icone="alerte"><b>Le serveur ne répond pas correctement.</b> {santeKo}</Note>
          : !d ? <div class="squelette" style={{ height: 64 }} aria-busy="true" aria-label="Chargement" />
            : problemes.length ? problemes.map((p, i) => <Note key={i} ton={p.grave ? 'danger' : 'alerte'} icone={p.grave ? 'alerte' : 'info'}>{p.texte}</Note>)
              : <Note ton="ok" icone="coche">Tout fonctionne : sauvegardes à jour, paiement joignable, pas d’erreur inquiétante.</Note>}

        <section class="carte">
          <h2 class="carte-titre"><Icone n="bouclier" />État du serveur</h2>
          {d ? (
            <dl class="infos">
              <dt>Serveur</dt><dd>{s.ok ? 'Répond' : 'Base de données en panne'} · {s.version}</dd>
              <dt>Sauvegarde de la nuit</dt><dd>{d.sauvegardes.derniere ? `${ilya(d.sauvegardes.derniere)} · ${pluriel(d.sauvegardes.nombre, 'gardée', 'gardées')}` : 'Aucune pour l’instant'}</dd>
              <dt>Restauration vérifiée</dt><dd>{v ? `${v.ok ? 'Réussie' : 'Échec'} ${ilya(v.quand)}` : 'Pas encore (chaque dimanche)'}</dd>
              <dt>Paiement</dt><dd>{textePaiement(d.paiement)}</dd>
              <dt>Assistant IA</dt><dd>{etatServeur.value.ia && ia ? `${ia.utilises} fiche${ia.utilises > 1 ? 's' : ''} sur ${ia.max} aujourd’hui` : 'Non activé'}</dd>
              <dt>Erreurs</dt><dd>{d.erreurs.heure} dans l’heure · {d.erreurs.jour} sur 24 h</dd>
              <dt>Alerte en cas de panne</dt><dd>{d.alerte.configuree ? (d.alerte.dernier ? `Branchée · signal ${ilya(d.alerte.dernier)}` : 'Branchée') : 'Non branchée'}</dd>
            </dl>
          ) : <div class="squelette" style={{ height: 180 }} />}
        </section>

        <section class="carte">
          <h2 class="carte-titre"><Icone n="alerte" />Journal des erreurs</h2>
          <p class="attenue petit">Erreurs du serveur et des navigateurs (boutique et administration), gardées 30 jours. Les refus ordinaires (mot de passe faux, article épuisé) n’y figurent pas.</p>
          <div class="espace-haut"><Segment libelle="Période du journal" options={PERIODES} valeur={jours} onChange={(x) => changer(Number(x))} /></div>
          {erreur ? (
            <div class="etat-erreur" role="alert">
              <div class="vide-icone" aria-hidden="true"><Icone n="alerte" /></div>
              <h2>Journal indisponible</h2>
              <p>{erreur}</p>
              <div class="rangee-l"><button class={classes('btn btn-primaire', occupe && 'charge')} disabled={occupe} onClick={actualiser}><Icone n="actualiser" />Réessayer</button></div>
            </div>
          ) : liste === null ? <div class="squelette espace-haut" style={{ height: 120 }} aria-busy="true" aria-label="Chargement" />
            : liste.length ? <><div class="journal espace-haut">{page.visibles.map((x) => <EntreeJournal key={x.id} x={x} />)}</div><AfficherPlus page={page} total={liste.length} libelle="entrée" /></>
              : <Vide icone="coche" titre="Aucune erreur" texte={DEMO ? 'La démonstration n’a pas de journal : sur votre serveur, les erreurs apparaissent ici.' : 'Rien à signaler sur la période : le site fonctionne normalement.'} />}
        </section>

        <section class="carte">
          <h2 class="carte-titre"><Icone n="cloche" />Être prévenu si le site tombe</h2>
          <div class="pile">
            <p class="attenue petit">Créez un contrôle gratuit sur healthchecks.io (période 5 minutes), puis collez son adresse dans la console du Droplet. Le serveur y envoie un signal toutes les 5 minutes : s’il s’arrête, ou si une sauvegarde ou le paiement pose problème, vous recevez un e-mail ou un message Telegram.</p>
            <code class="commande">sudo /opt/sokoyetu/alerte.sh https://hc-ping.com/VOTRE-ID</code>
            <p class="attenue petit">En complément, un service comme UptimeRobot peut surveiller cette adresse (réponse 200 quand tout va bien) :</p>
            <div class="a-copier-admin"><div><small>Adresse à surveiller</small><span class="code">{urlSante}</span></div><button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(urlSante)) toast('Adresse copiée'); }}><Icone n="copier" />Copier</button></div>
            <p class="attenue petit">Vérifier à la main que la dernière sauvegarde se restaure (fait seul chaque dimanche) :</p>
            <code class="commande">sudo /opt/sokoyetu/sauvegarde.sh verifier</code>
          </div>
        </section>
      </div>
    </>
  );
}
