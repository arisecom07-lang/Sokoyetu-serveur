// Sokoyetu (boutique) — discussion avec la boutique : une question sur un article, une commande, la livraison…
// La boutique répond ici, et le client est prévenu par une notification gratuite (ni SMS ni WhatsApp).
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Cabas } from '../../commun/js/logo.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { toast } from '../../commun/js/interface.jsx';
import { FilMessages } from '../../commun/js/discussion.jsx';
import { dollars, classes } from '../../commun/js/outils.js';
import { lien, route } from '../routeur.js';
import { cfg, client, profil, produitsParId, commandes } from '../etat.js';
import { EntetePage } from '../composants/cadre.jsx';
import { lienProduit } from '../composants/produits.jsx';
import { fil, filCharge, luParBoutique, chargerFil, envoyerMessage } from '../discussion.js';
import { ActiverNotifications } from './notifications.jsx';
import { useSeo } from './commun.jsx';

const SUGGESTIONS = {
  produit: ['Est-il toujours disponible ?', 'Avez-vous d’autres tailles ou couleurs ?', 'Quel est le délai de livraison ?'],
  commande: ['Quand ma commande arrivera-t-elle ?', 'Je voudrais changer l’adresse de livraison.', 'J’ai une question sur un article reçu.'],
  general: ['Comment se passe la livraison ?', 'Comment payer par Mobile Money ?', 'Puis-je retirer ma commande en boutique ?']
};

/* L'article ou la commande dont parle un message. */
function Pieces({ m }) {
  const p = m.produit ? produitsParId.value.get(m.produit) : null;
  const o = m.commande ? commandes.value.get(m.commande.id) : null;
  return (
    <>
      {p ? (
        <a class="bulle-piece" href={lienProduit(p)}>
          <span class="bulle-piece-photo"><Photo m={R.imagePrincipale(p)} alt="" tailles="44px" /></span>
          <span class="bulle-piece-texte"><b>{p.title}</b><small>{dollars(R.prixAffiche(p).prix)}</small></span>
        </a>
      ) : null}
      {m.commande ? (
        <a class="bulle-piece" href={lien('/suivi/' + m.commande.id)}>
          <span class="bulle-piece-icone"><Icone n="recu" /></span>
          <span class="bulle-piece-texte"><b>Commande #{m.commande.numero || (o && o.number) || ''}</b><small>{o ? R.statutClient(o).label : 'Voir le suivi'}</small></span>
        </a>
      ) : null}
    </>
  );
}

export function Discussion() {
  useSeo(() => ({ titre: 'Discussion avec la boutique', noindex: true }), []);
  const c = cfg.value; const cl = client.value;
  const [sujet, setSujet] = useState(() => ({ produit: route.value.query.get('p') || '', commande: route.value.query.get('c') || '' }));
  const [texte, setTexte] = useState('');
  const [nom, setNom] = useState('');
  const [envoi, setEnvoi] = useState(null);       // message en cours d'envoi, affiché tout de suite
  const [ecrit, setEcrit] = useState(false);      // le client a écrit pendant cette visite
  const zone = useRef(null); const formulaire = useRef(null);
  const mouvement = useRef(Date.now());

  // La zone d'écriture, collée en bas du téléphone, change de hauteur : le fil et les messages d'information restent au-dessus.
  useEffect(() => {
    const f = formulaire.current; const b = document.body.style;
    if (!f || typeof ResizeObserver === 'undefined') return undefined;
    const o = new ResizeObserver(() => {
      const h = Math.round(f.getBoundingClientRect().height);
      b.setProperty('--h-composeur', h + 'px');
      if (getComputedStyle(f).position === 'fixed') b.setProperty('--bas-toasts', h + 16 + 'px'); else b.removeProperty('--bas-toasts');
    });
    o.observe(f);
    return () => { o.disconnect(); b.removeProperty('--h-composeur'); b.removeProperty('--bas-toasts'); };
  }, []);

  // Lecture tout de suite, puis toutes les 4 s tant que la discussion vit, plus lentement quand elle se calme.
  useEffect(() => {
    let t = 0, fini = false;
    const tour = async () => {
      clearTimeout(t);
      if (fini) return;
      if (document.visibilityState === 'visible') { try { await chargerFil(); } catch (e) { } }
      if (fini) return;
      const calme = Date.now() - mouvement.current;
      t = setTimeout(tour, calme < 120000 ? 4000 : calme < 600000 ? 15000 : 60000);
    };
    chargerFil({ complet: true }).catch(() => { }).finally(() => { t = setTimeout(tour, 4000); });
    const visible = () => { if (document.visibilityState === 'visible') tour(); };
    document.addEventListener('visibilitychange', visible);
    // Le lien d'ouverture (article, commande) a servi : un rechargement de la page ne le rejoint pas de nouveau.
    if (route.value.recherche) try { history.replaceState(history.state, '', lien('/discussion')); } catch (e) { }
    return () => { fini = true; clearTimeout(t); document.removeEventListener('visibilitychange', visible); };
  }, []);

  // Nouveau message : la discussion s'anime, l'écran descend jusqu'à lui.
  const n = fil.value.length + (envoi ? 1 : 0);
  const premier = useRef(true);
  useEffect(() => {
    if (!n) return;
    mouvement.current = Date.now();
    const bas = document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 240;
    if (premier.current || bas || envoi) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: premier.current ? 'auto' : 'smooth' });
    premier.current = false;
  }, [n]);

  const produit = sujet.produit ? produitsParId.value.get(sujet.produit) : null;
  const commande = sujet.commande ? commandes.value.get(sujet.commande) : null;
  const messages = envoi ? [...fil.value, envoi] : fil.value;
  const demanderNom = !cl && !R.nettoyer(profil.value.name, 60) && !fil.value.length;
  const idees = !texte.trim() && (produit || commande || !fil.value.length) ? SUGGESTIONS[produit ? 'produit' : commande ? 'commande' : 'general'] : [];

  const ajuster = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px'; };
  async function envoyer(e) {
    if (e) e.preventDefault();
    const x = texte.trim();
    if (!x || envoi) return;
    if (x.length > R.MAX_MESSAGE) { toast(`Message trop long : ${R.MAX_MESSAGE} caractères au plus.`, { icone: 'alerte', ton: 'danger' }); return; }
    const piece = { produit: produit ? produit.id : '', commande: commande ? commande.id : '' };
    setEnvoi({ id: 'envoi', auteur: 'client', texte: x, produit: piece.produit, commande: commande ? { id: commande.id, numero: commande.number } : null, cree: Date.now(), envoi: true });
    setTexte(''); requestAnimationFrame(() => ajuster(zone.current));
    try {
      await envoyerMessage({ texte: x, ...piece, nom: cl && cl.name ? '' : R.nettoyer(nom, 60) || R.nettoyer(profil.value.name, 60) });
      setSujet({ produit: '', commande: '' }); setEcrit(true);
    } catch (err) {
      setTexte((t) => t || x);
      toast(err.message || 'Message non envoyé. Vérifiez la connexion, puis réessayez.', { icone: 'alerte', ton: 'danger', duree: 5000 });
    }
    setEnvoi(null);
  }

  return (
    <>
      <EntetePage titre="Discussion" sous={`avec ${c.name}`} repli="/compte" />
      <main id="contenu" class="page conteneur page-discussion">
        <div class="discussion">
          {!messages.length ? (
            <section class="discussion-intro">
              <span class="discussion-logo" aria-hidden="true"><Cabas taille={44} /></span>
              <h2>Écrivez à {c.name}</h2>
              <p>Une question sur un article, une taille, une livraison ou une commande ? La boutique vous répond ici, dans l’application, et vous êtes prévenu par une notification gratuite.</p>
            </section>
          ) : null}
          {!messages.length && !filCharge.value ? <div class="squelette" style={{ height: 64, width: '70%', justifySelf: 'end' }} /> : null}
          {messages.length ? <FilMessages messages={messages} moi="client" lu={luParBoutique.value} autre={c.name} piece={(m) => <Pieces m={m} />} /> : null}
          {ecrit ? <ActiverNotifications discret titre="Soyez prévenu de la réponse" texte="Une notification gratuite sur ce téléphone dès que la boutique répond, même application fermée." /> : null}
        </div>
        <form class="composeur" ref={formulaire} onSubmit={envoyer} noValidate>
          <div class="composeur-in">
            {produit || commande ? (
              <div class="composeur-sujet">
                {produit ? <span class="bulle-piece-photo"><Photo m={R.imagePrincipale(produit)} alt="" tailles="36px" /></span> : <span class="bulle-piece-icone"><Icone n="recu" /></span>}
                <span class="composeur-sujet-texte"><small>À propos de</small><b>{produit ? produit.title : `la commande #${commande.number}`}</b></span>
                <button type="button" class="btn-icone" aria-label="Ne pas joindre" onClick={() => setSujet({ produit: '', commande: '' })}><Icone n="fermer" /></button>
              </div>
            ) : null}
            {idees.length ? (
              <div class="composeur-idees" role="group" aria-label="Questions fréquentes">
                {idees.map((x) => <button key={x} type="button" class="puce" onClick={() => { setTexte(x); requestAnimationFrame(() => { ajuster(zone.current); zone.current && zone.current.focus(); }); }}>{x}</button>)}
              </div>
            ) : null}
            {demanderNom ? <input class="saisie composeur-nom" value={nom} onInput={(e) => setNom(e.currentTarget.value)} maxlength="60" placeholder="Votre prénom (facultatif)" aria-label="Votre prénom (facultatif)" autocomplete="given-name" /> : null}
            <div class="composeur-ligne">
              <textarea ref={zone} class="saisie" rows="1" value={texte} maxlength={R.MAX_MESSAGE} placeholder="Votre message…" aria-label="Votre message"
                onInput={(e) => { setTexte(e.currentTarget.value); ajuster(e.currentTarget); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) envoyer(e); }} />
              <button type="submit" class={classes('btn btn-primaire composeur-envoyer', envoi && 'charge')} disabled={!texte.trim()} aria-label="Envoyer"><Icone n="papier" /></button>
            </div>
          </div>
        </form>
      </main>
    </>
  );
}
