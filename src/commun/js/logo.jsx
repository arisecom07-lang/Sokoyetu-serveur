// Sokoyetu — le logo « Cabas » : le sac de la boutique en blason, S de Fraunces en réserve, point or.
// Le sac prend la couleur du texte (currentColor) et le point garde l'or : il marche en clair, en sombre et sur photo.
// Sources et déclinaisons : medias/marque/ (logo-cabas.svg, icônes, timbre du reçu).
import { CABAS_GRAND as GRAND, CABAS_PETIT as PETIT } from './cabas.js';

export function Cabas({ taille = 40, petit = taille < 40, classe }) {
  return (
    <svg class={classe ? 'cabas ' + classe : 'cabas'} viewBox="38 39 183 201" width={Math.round(taille * 183 / 201)} height={taille} aria-hidden="true" focusable="false">
      <g transform="translate(0 6)"><path d={petit ? PETIT : GRAND} fill="currentColor" fill-rule="evenodd" /><circle cx="204" cy="50" r="15" fill="var(--or, #C8902E)" /></g>
    </svg>
  );
}
