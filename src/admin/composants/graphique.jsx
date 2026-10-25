// Sokoyetu (administration) — histogramme des ventes par jour.
// Une seule série (pas de légende : le titre la nomme), colonnes de 24 px au plus, arrondies en haut,
// grille discrète, infobulle au survol et au clavier, valeurs aussi disponibles en tableau.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dollars, dollarsCourt, date, pluriel } from '../../commun/js/outils.js';

function maxRond(v) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
/* Colonne arrondie en haut (4 px), carrée sur la ligne de base. */
function colonne(x, y, l, h) {
  const r = Math.min(4, l / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + l - r}Q${x + l},${y} ${x + l},${y + r}V${y + h}Z`;
}

export function Histogramme({ jours, titre = 'Ventes par jour' }) {
  const boite = useRef(null);
  const [largeur, setLargeur] = useState(340);
  const [survol, setSurvol] = useState(-1);
  useEffect(() => {
    const el = boite.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setLargeur(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = 200, g = 44, d = 6, h = 22, b = 26;
  const iw = largeur - g - d, ih = H - h - b;
  const mx = Math.max(0, ...jours.map((j) => j.v)); const max = maxRond(mx);
  const n = jours.length; const pas = iw / n; const l = Math.max(4, Math.min(24, pas - 2 - pas * 0.3));
  const y = (v) => h + ih - (v / max) * ih;
  const iMax = mx > 0 ? jours.findIndex((j) => j.v === mx) : -1; const iAuj = n - 1;
  const etiquettes = new Set([iMax, jours[iAuj] && jours[iAuj].v > 0 ? iAuj : -1].filter((i) => i >= 0));
  const lib = (j) => `${date(j.t, { weekday: 'short', day: 'numeric', month: 'short' })} : ${dollars(j.v)}, ${pluriel(j.n, 'commande')}`;
  const info = survol >= 0 ? jours[survol] : null;
  return (
    <figure class="graphique" ref={boite}>
      <figcaption class="sr">{titre}, {n} derniers jours. Maximum {dollars(mx)}.</figcaption>
      <svg width={largeur} height={H} viewBox={`0 0 ${largeur} ${H}`} role="img" aria-label={`${titre} : maximum ${dollars(mx)}`} onPointerLeave={() => setSurvol(-1)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line class="g-grille" x1={g} x2={largeur - d} y1={y(max * f)} y2={y(max * f)} />
            <text class="g-axe" x={g - 8} y={y(max * f) + 4} text-anchor="end">{dollarsCourt(max * f)}</text>
          </g>
        ))}
        {jours.map((j, i) => {
          const x = g + i * pas + (pas - l) / 2; const hh = j.v > 0 ? Math.max(3, (j.v / max) * ih) : 0;
          const texte = n <= 7 ? date(j.t, { weekday: 'short' }).replace('.', '') : (i % 5 === 0 || i === n - 1 ? date(j.t, { day: 'numeric' }) : '');
          return (
            <g key={j.t} class={'g-jour' + (survol === i ? ' survol' : '')} tabIndex={0} aria-label={lib(j)} onPointerEnter={() => setSurvol(i)} onFocus={() => setSurvol(i)} onBlur={() => setSurvol(-1)}>
              <rect class="g-cible" x={g + i * pas} y={h} width={pas} height={ih + b} />
              {hh ? <path class="g-barre" d={colonne(x, y(0) - hh, l, hh)} /> : <line class="g-zero" x1={x} x2={x + l} y1={y(0) - 0.5} y2={y(0) - 0.5} />}
              {etiquettes.has(i) && hh ? <text class="g-valeur" x={x + l / 2} y={y(0) - hh - 7} text-anchor="middle">{dollarsCourt(j.v)}</text> : null}
              {texte ? <text class={'g-axe' + (i === iAuj ? ' auj' : '')} x={g + i * pas + pas / 2} y={H - 8} text-anchor="middle">{i === iAuj && n <= 7 ? 'auj.' : texte}</text> : null}
            </g>
          );
        })}
        {!mx ? <text class="g-vide" x={g + iw / 2} y={h + ih / 2} text-anchor="middle">Aucune vente sur la période</text> : null}
      </svg>
      {info ? (
        <div class="g-infobulle" role="status" style={{ left: Math.min(largeur - 150, Math.max(0, g + survol * pas + pas / 2 - 75)) + 'px' }}>
          <b>{dollars(info.v)}</b><span>{pluriel(info.n, 'commande')}</span><small>{date(info.t, { weekday: 'long', day: 'numeric', month: 'long' })}</small>
        </div>
      ) : null}
      <details class="g-tableau">
        <summary>Voir les chiffres</summary>
        <table>
          <thead><tr><th scope="col">Jour</th><th scope="col">Commandes</th><th scope="col">Ventes</th></tr></thead>
          <tbody>{[...jours].reverse().map((j) => <tr key={j.t}><td>{date(j.t, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="num">{j.n}</td><td class="num">{dollars(j.v)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
