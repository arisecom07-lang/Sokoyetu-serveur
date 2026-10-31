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
import { t, tx, langue } from '../../commun/js/langue.js';

export function Infos() {
  const cle = ANCIENNES_CLES[route.value.params.page] || route.value.params.page;
  const titre = PAGES_LEGALES[cle] ? t(PAGES_LEGALES[cle]) : ''; const c = cfg.value;
  useSeo(() => (titre ? { titre, description: t('{0} de la boutique {1}.', [titre, c.name]) } : { titre: t('Page introuvable'), noindex: true }), [cle, langue.value]);
  if (!titre) return <Introuvable />;
  const maj = c.legal && c.legal.updatedAt ? date(c.legal.updatedAt, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const mesure = mesureConfiguree(c); const choix = consentement.value;
  return (
    <>
      <EntetePage titre={titre} sous={maj ? t('Mise à jour le {0}', [maj]) : ''} repli="/compte" />
      <main id="contenu" class="page conteneur page-infos">
        <div class="infos-grille">
          <article class="carte texte-legal" lang="fr">
            {langue.value !== 'fr' ? <div class="note-langue" lang={langue.value}><Note icone="globe">{t('Ce texte n’existe qu’en français : c’est cette version qui s’applique.')}</Note></div> : null}
            {blocsLegaux(texteLegal(cle, c)).map((b, i) => (b.titre ? <h2 key={i}>{b.titre}</h2> : <p key={i}>{b.lignes.map((l, j) => <>{j ? <br /> : null}{l}</>)}</p>))}
          </article>
          <aside class="pile">
            {cle === 'cookies' ? (
              <section class="carte">
                <h2 class="carte-titre"><Icone n="reglages" />{t('Vos préférences')}</h2>
                <p class="attenue petit">{mesure ? <>{tx('Mesure d’audience : {0}', [<b>{choix ? (choix.mesure ? t('acceptée') : t('refusée')) : t('pas encore choisie')}</b>])}</> : <>{tx('Comptage anonyme des visites : {0}', [<b>{choix && !choix.mesure ? t('refusé') : t('actif')}</b>])}</>}</p>
                <div class="rangee-l espace-haut">
                  <button class="btn btn-secondaire btn-s" onClick={() => { consentir(true); chargerMesure(c); toast(mesure ? t('Merci, mesure d’audience acceptée') : t('Merci, choix enregistré')); }}>{t('Accepter')}</button><button class="btn btn-secondaire btn-s" onClick={() => { consentir(false); toast(t('Choix enregistré')); }}>{t('Refuser')}</button>
                  <button class="btn btn-danger btn-s" onClick={async () => { if (await confirmer({ titre: t('Effacer les données de ce téléphone ?'), texte: t('Panier, favoris, coordonnées et liens de suivi seront supprimés.'), ok: t('Effacer'), danger: true })) { effacerAppareil(); toast(t('Données effacées'), { icone: 'poubelle' }); naviguer('/'); } }}><Icone n="poubelle" />{t('Effacer les données de ce téléphone')}</button>
                </div>
              </section>
            ) : null}
            <nav class="menu" aria-label={t('Autres informations')}>
              {Object.entries(PAGES_LEGALES).filter(([k]) => k !== cle).map(([k, nom]) => <a key={k} class="menu-item" href={lien('/infos/' + k)}><span class="menu-icone"><Icone n="recu" /></span><span class="menu-texte"><b>{t(nom)}</b></span><Icone n="droite" classe="chevron" /></a>)}
            </nav>
            {cle === 'conditions' ? <Note icone="info">{tx('Ces textes s’appliquent aux commandes passées sur {0}. Une question ? Écrivez-nous.', [c.name])}</Note> : null}
          </aside>
        </div>
      </main>
      <Pied />
    </>
  );
}
