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

const MOUVEMENTS = {
  achat: (m) => ['tirelire', `Commande #${m.numero} livrée`],
  parrainage: (m) => ['cadeau', `Parrainage : ${m.filleul || 'un proche'}`],
  geste: (m) => ['cadeau', m.motif ? `Cadeau de la boutique : ${m.motif}` : 'Cadeau de la boutique'],
  utilise: (m) => ['recu', `Utilisée sur la commande #${m.numero}`]
};

/* Arrivée avec un lien de parrainage : le cadeau est annoncé une fois. */
export function ouvrirCadeauBienvenue(p) {
  const c = cfg.value;
  const id = ouvrirFeuille({
    titre: 'Un cadeau pour vous',
    contenu: () => (
      <div class="cadeau-bienvenue">
        <span class="cadeau-icone" aria-hidden="true"><Icone n="cadeau" /></span>
        <p class="cadeau-montant num">{dollars(p.montant)} offerts</p>
        <p>{p.prenom ? `${p.prenom} vous invite` : 'Un proche vous invite'} sur {c.name} : {dollars(p.montant)} de réduction sur votre première commande{p.min ? `, dès ${dollars(p.min)} d’achat` : ''}.</p>
        <p class="discret petit">{client.value ? 'Il s’applique tout seul au moment de payer.' : 'Il s’applique au moment de payer, avec votre compte : gratuit, sans mot de passe.'}</p>
      </div>
    ),
    pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => fermerFeuille(id)}><Icone n="sac" />Découvrir la boutique</button>
  });
}

function Parrainage({ p }) {
  const c = cfg.value; const url = lienParrainage(p.code);
  const texte = `Je te recommande ${c.name} : ${dollars(p.bienvenue)} offerts sur ta première commande${p.min ? ` dès ${dollars(p.min)} d’achat` : ''}, avec mon lien ou mon code ${p.code}.`;
  return (
    <section class="carte carte-parrainage" aria-labelledby="parrainage-titre">
      <h2 class="carte-titre" id="parrainage-titre"><Icone n="cadeau" />Parrainez vos proches</h2>
      <p class="parrainage-offre">Offrez <b class="num">{dollars(p.bienvenue)}</b> sur leur première commande, et gagnez <b class="num">{dollars(p.recompense)}</b> quand elle est livrée.</p>
      <div class="parrainage-code">
        <div><small>Votre code</small><b class="code">{p.code}</b></div>
        <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(p.code)) toast('Code copié'); }} aria-label={`Copier le code ${p.code}`}><Icone n="copier" />Copier</button>
      </div>
      <button class="btn btn-primaire btn-bloc" onClick={() => partager({ titre: `${c.name} : ${dollars(p.bienvenue)} offerts`, texte, url, type: 'parrainage' })}><Icone n="partager" />Partager mon lien</button>
      <p class="discret petit">Vos proches ouvrent votre lien, ou saisissent votre code à la place d’un code promo. Le cadeau s’applique sur la première commande d’un nouveau compte{p.min ? `, dès ${dollars(p.min)} d’achat` : ''}.</p>
      <dl class="parrainage-chiffres">
        <div><dt>Proches parrainés</dt><dd class="num">{p.filleuls}</dd></div>
        <div><dt>Déjà gagnés</dt><dd class="num">{dollars(p.gagne)}</dd></div>
      </dl>
      {p.enCours.length ? (
        <ul class="parrainage-en-cours">
          {p.enCours.map((x, i) => <li key={i}><Icone n="horloge" /><span><b>{x.filleul}</b> : première commande en route, <span class="num">+{dollars(x.montant)}</span> pour vous à la livraison</span></li>)}
        </ul>
      ) : null}
    </section>
  );
}

export function MaCagnotte() {
  const cl = client.value; const g = cagnotte.value; const ouverte = cagnotteOuverte.value;
  const [erreur, setErreur] = useState('');
  useSeo(() => ({ titre: 'Ma cagnotte', noindex: true }), []);
  const charger = () => { setErreur(''); chargerCagnotte().catch((e) => setErreur(e.message)); };
  useEffect(() => { if (cl && ouverte) charger(); }, [cl && cl.id, ouverte]);
  const pct = cfg.value.loyalty ? cfg.value.loyalty.pct : 0;
  let contenu;
  if (!ouverte) contenu = <Vide icone="tirelire" titre="Pas encore de cagnotte" texte="La boutique ne propose pas encore de cagnotte de fidélité. Revenez bientôt !"><a class="btn btn-primaire" href={lien('/')}>Continuer mes achats</a></Vide>;
  else if (!cl) contenu = <InvitationCompte titre="Votre cagnotte vous attend" texte={`Chaque commande livrée vous rapporte ${pct} % de vos achats, à utiliser sur les suivantes. Connectez-vous pour la voir et l’utiliser.`} retour="/compte/cagnotte" />;
  else if (!g) contenu = erreur ? <Vide icone="alerte" titre="Cagnotte indisponible" texte={erreur}><button class="btn btn-primaire" onClick={charger}><Icone n="actualiser" />Réessayer</button></Vide> : <div class="squelette" style={{ height: 320 }} />;
  else {
    contenu = (
      <div class="cagnotte-grille">
        <div class="pile-l">
          <section class="carte cagnotte-solde" aria-labelledby="solde-titre">
            <span class="cagnotte-icone" aria-hidden="true"><Icone n="tirelire" /></span>
            <h2 id="solde-titre" class="cagnotte-libelle">Disponible</h2>
            <p class="cagnotte-montant num">{dollars(g.solde)}</p>
            <p class="attenue petit">À utiliser au moment de payer vos prochaines commandes, jusqu’à la moitié des articles.</p>
            {g.aVenir > 0 ? <p class="cagnotte-a-venir"><Icone n="horloge" /><span><b class="num">+{dollars(g.aVenir)}</b> à venir : versés à la livraison de vos commandes en cours.</span></p> : null}
            {g.solde > 0 ? <a class="btn btn-primaire btn-bloc" href={lien('/')}><Icone n="sac" />Faire mes achats</a> : null}
          </section>
          <section class="carte" aria-labelledby="comment-titre">
            <h2 class="carte-titre" id="comment-titre"><Icone n="info" />Comment ça marche</h2>
            <ol class="cagnotte-etapes">
              <li><b>Commandez</b><small>Chaque commande livrée vous rapporte {g.pct} % de ses articles.</small></li>
              <li><b>Cumulez</b><small>Votre cagnotte grandit à chaque livraison{g.parrainage ? ', et à chaque proche parrainé' : ''}.</small></li>
              <li><b>Utilisez-la</b><small>Au moment de payer, cochez « Utiliser ma cagnotte » : elle règle jusqu’à la moitié des articles.</small></li>
            </ol>
          </section>
        </div>
        <div class="pile-l">
          {g.parrainage ? <Parrainage p={g.parrainage} /> : null}
          <section class="carte" aria-labelledby="historique-titre">
            <h2 class="carte-titre" id="historique-titre"><Icone n="recu" />Historique{g.mouvements.length ? <span class="fin">{pluriel(g.mouvements.length, 'mouvement')}</span> : null}</h2>
            {g.mouvements.length ? (
              <ul class="cagnotte-mouvements">
                {g.mouvements.map((m, i) => {
                  const [icone, titre] = (MOUVEMENTS[m.type] || MOUVEMENTS.geste)(m);
                  return <li key={i}><span class="menu-icone"><Icone n={icone} /></span><span class="mv-texte"><b>{titre}</b><small>{dateHeure(m.le)}</small></span><span class={'num ' + (m.montant < 0 ? 'mv-moins' : 'mv-plus')}>{m.montant < 0 ? dollars(m.montant) : '+' + dollars(m.montant)}</span></li>;
                })}
              </ul>
            ) : <p class="attenue petit">Votre première commande livrée remplira votre cagnotte.</p>}
          </section>
        </div>
      </div>
    );
  }
  return (
    <>
      <EntetePage titre="Ma cagnotte" sous={g && cl && ouverte ? `${dollars(g.solde)} disponibles` : 'Fidélité et parrainage'} repli="/compte" />
      <main id="contenu" class="page conteneur page-cagnotte">{contenu}</main>
      <Pied />
    </>
  );
}
