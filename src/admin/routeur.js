// Sokoyetu (administration) — navigation par fragment (#/commandes/abc), avec garde des modifications non enregistrées.
import { signal } from '@preact/signals';
import { feuilleOuverte, fermerTout, confirmer } from '../commun/js/interface.jsx';

function analyser(h) {
  const chemin = String(h || '').replace(/^#/, '') || '/';
  const [p, q] = chemin.split('?');
  return { chemin: p || '/', segs: (p || '/').split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q || ''), cle: chemin };
}
export const route = signal(analyser(location.hash));
export const lien = (chemin) => '#' + chemin;

/* Un formulaire modifié déclare sa garde ; on demande confirmation avant de le quitter. */
let garde = null;
export function garder(fn) { garde = fn; return () => { if (garde === fn) garde = null; }; }
const modifie = () => !!(garde && garde());
window.addEventListener('beforeunload', (e) => { if (modifie()) { e.preventDefault(); e.returnValue = ''; } });

let profondeur = 0; let precedent = location.hash || '#/';
async function quitterAutorise() {
  if (!modifie()) return true;
  return confirmer({ titre: 'Quitter sans enregistrer ?', texte: 'Vos modifications seront perdues.', ok: 'Quitter sans enregistrer', annuler: 'Rester', danger: true });
}

export async function aller(chemin, { remplacer = false, forcer = false } = {}) {
  if (!forcer && !(await quitterAutorise())) return;
  garde = null;
  const h = '#' + chemin;
  if (remplacer) { history.replaceState(null, '', h); } else { profondeur++; history.pushState(null, '', h); }
  precedent = h; route.value = analyser(h); window.scrollTo(0, 0);
}
export function retour(parent = '/') { if (profondeur > 0) history.back(); else aller(parent, { remplacer: true }); }

window.addEventListener('popstate', async () => {
  if (feuilleOuverte.value) { fermerTout(); history.pushState(null, '', precedent); return; }
  if (modifie()) {
    const vers = location.hash;
    history.pushState(null, '', precedent);
    if (!(await quitterAutorise())) return;
    garde = null; history.replaceState(null, '', vers); precedent = vers; route.value = analyser(vers); window.scrollTo(0, 0); return;
  }
  profondeur = Math.max(0, profondeur - 1);
  precedent = location.hash || '#/'; route.value = analyser(location.hash); window.scrollTo(0, 0);
});
window.addEventListener('hashchange', () => { if ((location.hash || '#/') !== precedent) { precedent = location.hash || '#/'; route.value = analyser(location.hash); } });

/* Liens internes : passent par aller() pour respecter la garde. */
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); aller(a.getAttribute('href').slice(1));
});
