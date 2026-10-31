// Sokoyetu (boutique) — « Ma cagnotte » : solde, gains à venir, historique, et le parrainage (lien à partager aux proches).
import { useEffect, useState } from 'preact/hooks';
import { Icone } from '../../commun/js/icones.jsx';
import { Vide, toast, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { dollars, dateHeure, copier, pluriel } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { cfg, client } from '../etat.js';
import { InvitationCompte } from './connexion.jsx';
import { EntetePage, Pied } from '../composants/cadre.jsx';
import { useSeo } from './commun.jsx';
import { cagnotte, chargerCagnotte, cagnotteOuverte, lienParrainage } from '../fidelite.js';
import { partager } from '../partage.jsx';
import { t, tx } from '../../commun/js/langue.js';

const MOUVEMENTS = {
  achat: (m) => ['tirelire', t('Commande #{0} livrée', [m.numero])],
  parrainage: (m) => ['cadeau', t('Parrainage : {0}', [m.filleul || t('un proche')])],
  geste: (m) => ['cadeau', m.motif ? t('Cadeau de la boutique : {0}', [m.motif]) : t('Cadeau de la boutique')],
  utilise: (m) => ['recu', t('Utilisée sur la commande #{0}', [m.numero])]
};

/* Arrivée avec un lien de parrainage : le cadeau est annoncé une fois. */
export function ouvrirCadeauBienvenue(p) {
  const c = cfg.value;
  const id = ouvrirFeuille({
    titre: t('Un cadeau pour vous'),
    contenu: () => (
      <div class="cadeau-bienvenue">
        <span class="cadeau-icone" aria-hidden="true"><Icone n="cadeau" /></span>
        <p class="cadeau-montant num">{tx('{0} offerts', [dollars(p.montant)])}</p>
        <p>{tx('{0} sur {1} : {2} de réduction sur votre première commande{3}.', [p.prenom ? t('{0} vous invite', [p.prenom]) : t('Un proche vous invite'), c.name, dollars(p.montant), p.min ? t(', dès {0} d’achat', [dollars(p.min)]) : ''])}</p>
        <p class="discret petit">{client.value ? t('Il s’applique tout seul au moment de payer.') : t('Il s’applique au moment de payer, avec votre compte : gratuit, sans mot de passe.')}</p>
      </div>
    ),
    pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => fermerFeuille(id)}><Icone n="sac" />{t('Découvrir la boutique')}</button>
  });
}

function Parrainage({ p }) {
  const c = cfg.value; const url = lienParrainage(p.code);
  const texte = t('Je te recommande {0} : {1} offerts sur ta première commande{2}, avec mon lien ou mon code {3}.', [c.name, dollars(p.bienvenue), p.min ? t(' dès {0} d’achat', [dollars(p.min)]) : '', p.code]);
  return (
    <section class="carte carte-parrainage" aria-labelledby="parrainage-titre">
      <h2 class="carte-titre" id="parrainage-titre"><Icone n="cadeau" />{t('Parrainez vos proches')}</h2>
      <p class="parrainage-offre">{tx('Offrez {0} sur leur première commande, et gagnez {1} quand elle est livrée.', [<b class="num">{dollars(p.bienvenue)}</b>, <b class="num">{dollars(p.recompense)}</b>])}</p>
      <div class="parrainage-code">
        <div><small>{t('Votre code')}</small><b class="code">{p.code}</b></div>
        <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(p.code)) toast(t('Code copié')); }} aria-label={t('Copier le code {0}', [p.code])}><Icone n="copier" />{t('Copier')}</button>
      </div>
      <button class="btn btn-primaire btn-bloc" onClick={() => partager({ titre: t('{0} : {1} offerts', [c.name, dollars(p.bienvenue)]), texte, url, type: 'parrainage' })}><Icone n="partager" />{t('Partager mon lien')}</button>
      <p class="discret petit">{tx('Vos proches ouvrent votre lien, ou saisissent votre code à la place d’un code promo. Le cadeau s’applique sur la première commande d’un nouveau compte{0}.', [p.min ? t(', dès {0} d’achat', [dollars(p.min)]) : ''])}</p>
      <dl class="parrainage-chiffres">
        <div><dt>{t('Proches parrainés')}</dt><dd class="num">{p.filleuls}</dd></div>
        <div><dt>{t('Déjà gagnés')}</dt><dd class="num">{dollars(p.gagne)}</dd></div>
      </dl>
      {p.enCours.length ? (
        <ul class="parrainage-en-cours">
          {p.enCours.map((x, i) => <li key={i}><Icone n="horloge" /><span>{tx('{0} : première commande en route, {1} pour vous à la livraison', [<b>{x.filleul}</b>, <span class="num">+{dollars(x.montant)}</span>])}</span></li>)}
        </ul>
      ) : null}
    </section>
  );
}

export function MaCagnotte() {
  const cl = client.value; const g = cagnotte.value; const ouverte = cagnotteOuverte.value;
  const [erreur, setErreur] = useState('');
  useSeo(() => ({ titre: t('Ma cagnotte'), noindex: true }), []);
  const charger = () => { setErreur(''); chargerCagnotte().catch((e) => setErreur(e.message)); };
  useEffect(() => { if (cl && ouverte) charger(); }, [cl && cl.id, ouverte]);
  const pct = cfg.value.loyalty ? cfg.value.loyalty.pct : 0;
  let contenu;
  if (!ouverte) contenu = <Vide icone="tirelire" titre={t('Pas encore de cagnotte')} texte={t('La boutique ne propose pas encore de cagnotte de fidélité. Revenez bientôt !')}><a class="btn btn-primaire" href={lien('/')}>{t('Continuer mes achats')}</a></Vide>;
  else if (!cl) contenu = <InvitationCompte titre={t('Votre cagnotte vous attend')} texte={t('Chaque commande livrée vous rapporte {0} % de vos achats, à utiliser sur les suivantes. Connectez-vous pour la voir et l’utiliser.', [pct])} retour="/compte/cagnotte" />;
  else if (!g) contenu = erreur ? <Vide icone="alerte" titre={t('Cagnotte indisponible')} texte={erreur}><button class="btn btn-primaire" onClick={charger}><Icone n="actualiser" />{t('Réessayer')}</button></Vide> : <div class="squelette" style={{ height: 320 }} />;
  else {
    contenu = (
      <div class="cagnotte-grille">
        <div class="pile-l">
          <section class="carte cagnotte-solde" aria-labelledby="solde-titre">
            <span class="cagnotte-icone" aria-hidden="true"><Icone n="tirelire" /></span>
            <h2 id="solde-titre" class="cagnotte-libelle">{t('Disponible')}</h2>
            <p class="cagnotte-montant num">{dollars(g.solde)}</p>
            <p class="attenue petit">{t('À utiliser au moment de payer vos prochaines commandes, jusqu’à la moitié des articles.')}</p>
            {g.aVenir > 0 ? <p class="cagnotte-a-venir"><Icone n="horloge" /><span>{tx('{0} à venir : versés à la livraison de vos commandes en cours.', [<b class="num">+{dollars(g.aVenir)}</b>])}</span></p> : null}
            {g.solde > 0 ? <a class="btn btn-primaire btn-bloc" href={lien('/')}><Icone n="sac" />{t('Faire mes achats')}</a> : null}
          </section>
          <section class="carte" aria-labelledby="comment-titre">
            <h2 class="carte-titre" id="comment-titre"><Icone n="info" />{t('Comment ça marche')}</h2>
            <ol class="cagnotte-etapes">
              <li><b>{t('Commandez')}</b><small>{tx('Chaque commande livrée vous rapporte {0} % de ses articles.', [g.pct])}</small></li>
              <li><b>{t('Cumulez')}</b><small>{tx('Votre cagnotte grandit à chaque livraison{0}.', [g.parrainage ? t(', et à chaque proche parrainé') : ''])}</small></li>
              <li><b>{t('Utilisez-la')}</b><small>{t('Au moment de payer, cochez « Utiliser ma cagnotte » : elle règle jusqu’à la moitié des articles.')}</small></li>
            </ol>
          </section>
        </div>
        <div class="pile-l">
          {g.parrainage ? <Parrainage p={g.parrainage} /> : null}
          <section class="carte" aria-labelledby="historique-titre">
            <h2 class="carte-titre" id="historique-titre"><Icone n="recu" />{t('Historique')}{g.mouvements.length ? <span class="fin">{pluriel(g.mouvements.length, 'mouvement')}</span> : null}</h2>
            {g.mouvements.length ? (
              <ul class="cagnotte-mouvements">
                {g.mouvements.map((m, i) => {
                  const [icone, titre] = (MOUVEMENTS[m.type] || MOUVEMENTS.geste)(m);
                  return <li key={i}><span class="menu-icone"><Icone n={icone} /></span><span class="mv-texte"><b>{titre}</b><small>{dateHeure(m.le)}</small></span><span class={'num ' + (m.montant < 0 ? 'mv-moins' : 'mv-plus')}>{m.montant < 0 ? dollars(m.montant) : '+' + dollars(m.montant)}</span></li>;
                })}
              </ul>
            ) : <p class="attenue petit">{t('Votre première commande livrée remplira votre cagnotte.')}</p>}
          </section>
        </div>
      </div>
    );
  }
  return (
    <>
      <EntetePage titre={t('Ma cagnotte')} sous={g && cl && ouverte ? t('{0} disponibles', [dollars(g.solde)]) : t('Fidélité et parrainage')} repli="/compte" />
      <main id="contenu" class="page conteneur page-cagnotte">{contenu}</main>
      <Pied />
    </>
  );
}
