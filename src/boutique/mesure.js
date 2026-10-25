// Sokoyetu (boutique) — mesure d'audience facultative, chargée seulement avec l'accord du visiteur.
import { signal } from '@preact/signals';
import { Local } from '../commun/js/stockage.js';

export const OUTILS = {
  ga4: { label: 'Google Analytics 4', test: /^G-[A-Z0-9]{4,12}$/, aide: 'Identifiant de mesure, ex. G-ABC123XYZ' },
  plausible: { label: 'Plausible (sans cookie)', test: /^[a-z0-9.-]+\.[a-z]{2,}$/, aide: 'Votre domaine, ex. sokoyakwetu.com' },
  goatcounter: { label: 'GoatCounter (sans cookie)', test: /^[a-z0-9-]{2,40}$/, aide: 'Votre code, ex. sokoyetu' }
};

export const consentement = signal(Local.lire('consentement', null));
export function consentir(oui) { consentement.value = { mesure: !!oui, le: Date.now() }; Local.ecrire('consentement', consentement.value); }
export const mesureConfiguree = (cfg) => { const a = cfg.analytics || {}; const o = OUTILS[a.provider]; return !!(o && o.test.test(a.id || '')); };

let actif = false;
export function chargerMesure(cfg) {
  const a = cfg.analytics || {};
  if (actif || !mesureConfiguree(cfg) || !(consentement.value && consentement.value.mesure) || location.protocol !== 'https:') return;
  actif = true;
  const s = document.createElement('script'); s.async = true;
  if (a.provider === 'ga4') {
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', a.id, { anonymize_ip: true, send_page_view: false });
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(a.id);
  } else if (a.provider === 'plausible') {
    s.defer = true; s.dataset.domain = a.id; s.src = 'https://plausible.io/js/script.manual.js';
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  } else {
    s.dataset.goatcounter = `https://${a.id}.goatcounter.com/count`; s.dataset.goatcounterSettings = '{"no_onload":true}'; s.src = 'https://gc.zgo.at/count.js';
  }
  document.head.appendChild(s);
}
export function mesurerPage(chemin, titre) {
  if (!actif) return;
  try {
    if (window.gtag) window.gtag('event', 'page_view', { page_title: titre, page_location: location.origin + chemin });
    else if (window.plausible) window.plausible('pageview', { u: location.origin + chemin });
    else if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: chemin, title: titre });
  } catch (e) { }
}
export function mesurerEvenement(nom, params = {}) {
  if (!actif) return;
  try {
    if (window.gtag) window.gtag('event', nom, params);
    else if (window.plausible) window.plausible(nom, { props: params });
    else if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'evenement-' + nom, event: true });
  } catch (e) { }
}
