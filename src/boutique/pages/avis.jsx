// Sokoyetu (boutique) — « Mes avis » : les articles reçus à noter, et les avis déjà donnés (modifiables).
import { useEffect } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide, Note } from '../../commun/js/interface.jsx';
import { Etoiles } from '../../commun/js/etoiles.jsx';
import { date } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { cfg, produitsParId } from '../etat.js';
import { EntetePage, Pied } from '../composants/cadre.jsx';
import { lienProduit } from '../composants/produits.jsx';
import { ouvrirAvis } from '../composants/avis.jsx';
import { aNoter, aNoterCharge, chargerANoter } from '../avis.js';
import { useSeo } from './commun.jsx';
import { t, tx, tn, aTraduire } from '../../commun/js/langue.js';

const ETATS = { attente: ['info', aTraduire('En attente de vérification')], masque: ['alerte', aTraduire('Non publié')] };

function Article({ a }) {
  const p = produitsParId.value.get(a.produit);
  const x = a.avis;
  return (
    <li class="carte a-noter">
      <a class="a-noter-article" href={p ? lienProduit(p) : lien('/')}>
        <span class="a-noter-photo"><Photo m={p ? R.imagePrincipale(p) : null} alt="" tailles="64px" /></span>
        <span class="a-noter-texte"><b>{a.titre}</b><small>{a.variante ? a.variante + ' · ' : ''}{a.livree ? t('Reçu le {0}', [date(a.livree, { day: 'numeric', month: 'long' })]) : t('Commande #{0}', [a.numero])}</small></span>
      </a>
      {x ? (
        <div class="a-noter-avis">
          <Etoiles note={x.note} />
          {x.texte ? <p class="avis-texte">{x.texte}</p> : null}
          {ETATS[x.etat] ? <Note ton={ETATS[x.etat][0]} icone={x.etat === 'masque' ? 'alerte' : 'horloge'}>{x.etat === 'masque' && x.motif ? t('{0} : {1}.', [t(ETATS[x.etat][1]), t(x.motif)]) : t(ETATS[x.etat][1]) + '.'}</Note> : null}
          {x.reponse ? <div class="avis-reponse"><b><Icone n="boutique" />{tx('Réponse de {0}', [cfg.value.name])}</b><p>{x.reponse}</p></div> : null}
          <button type="button" class="btn btn-secondaire btn-s" onClick={() => ouvrirAvis(a)}><Icone n="crayon" />{t('Modifier')}</button>
        </div>
      ) : (
        <div class="etoiles-rapides" role="group" aria-label={t('Noter « {0} »', [a.titre])}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" class="etoile-rapide" aria-label={tn(n, '{n} étoile sur 5', '{n} étoiles sur 5')} onClick={() => ouvrirAvis(a, { note: n })}><Icone n="etoile" /></button>)}
        </div>
      )}
    </li>
  );
}

export function MesAvis() {
  useSeo(() => ({ titre: t('Mes avis'), noindex: true }), []);
  useEffect(() => { chargerANoter({ force: true }).catch(() => { }); }, []);
  const l = aNoter.value;
  const restants = l.filter((a) => !a.avis); const donnes = l.filter((a) => a.avis);
  return (
    <>
      <EntetePage titre={t('Mes avis')} sous={restants.length ? tn(restants.length, '{n} article à noter', '{n} articles à noter') : t('Articles reçus')} repli="/compte" />
      <main id="contenu" class="page conteneur page-mes-avis">
        {!aNoterCharge.value && !l.length ? <div class="squelette" style={{ height: 180 }} /> : !l.length ? (
          <Vide icone="etoile" titre={t('Aucun article à noter pour le moment')} texte={t('Une fois votre commande reçue, notez ici chacun de ses articles : votre avis aide les autres clients à bien choisir.')}>
            <a class="btn btn-primaire" href={lien('/')}>{t('Voir la boutique')}</a>
          </Vide>
        ) : (
          <div class="pile-l">
            {restants.length ? (
              <section class="pile" aria-labelledby="a-noter-titre">
                <h2 class="sous-titre" id="a-noter-titre">{t('À noter')}</h2>
                <p class="attenue petit">{t('Touchez une étoile : un mot de plus est facultatif. Seuls les clients qui ont reçu l’article peuvent le noter.')}</p>
                <ul class="liste-a-noter">{restants.map((a) => <Article key={a.produit} a={a} />)}</ul>
              </section>
            ) : null}
            {donnes.length ? (
              <section class="pile" aria-labelledby="donnes-titre">
                <h2 class="sous-titre" id="donnes-titre">{t('Mes avis')}</h2>
                <ul class="liste-a-noter">{donnes.map((a) => <Article key={a.produit} a={a} />)}</ul>
              </section>
            ) : null}
          </div>
        )}
      </main>
      <Pied />
    </>
  );
}
