// Sokoyetu — erreurs dans le navigateur : signalées au journal du serveur, et un écran clair (jamais une page blanche).
import { Component } from 'preact';
import { Icone } from './icones.jsx';

const DEMO = typeof __DEMO__ !== 'undefined' && __DEMO__;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '';
const vus = new Set();
let envoyes = 0;

/*
 * Signale une erreur au serveur (journal → administration, Plus → Santé et journal). Cinq au plus par page ouverte,
 * une seule fois chacune, sans rien d'autre que le message, la page et l'endroit du code : ni nom ni téléphone.
 */
export function signalerErreur(e, genre = 'erreur') {
  try {
    const message = String((e && (e.message || e.reason)) || e || 'Erreur inconnue').slice(0, 300);
    const cle = genre + '|' + message;
    if (DEMO || envoyes >= 5 || vus.has(cle)) return;
    vus.add(cle); envoyes++;
    const corps = {
      app: typeof __APP__ !== 'undefined' ? __APP__ : 'boutique', genre, message, version: VERSION,
      page: location.pathname + (location.hash ? location.hash.replace(/[?].*$/, '') : ''),
      source: (e && e.filename) || '', ligne: (e && e.lineno) || 0, colonne: (e && e.colno) || 0,
      pile: String((e && e.stack) || (e && e.error && e.error.stack) || '').slice(0, 1500)
    };
    fetch('/api/sokoyetu/erreur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), keepalive: true, credentials: 'same-origin' }).catch(() => { });
  } catch (x) { /* le signalement ne doit jamais provoquer d'autre erreur */ }
}

/* Erreurs non rattrapées de toute l'application (code, promesses). */
export function surveillerErreurs() {
  window.addEventListener('error', (ev) => {
    // Une image ou un script qui ne charge pas n'est pas une erreur du code.
    if (!ev || !ev.message) return;
    signalerErreur({ message: ev.message, filename: ev.filename, lineno: ev.lineno, colno: ev.colno, stack: ev.error && ev.error.stack });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev && ev.reason;
    // Coupures réseau déjà annoncées à l'écran (ErreurApi « reseau ») : pas une erreur du code.
    if (r && (r.code === 'reseau' || r.name === 'AbortError')) return;
    signalerErreur(r && r.message ? r : { message: String(r) }, 'promesse');
  });
  window.__sokoyetuDemarre = true; // l'écran de démarrage lent (demarrage.js) n'a plus lieu d'être
}

/* Écran affiché à la place d'une page qui a planté. */
export function EcranErreur({ accueil = '/', onReessayer }) {
  return (
    <div class="ecran-erreur" role="alert">
      <div class="vide-icone" aria-hidden="true"><Icone n="alerte" /></div>
      <h1>Cette page a rencontré un problème</h1>
      <p class="attenue">Rien n’est perdu : votre panier et vos commandes sont gardés. Le problème nous a été signalé automatiquement.</p>
      <div class="rangee-l centre">
        <button class="btn btn-primaire" onClick={() => (onReessayer ? onReessayer() : location.reload())}><Icone n="actualiser" />Recharger la page</button>
        <a class="btn btn-secondaire" href={accueil}>Retour à l’accueil</a>
      </div>
    </div>
  );
}

/*
 * Garde-fou autour d'une page : si elle plante pendant l'affichage, l'écran d'erreur la remplace (le reste de
 * l'application — navigation, panier — continue de fonctionner). Changer de page (clé) le remet à zéro.
 */
export class Garde extends Component {
  constructor() { super(); this.state = { erreur: null }; }
  static getDerivedStateFromError(erreur) { return { erreur }; }
  componentDidCatch(erreur) { signalerErreur(erreur, 'affichage'); }
  render() {
    if (this.state.erreur) return <EcranErreur accueil={this.props.accueil} onReessayer={() => this.setState({ erreur: null })} />;
    return this.props.children;
  }
}
