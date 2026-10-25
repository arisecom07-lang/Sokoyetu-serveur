// Sokoyetu (boutique) — pages d'information légale et page introuvable.
import { Icone } from '../../commun/js/icones.jsx';
import { Note, toast, confirmer } from '../../commun/js/interface.jsx';
import { date } from '../../commun/js/outils.js';
import { PAGES_LEGALES, ANCIENNES_CLES, texteLegal, blocsLegaux } from '../../commun/js/legal.js';
import { lien, route, naviguer } from '../routeur.js';
import { cfg, effacerAppareil } from '../etat.js';
import { consentement, consentir, mesureConfiguree, chargerMesure } from '../mesure.js';
import { EntetePage, Pied } from '../composants/cadre.jsx';
import { useSeo } from './commun.jsx';
import { Introuvable } from './introuvable.jsx';

export function Infos() {
  const cle = ANCIENNES_CLES[route.value.params.page] || route.value.params.page;
  const titre = PAGES_LEGALES[cle]; const c = cfg.value;
  useSeo(() => (titre ? { titre, description: `${titre} de la boutique ${c.name}.` } : { titre: 'Page introuvable', noindex: true }), [cle]);
  if (!titre) return <Introuvable />;
  const maj = c.legal && c.legal.updatedAt ? date(c.legal.updatedAt, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const mesure = mesureConfiguree(c); const choix = consentement.value;
  return (
    <>
      <EntetePage titre={titre} sous={maj ? `Mise à jour le ${maj}` : ''} repli="/compte" />
      <main id="contenu" class="page conteneur page-infos">
        <div class="infos-grille">
          <article class="carte texte-legal">
            {blocsLegaux(texteLegal(cle, c)).map((b, i) => (b.titre ? <h2 key={i}>{b.titre}</h2> : <p key={i}>{b.lignes.map((l, j) => <>{j ? <br /> : null}{l}</>)}</p>))}
          </article>
          <aside class="pile">
            {cle === 'cookies' ? (
              <section class="carte">
                <h2 class="carte-titre"><Icone n="reglages" />Vos préférences</h2>
                <p class="attenue petit">{mesure ? <>Mesure d’audience : <b>{choix ? (choix.mesure ? 'acceptée' : 'refusée') : 'pas encore choisie'}</b></> : <>Comptage anonyme des visites : <b>{choix && !choix.mesure ? 'refusé' : 'actif'}</b></>}</p>
                <div class="rangee-l espace-haut">
                  <button class="btn btn-secondaire btn-s" onClick={() => { consentir(true); chargerMesure(c); toast(mesure ? 'Merci, mesure d’audience acceptée' : 'Merci, choix enregistré'); }}>Accepter</button><button class="btn btn-secondaire btn-s" onClick={() => { consentir(false); toast('Choix enregistré'); }}>Refuser</button>
                  <button class="btn btn-danger btn-s" onClick={async () => { if (await confirmer({ titre: 'Effacer les données de ce téléphone ?', texte: 'Panier, favoris, coordonnées et liens de suivi seront supprimés.', ok: 'Effacer', danger: true })) { effacerAppareil(); toast('Données effacées', { icone: 'poubelle' }); naviguer('/'); } }}><Icone n="poubelle" />Effacer les données de ce téléphone</button>
                </div>
              </section>
            ) : null}
            <nav class="menu" aria-label="Autres informations">
              {Object.entries(PAGES_LEGALES).filter(([k]) => k !== cle).map(([k, t]) => <a key={k} class="menu-item" href={lien('/infos/' + k)}><span class="menu-icone"><Icone n="recu" /></span><span class="menu-texte"><b>{t}</b></span><Icone n="droite" classe="chevron" /></a>)}
            </nav>
            {cle === 'conditions' ? <Note icone="info">Ces textes s’appliquent aux commandes passées sur {c.name}. Une question ? Écrivez-nous.</Note> : null}
          </aside>
        </div>
      </main>
      <Pied />
    </>
  );
}
