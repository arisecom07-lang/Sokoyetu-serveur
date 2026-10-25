// Sokoyetu (boutique) — outils partagés par les pages.
import { useEffect } from 'preact/hooks';
import { pageSeo } from '../seo.js';
import { mesurerPage } from '../mesure.js';
import { cfg } from '../etat.js';
import { route } from '../routeur.js';

/* Titre, description et données structurées de la page ; mesure de la visite si acceptée. */
export function useSeo(fn, deps) {
  useEffect(() => {
    const c = cfg.value; const s = fn(c) || {};
    const titre = s.titre ? `${s.titre} · ${c.name}` : `${c.name} · ${c.tagline}`;
    pageSeo({ ...s, titre, description: s.description || `${c.name} : ${c.tagline}. Livraison à Bukavu et Goma, paiement Mobile Money, articles importés de Chine en ~${c.importDays} jours.`, chemin: s.chemin === undefined ? route.value.chemin : s.chemin });
    mesurerPage(route.value.cle, titre);
  }, deps);
}
