// Sokoyetu — composants d'interface communs : messages, feuilles, confirmations, champs, états vides…
import { signal, computed } from '@preact/signals';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Icone } from './icones.jsx';
import { dollars, classes, pluriel } from './outils.js';
import { t, tx } from './langue.js';

/* ---------- Longues listes : affichées par pages (« Afficher plus »), pour rester rapides sur un petit téléphone ---------- */

/* Les « parPage » premières lignes ; la liste revient à sa première page quand « cle » change (filtre, recherche). */
export function useParPage(liste, parPage = 50, cle = '') {
  const [etat, setEtat] = useState({ cle, n: parPage });
  const n = etat.cle === cle ? etat.n : parPage;
  return { n, visibles: liste.length > n ? liste.slice(0, n) : liste, reste: Math.max(0, liste.length - n), plus: () => setEtat({ cle, n: n + parPage }) };
}
export function AfficherPlus({ page, total, libelle, libelles }) {
  if (!page.reste) return null;
  return (
    <div class="afficher-plus">
      <p class="discret petit">{tx('{0} sur {1}', [page.n, pluriel(total, libelle, libelles)])}</p>
      <button class="btn btn-secondaire" onClick={page.plus}>{t('Afficher plus')}<Icone n="bas" /></button>
    </div>
  );
}

/* ---------- Annonces pour lecteurs d'écran ---------- */
const annonce = signal('');
export function annoncer(texte) { annonce.value = ''; setTimeout(() => { annonce.value = texte; }, 30); }
export const Annonceur = () => <div class="sr" role="status" aria-live="polite">{annonce.value}</div>;

/* ---------- Messages éphémères ---------- */
const toasts = signal([]);
let n = 0;
// Un message qui part glisse et s'efface (toast-out dans composants.css) avant d'être retiré.
function retirerToast(id) {
  if (!toasts.value.some((t) => t.id === id && !t.sort)) return;
  toasts.value = toasts.value.map((t) => (t.id === id ? { ...t, sort: true } : t));
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 240);
}
/* Renvoie de quoi retirer le message avant la fin de sa durée. */
export function toast(texte, { icone = 'coche', ton = '', duree = 2600 } = {}) {
  const id = ++n;
  toasts.value.filter((t) => !t.sort).slice(0, -1).forEach((t) => retirerToast(t.id)); // deux messages au plus à l'écran
  toasts.value = [...toasts.value, { id, texte, icone, ton }];
  setTimeout(() => retirerToast(id), duree);
  return () => retirerToast(id);
}
export const Toasts = () => (
  <div class="toasts" aria-live="polite">
    {toasts.value.map((t) => <div key={t.id} class={classes('toast', t.sort && 'sort', t.ton && 'ton-' + t.ton)} onClick={() => retirerToast(t.id)}><Icone n={t.icone} /><span>{t.texte}</span></div>)}
  </div>
);

/* ---------- Feuilles (fenêtres) ---------- */
const pile = signal([]);
let idFeuille = 0;
export const feuilleOuverte = computed(() => pile.value.some((f) => !f.ferme));

/*
 * ouvrirFeuille({ titre, contenu: () => jsx, pied: () => jsx, onFermer, large })
 * Le contenu est une fonction : il se met à jour quand les données qu'il lit changent.
 */
export function ouvrirFeuille(f) {
  const id = ++idFeuille;
  pile.value = [...pile.value, { ...f, id, retour: document.activeElement }];
  return id;
}
export function fermerFeuille(id) {
  const cible = id ? pile.value.find((f) => f.id === id) : [...pile.value].reverse().find((f) => !f.ferme);
  if (!cible || cible.ferme) return;
  pile.value = pile.value.map((f) => (f.id === cible.id ? { ...f, ferme: true } : f));
  setTimeout(() => {
    pile.value = pile.value.filter((f) => f.id !== cible.id);
    if (cible.retour && cible.retour.isConnected) try { cible.retour.focus({ preventScroll: true }); } catch (e) { }
    cible.onFermer && cible.onFermer();
  }, 280);
}
export const fermerTout = () => pile.value.forEach((f) => fermerFeuille(f.id));

const SELECTEUR_FOCUS = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Feuille({ f }) {
  const ref = useRef(null), voile = useRef(null);
  const titreId = 'feuille-titre-' + f.id;
  useEffect(() => {
    const el = ref.current;
    requestAnimationFrame(() => requestAnimationFrame(() => { el && el.classList.add('ouverte'); voile.current && voile.current.classList.add('ouverte'); }));
    const premier = el && (el.querySelector('[autofocus]') || el.querySelector('.feuille-corps ' + SELECTEUR_FOCUS) || el);
    setTimeout(() => premier && premier.focus({ preventScroll: true }), 60);
    // Glisser vers le bas pour fermer (poignée et en-tête), sur téléphone seulement : sur ordinateur, la fenêtre est centrée.
    // Vers le haut, la feuille résiste (élastique). Lâchée assez bas ou assez vite, elle part depuis la position du doigt.
    let y0 = null, dy = 0, t0 = 0;
    const debut = (e) => { if (e.button > 0 || matchMedia('(min-width: 720px)').matches || !e.target.closest('.feuille-poignee, .feuille-entete') || e.target.closest('button')) return; y0 = e.clientY; dy = 0; t0 = Date.now(); el.classList.add('glisse'); };
    const deplace = (e) => { if (y0 == null) return; const d = e.clientY - y0; dy = d > 0 ? d : -Math.min(24, Math.sqrt(-d) * 2); el.style.transform = `translate(-50%, ${dy}px)`; if (voile.current) voile.current.style.opacity = String(Math.max(0.15, 1 - Math.max(0, dy) / 420)); };
    const fin = () => {
      if (y0 == null) return; const v = dy / Math.max(1, Date.now() - t0); y0 = null; el.classList.remove('glisse');
      if (dy > 120 || (dy > 30 && v > 0.6)) { el.style.transform = 'translate(-50%, 104%)'; if (voile.current) voile.current.style.opacity = '0'; fermerFeuille(f.id); return; }
      el.style.transform = ''; if (voile.current) voile.current.style.opacity = '';
    };
    el.addEventListener('pointerdown', debut); window.addEventListener('pointermove', deplace); window.addEventListener('pointerup', fin); window.addEventListener('pointercancel', fin);
    return () => { el.removeEventListener('pointerdown', debut); window.removeEventListener('pointermove', deplace); window.removeEventListener('pointerup', fin); window.removeEventListener('pointercancel', fin); };
  }, []);
  useEffect(() => { if (f.ferme) { ref.current && ref.current.classList.remove('ouverte'); voile.current && voile.current.classList.remove('ouverte'); } }, [f.ferme]);
  const clavier = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); fermerFeuille(f.id); return; }
    if (e.key !== 'Tab') return;
    const l = [...ref.current.querySelectorAll(SELECTEUR_FOCUS)].filter((x) => x.offsetParent !== null);
    if (!l.length) return;
    if (e.shiftKey && document.activeElement === l[0]) { e.preventDefault(); l[l.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === l[l.length - 1]) { e.preventDefault(); l[0].focus(); }
  };
  return (
    <>
      <div ref={voile} class="voile" onClick={() => fermerFeuille(f.id)} />
      <div ref={ref} class="feuille" role="dialog" aria-modal="true" aria-labelledby={f.titre ? titreId : undefined} tabIndex={-1} onKeyDown={clavier}
        style={f.large ? { width: 'min(100%, 720px)' } : undefined}>
        <div class="feuille-poignee" aria-hidden="true" />
        <div class="feuille-entete">
          {f.titre ? <h2 id={titreId}>{f.titre}</h2> : <span style={{ flex: 1 }} />}
          <button class="btn-icone" onClick={() => fermerFeuille(f.id)} aria-label={t('Fermer')}><Icone n="fermer" /></button>
        </div>
        <div class="feuille-corps">{f.contenu()}</div>
        {f.pied ? <div class="feuille-pied">{f.pied()}</div> : null}
      </div>
    </>
  );
}

export function Feuilles() {
  const l = pile.value;
  useEffect(() => {
    const ouvert = l.some((f) => !f.ferme);
    document.documentElement.style.overflow = ouvert ? 'hidden' : '';
  }, [l]);
  return <>{l.map((f) => <Feuille key={f.id} f={f} />)}</>;
}

/* Confirmation : await confirmer({ titre, texte, ok, danger }) → true / false */
export function confirmer({ titre, texte, ok = t('Confirmer'), annuler = t('Annuler'), danger = false }) {
  return new Promise((resoudre) => {
    let rep = false;
    const id = ouvrirFeuille({
      titre, onFermer: () => resoudre(rep),
      contenu: () => (texte ? <p class="attenue">{texte}</p> : null),
      pied: () => (
        <>
          <button class={classes('btn btn-bloc', danger ? 'btn-danger' : 'btn-primaire')} autofocus onClick={() => { rep = true; fermerFeuille(id); }}>{ok}</button>
          <button class="btn btn-fantome btn-bloc" onClick={() => fermerFeuille(id)}>{annuler}</button>
        </>
      )
    });
  });
}

/* ---------- Champs ---------- */

/* <Champ libelle="Nom" aide="…" erreur={e}>{(a) => <input class="saisie" {...a} />}</Champ> */
export function Champ({ libelle, aide, erreur, facultatif, children, classe, id: idImpose }) {
  const auto = useId();
  const id = idImpose || 'c' + auto.replace(/[^a-zA-Z0-9]/g, '');
  const decrit = [aide && id + '-aide', erreur && id + '-err'].filter(Boolean).join(' ') || undefined;
  const attrs = { id, 'aria-describedby': decrit, 'aria-invalid': erreur ? 'true' : undefined };
  return (
    <div class={classes('champ', erreur && 'en-erreur', classe)}>
      {libelle ? <label class="champ-libelle" for={id}>{libelle}{facultatif ? <span class="facultatif">{' '}{t('(facultatif)')}</span> : null}</label> : null}
      {typeof children === 'function' ? children(attrs) : children}
      {erreur ? <p class="champ-erreur" id={id + '-err'}><Icone n="alerte" />{erreur}</p> : null}
      {aide ? <p class="champ-aide" id={id + '-aide'}>{aide}</p> : null}
    </div>
  );
}

export function Bascule({ actif, onClick, libelle, sous, desactive }) {
  return (
    <button type="button" class="bascule-ligne" role="switch" aria-checked={actif ? 'true' : 'false'} onClick={onClick} disabled={desactive}>
      <span class="texte"><b>{libelle}</b>{sous ? <small>{sous}</small> : null}</span>
      <span class="bascule" aria-hidden="true" />
    </button>
  );
}

/* Case à cocher dont le texte peut contenir des liens : la case est le contrôle, le texte la nomme et la coche aussi. */
export function CaseACocher({ coche, onClick, children }) {
  const id = useId();
  return (
    <div class="case" data-coche={coche ? 'oui' : 'non'}>
      <button type="button" class="case-boite" role="checkbox" aria-checked={coche ? 'true' : 'false'} aria-labelledby={id} onClick={onClick}><Icone n="coche" /></button>
      <span id={id} onClick={(e) => { if (!e.target.closest('a')) onClick(); }}>{children}</span>
    </div>
  );
}

/*
 * Logo d'un opérateur Mobile Money (images : commun/marque/operateurs/, styles .logo-op). Sans logo : son initiale sur sa couleur.
 * Carte bancaire : une carte dessinée, sans logo de marque.
 */
export function LogoOperateur({ k, m, taille, classe }) {
  const o = m || {}; const op = k || o.k;
  return <span class={classes('logo-op', classe)} data-op={op} style={{ '--op': o.color, '--t': taille ? `${taille}px` : undefined }} aria-hidden="true">{op === 'carte' || o.carte ? <Icone n="carte" /> : o.init || String(o.label || 'M')[0]}</span>;
}

export function Choix({ actif, onClick, icone, couleur, titre, sous, desactive }) {
  return (
    <button type="button" class="choix" role="radio" aria-checked={actif ? 'true' : 'false'} onClick={onClick} disabled={desactive}>
      <span class="choix-icone" style={couleur ? { color: couleur, background: `color-mix(in srgb, ${couleur} 14%, var(--surface))` } : undefined}>{typeof icone === 'string' && icone.length > 1 ? <Icone n={icone} /> : icone}</span>
      <span class="choix-texte"><b>{titre}</b>{sous ? <small>{sous}</small> : null}</span>
      <span class="choix-radio" aria-hidden="true" />
    </button>
  );
}

export function Segment({ options, valeur, onChange, plein, libelle }) {
  return (
    <div class={classes('segment', plein && 'plein')} role="group" aria-label={libelle}>
      {options.map(([v, l]) => <button type="button" key={v} aria-pressed={String(v) === String(valeur) ? 'true' : 'false'} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Quantite({ valeur, min = 1, max = 20, onChange, petit, libelle = t('Quantité'), supprimer }) {
  return (
    <div class={classes('quantite', petit && 'petit')} role="group" aria-label={libelle}>
      <button type="button" onClick={() => onChange(valeur - 1)} disabled={!supprimer && valeur <= min} aria-label={supprimer && valeur <= min ? t('Retirer du panier') : t('Diminuer')}>
        <Icone n={supprimer && valeur <= min ? 'poubelle' : 'moins'} />
      </button>
      <output aria-live="polite">{valeur}</output>
      <button type="button" onClick={() => onChange(valeur + 1)} disabled={valeur >= max} aria-label={t('Augmenter')}><Icone n="plus" /></button>
    </div>
  );
}

/* ---------- Affichages ---------- */

export function Vide({ icone = 'info', titre, texte, children }) {
  return (
    <div class="vide entree">
      <div class="vide-icone" aria-hidden="true"><Icone n={icone} /></div>
      <h2>{titre}</h2>
      {texte ? <p>{texte}</p> : null}
      {children ? <div class="actions">{children}</div> : null}
    </div>
  );
}

export function Etapes({ noms, actuelle }) {
  return (
    <ol class="etapes" aria-label={t('Étape {0} sur {1}', [actuelle, noms.length])}>
      {noms.map((nom, i) => (
        <>
          {i ? <li class={classes('trait', actuelle > i && 'fait')} aria-hidden="true" /> : null}
          <li class={classes('etape', actuelle === i + 1 && 'actuelle', actuelle > i + 1 && 'faite')} aria-current={actuelle === i + 1 ? 'step' : undefined}>
            <i>{actuelle > i + 1 ? <Icone n="coche" /> : i + 1}</i><span>{t(nom)}</span>
          </li>
        </>
      ))}
    </ol>
  );
}

export const Prix = ({ v, promo, classe }) => <span class={classes('prix', promo && 'prix-promo', classe)}>{dollars(v)}</span>;

export function Note({ ton, icone = 'info', children, classe }) {
  return <div class={classes('note', ton && 'ton-' + ton, classe)}><Icone n={icone} /><div>{children}</div></div>;
}

export const Pastille = ({ ton = 'neutre', point, icone, children }) => (
  <span class={classes('pastille', 'ton-' + ton, point && 'point')}>{icone ? <Icone n={icone} /> : null}{children}</span>
);
