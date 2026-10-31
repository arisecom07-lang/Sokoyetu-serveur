// Sokoyetu (boutique) — outils partagés par les pages.
import { useEffect } from 'preact/hooks';
import { pageSeo } from '../seo.js';
import { mesurerPage } from '../mesure.js';
import { cfg } from '../etat.js';
import { route } from '../routeur.js';
import { t, langue } from '../../commun/js/langue.js';

/* Titre, description et données structurées de la page ; mesure de la visite si acceptée. */
export function useSeo(fn, deps) {
  useEffect(() => {
    const c = cfg.value; const s = fn(c) || {};
    const titre = s.titre ? `${s.titre} · ${c.name}` : `${c.name} · ${t(c.tagline)}`;
    pageSeo({ ...s, titre, description: s.description || t('{0} : {1}. Livraison à Bukavu et Goma, paiement Mobile Money, articles importés de Chine en ~{2} jours.', [c.name, t(c.tagline), c.importDays]), chemin: s.chemin === undefined ? route.value.chemin : s.chemin });
    mesurerPage(route.value.cle, titre);
  }, deps && [...deps, langue.value]);
}
