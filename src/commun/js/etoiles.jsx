// Sokoyetu — étoiles des avis (boutique et administration) : note affichée au dixième près, et choix d'une note de 1 à 5.
import { Icone } from './icones.jsx';
import { classes } from './outils.js';
import { t, tn, aTraduire } from './langue.js';

/* 4.6 → « 4,6 » */
export const noteFr = (n) => String(Math.round((Number(n) || 0) * 10) / 10).replace('.', ',');
const CINQ = [1, 2, 3, 4, 5];
const MOTS = ['', aTraduire('Décevant'), aTraduire('Moyen'), aTraduire('Bien'), aTraduire('Très bien'), aTraduire('Excellent')];

/* Note affichée : les étoiles se remplissent au dixième près (4,6 : quatre étoiles et six dixièmes de la cinquième). */
export function Etoiles({ note, taille, classe }) {
  const pct = Math.max(0, Math.min(100, (Number(note) || 0) * 20));
  return (
    <span class={classes('etoiles', classe)} role="img" aria-label={t('Note : {0} sur 5', [noteFr(note)])} style={taille ? { '--etoile': taille + 'px' } : undefined}>
      <span class="etoiles-fond" aria-hidden="true">{CINQ.map((i) => <Icone key={i} n="etoile" plein />)}</span>
      <span class="etoiles-pleines" aria-hidden="true" style={{ width: pct + '%' }}>{CINQ.map((i) => <Icone key={i} n="etoile" plein />)}</span>
    </span>
  );
}

/* Choix d'une note (groupe de boutons radio : flèches du clavier, lecteurs d'écran), avec son mot (« Très bien »). */
export function ChoixEtoiles({ valeur, onChange, libelle = t('Votre note'), grande }) {
  const v = Number(valeur) || 0;
  const clavier = (e) => {
    const sens = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!sens) return;
    e.preventDefault();
    const n = Math.min(5, Math.max(1, (v || (sens > 0 ? 0 : 2)) + sens));
    onChange(n);
    const b = e.currentTarget.querySelectorAll('[role=radio]')[n - 1]; if (b) b.focus();
  };
  return (
    <div class={classes('choix-etoiles', grande && 'grande')}>
      <div class="choix-etoiles-boutons" role="radiogroup" aria-label={libelle} onKeyDown={clavier}>
        {CINQ.map((i) => (
          <button key={i} type="button" role="radio" aria-checked={v === i ? 'true' : 'false'} tabIndex={(v || 1) === i ? 0 : -1}
            class={classes('choix-etoile', i <= v && 'pleine')} aria-label={tn(i, '{n} étoile : {mot}', '{n} étoiles : {mot}', { mot: t(MOTS[i]) })} onClick={() => onChange(i)}>
            <Icone n="etoile" plein={i <= v} />
          </button>
        ))}
      </div>
      <span class="choix-etoiles-mot" aria-hidden="true">{v ? t(MOTS[v]) : t('Touchez une étoile')}</span>
    </div>
  );
}

/* Répartition des notes (barres de 5 à 1 étoile) ; choisir(n) filtre les avis sur une note, si donné. */
export function Repartition({ resume, choisie, choisir }) {
  const max = Math.max(1, resume.nombre);
  return (
    <ul class="repartition" aria-label={t('Répartition des notes')}>
      {[5, 4, 3, 2, 1].map((n) => {
        const k = (resume.repartition && resume.repartition[n]) || 0;
        const dit = tn(n, '{k} avis à {n} étoile', '{k} avis à {n} étoiles', { k });
        const contenu = <><span class="sr">{dit}</span><span class="repartition-n" aria-hidden="true">{n}<Icone n="etoile" plein /></span><span class="repartition-barre" aria-hidden="true"><i style={{ width: (k / max) * 100 + '%' }} /></span><span class="repartition-k" aria-hidden="true">{k}</span></>;
        return (
          <li key={n}>
            {choisir && k ? <button type="button" class={classes('repartition-ligne', choisie === n && 'choisie')} aria-pressed={choisie === n ? 'true' : 'false'} onClick={() => choisir(choisie === n ? 0 : n)}>{contenu}</button>
              : <span class="repartition-ligne">{contenu}</span>}
          </li>
        );
      })}
    </ul>
  );
}
