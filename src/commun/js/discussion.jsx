// Sokoyetu — fil d'une discussion entre un client et la boutique (boutique et administration) : bulles, jours, heures, « Vu ».
import { Fragment } from 'preact';
import { classes, date, debutJour, JOUR } from './outils.js';

const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function jour(t) {
  const j = debutJour(t), auj = debutJour(Date.now());
  if (j === auj) return 'Aujourd’hui';
  if (j === debutJour(auj - JOUR / 2)) return 'Hier';
  return date(t, { weekday: 'long', day: 'numeric', month: 'long', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/*
 * moi : 'client' (boutique) ou 'boutique' (administration) : ses messages à droite. lu : moment où l'autre côté a lu la
 * discussion (« Vu » sous mon dernier message). autre : nom de l'autre côté (lecteurs d'écran). piece(m) : l'article ou la
 * commande dont parle le message ; signature(m) : texte avant l'heure (membre de l'équipe qui a répondu).
 */
export function FilMessages({ messages, moi, lu, autre, piece, signature }) {
  let jourPrecedent = 0;
  let dernierMien = -1;
  messages.forEach((m, i) => { if (m.auteur === moi && !m.envoi) dernierMien = i; });
  return (
    <ol class="fil-messages" aria-label="Messages">
      {messages.map((m, i) => {
        const j = debutJour(m.cree); const nouveauJour = j !== jourPrecedent; jourPrecedent = j;
        const mien = m.auteur === moi; const s = signature ? signature(m) : '';
        const vu = mien && i === dernierMien && lu && lu >= m.cree;
        return (
          <Fragment key={m.id}>
            {nouveauJour ? <li class="fil-jour"><span>{jour(m.cree)}</span></li> : null}
            <li class={classes('bulle', mien ? 'bulle-moi' : 'bulle-autre', m.envoi && 'en-envoi')}>
              <span class="sr">{mien ? 'Vous' : autre} : </span>
              {piece ? piece(m) : null}
              <p>{m.texte}</p>
              <small>{s ? s + ' · ' : ''}{m.envoi ? 'Envoi…' : heure(m.cree)}{vu ? ' · Vu' : ''}</small>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
