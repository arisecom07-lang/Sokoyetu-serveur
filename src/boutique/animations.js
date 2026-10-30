// Sokoyetu — retours animés de la boutique : sens des transitions de page, panier qui « reçoit » un article.
// Les mouvements eux-mêmes sont dans src/commun/css/animations.css.
import { effect } from '@preact/signals';
import { sens } from './routeur.js';
import { nbArticles } from './etat.js';

// Le sens de navigation (avant / arrière) choisit le côté d'où glisse la nouvelle page.
effect(() => { document.documentElement.dataset.sens = sens.value || ''; });

// Quand le panier grossit, son icône sursaute et sa pastille rebondit, au moment où la photo qui vole (produit.jsx) arrive.
function saluerPanier() {
  const cible = [...document.querySelectorAll('[data-cible-panier]')].find((el) => el.offsetParent !== null);
  if (!cible) return;
  const pastille = cible.querySelector('.pastille-compte');
  [[cible, 'recoit'], [pastille, 'saute']].forEach(([el, c]) => {
    if (!el) return;
    el.classList.remove(c); void el.offsetWidth; el.classList.add(c);
    setTimeout(() => el.classList.remove(c), 600);
  });
}
let avant = nbArticles.peek();
effect(() => {
  const n = nbArticles.value;
  if (n > avant && !matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(saluerPanier, document.querySelector('.volant') ? 600 : 0);
  avant = n;
});
