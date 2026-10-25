// Sokoyetu (administration) — cadre : barre latérale (ordinateur), navigation du bas (téléphone), en-têtes de page.
import { Icone } from '../../commun/js/icones.jsx';
import { classes } from '../../commun/js/outils.js';
import { route, lien, retour } from '../routeur.js';
import { cfg, aTraiter, compte } from '../etat.js';

/* La boutique est une application séparée : son adresse se déduit de celle de l'administration. */
export function adresseBoutique(chemin = '/') {
  if (typeof __DEMO__ !== 'undefined' && __DEMO__) return '../boutique/index.html#' + chemin;
  const h = location.host.replace(/^admin\./, '');
  return `${location.protocol}//${h}${chemin}`;
}

const SECTIONS = [
  ['/', 'tableau', 'Tableau de bord', 'accueil'],
  ['/commandes', 'commandes', 'Commandes', 'recu'],
  ['/produits', 'produits', 'Produits', 'etiquette'],
  ['/clients', 'clients', 'Clients', 'personnes'],
  ['/rayons', 'rayons', 'Rayons', 'rayons'],
  ['/bannieres', 'bannieres', 'Bannières', 'megaphone'],
  ['/remises', 'remises', 'Réductions', 'pourcent'],
  ['/reglages', 'reglages', 'Réglages', 'reglages']
];
export function sectionActive() {
  const s = route.value.segs[0] || '';
  if (!s) return 'tableau';
  if (s === 'plus' || s === 'compte') return 'plus';
  if (s === 'historique') return 'commandes';
  return s;
}

export function BarreLaterale() {
  const actif = sectionActive(); const n = aTraiter.value; const c = cfg.value;
  return (
    <aside class="laterale" aria-label="Navigation de l’administration">
      <a href={lien('/')} class="laterale-marque"><span class="marque">{c.name}<i>.</i></span><small>Gestion</small></a>
      <nav>
        {SECTIONS.map(([chemin, cle, texte, icone]) => (
          <a key={cle} href={lien(chemin)} aria-current={actif === cle ? 'page' : undefined}>
            <Icone n={icone} /><span>{texte}</span>{cle === 'commandes' && n ? <span class="pastille-compte">{n}</span> : null}
          </a>
        ))}
      </nav>
      <div class="laterale-bas">
        <a class="btn btn-doux btn-bloc" href={adresseBoutique('/')} target="_blank" rel="noopener"><Icone n="oeil" />Voir la boutique</a>
        <a href={lien('/compte')} class="laterale-compte" aria-current={route.value.segs[0] === 'compte' ? 'page' : undefined}>
          <span class="initiale petite" aria-hidden="true">{((compte.value && compte.value.email) || '?')[0].toUpperCase()}</span>
          <span class="une-ligne">{compte.value && compte.value.email}</span>
        </a>
      </div>
    </aside>
  );
}

export function NavBasAdmin() {
  const actif = sectionActive(); const n = aTraiter.value;
  const onglets = [['/', 'tableau', 'Accueil', 'accueil'], ['/commandes', 'commandes', 'Commandes', 'recu'], ['/produits', 'produits', 'Produits', 'etiquette'], ['/clients', 'clients', 'Clients', 'personnes'], ['/plus', 'plus', 'Plus', 'rayons']];
  const dansPlus = ['rayons', 'bannieres', 'remises', 'reglages', 'plus'].includes(actif);
  return (
    <nav class="nav-bas seulement-mobile" aria-label="Navigation">
      <div class="nav-bas-in" style={{ '--n': 5 }}>
        {onglets.map(([chemin, cle, texte, icone]) => {
          const on = cle === 'plus' ? dansPlus : actif === cle;
          return (
            <a key={cle} href={lien(chemin)} aria-current={on ? 'page' : undefined}>
              <span class="ic-bulle"><Icone n={icone} />{cle === 'commandes' && n ? <span class="pastille-compte">{n > 99 ? '99+' : n}</span> : null}</span>{texte}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/* En-tête de page : titre, sous-titre, retour éventuel, actions. */
export function TetePage({ titre, sous, parent, actions, grand }) {
  return (
    <header class={classes('tete-page', grand && 'grand')}>
      {parent !== undefined ? <button class="btn-icone" onClick={() => retour(parent)} aria-label="Retour"><Icone n="retour" /></button> : null}
      <div class="tete-texte"><h1>{titre}</h1>{sous ? <p>{sous}</p> : null}</div>
      {actions ? <div class="tete-actions">{actions}</div> : null}
    </header>
  );
}

/* Barre d'enregistrement collée en bas des formulaires. */
export function BarreEnregistrer({ onEnregistrer, onAnnuler, occupe, desactive, libelle = 'Enregistrer', modifie }) {
  return (
    <div class="barre-enregistrer">
      <div class="barre-enregistrer-in">
        <span class="barre-etat">{modifie ? <><i class="point-modifie" aria-hidden="true" />Modifications non enregistrées</> : 'Aucune modification'}</span>
        <button class="btn btn-fantome" onClick={onAnnuler}>Annuler</button>
        <button class={classes('btn btn-primaire', occupe && 'charge')} onClick={onEnregistrer} disabled={desactive || occupe}>{libelle}</button>
      </div>
    </div>
  );
}

export function Kpi({ libelle, icone, valeur, sous, href, ton, grand }) {
  const contenu = <><span class="kpi-lib"><Icone n={icone} />{libelle}</span><span class="kpi-val">{valeur}</span>{sous ? <span class={classes('kpi-sous', ton && 'ton-texte-' + ton)}>{sous}</span> : null}</>;
  return href ? <a class={classes('kpi', grand && 'grand')} href={href}>{contenu}</a> : <div class={classes('kpi', grand && 'grand')}>{contenu}</div>;
}
