// Sokoyetu — thème clair (par défaut) ou sombre (en option, mémorisé sur l'appareil).
import { signal } from '@preact/signals';
import { Local } from './stockage.js';

// Ancienne version : « mode » valait 'dark' ou 'light', « theme » le nom d'une palette.
(function () {
  const ancien = Local.lire('mode', null);
  if (ancien) { Local.ecrire('theme', ancien === 'dark' ? 'sombre' : 'clair'); Local.retirer('mode'); }
  else if (!['clair', 'sombre'].includes(Local.lire('theme', 'clair'))) Local.ecrire('theme', 'clair');
})();

const COULEUR_BARRE = { clair: '#FBF8F4', sombre: '#15110E' };
export const themeSombre = signal(Local.lire('theme', 'clair') === 'sombre');

export function appliquerTheme() {
  const sombre = themeSombre.value;
  document.documentElement.dataset.theme = sombre ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', sombre ? COULEUR_BARRE.sombre : COULEUR_BARRE.clair);
}
export function basculerTheme() {
  themeSombre.value = !themeSombre.value;
  Local.ecrire('theme', themeSombre.value ? 'sombre' : 'clair');
  appliquerTheme();
}
