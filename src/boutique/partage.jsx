// Sokoyetu (boutique) — partager un article ou tout le panier : la feuille de partage du téléphone (WhatsApp, SMS, Facebook…),
// sinon une fenêtre WhatsApp, Facebook ou lien à copier (ordinateur). Le lien s'ouvre avec un aperçu : logo, photo, prix.
import R from '../commun/js/regles.js';
import { Icone } from '../commun/js/icones.jsx';
import { ouvrirFeuille, fermerFeuille, toast } from '../commun/js/interface.jsx';
import { copier, dollars, pluriel } from '../commun/js/outils.js';
import { lien } from './routeur.js';
import { mesurerEvenement } from './mesure.js';
import { t, tx } from '../commun/js/langue.js';

/* Adresse complète d'une page de la boutique (dans la démo, l'adresse garde son « # »). */
export const adresseComplete = (chemin) => new URL(lien(chemin), location.href).href;

/* Adresse du panier partagé : les articles, quantités, couleurs et tailles, rien d'autre. */
export const lienPanierPartage = (lignes) => adresseComplete('/panier/partage?' + R.lienPanier(lignes));

/* Texte qui accompagne un panier partagé : « Voici mon panier Sokoyetu : 3 articles, $87.00. » (total estimé, comme sur la page). */
export const textePanier = (nom, n, total) => (n ? t('Voici mon panier {0} : {1}, {2}.', [nom, pluriel(n, 'article'), dollars(total)]) : t('Voici mon panier {0}.', [nom]));

/*
 * partager({ titre, texte, url, type: 'produit' | 'panier', id })
 * Le téléphone propose ses applications ; si l'on ferme sa feuille sans choisir, rien d'autre ne s'ouvre.
 */
export async function partager(o) {
  const mesurer = (methode) => mesurerEvenement('share', { method: methode, content_type: o.type, item_id: o.id || '' });
  if (navigator.share) {
    try { await navigator.share({ title: o.titre, text: o.texte, url: o.url }); mesurer('appareil'); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const message = `${o.texte} ${o.url}`;
  const fid = ouvrirFeuille({
    titre: o.type === 'panier' ? t('Partager le panier') : o.type === 'parrainage' ? t('Partager mon lien') : t('Partager cet article'),
    contenu: () => (
      <div class="partage">
        <div class="partage-choix">
          <a class="partage-option" data-app="whatsapp" href={'https://wa.me/?text=' + encodeURIComponent(message)} target="_blank" rel="noopener" onClick={() => { mesurer('whatsapp'); fermerFeuille(fid); }}>
            {tx('{0}WhatsApp', [<span class="partage-icone"><Icone n="bulle" /></span>])}
          </a>
          <a class="partage-option" data-app="facebook" href={'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(o.url)} target="_blank" rel="noopener" onClick={() => { mesurer('facebook'); fermerFeuille(fid); }}>
            {tx('{0}Facebook', [<span class="partage-icone"><Icone n="personnes" /></span>])}
          </a>
          <button type="button" class="partage-option" onClick={async () => {
            if (await copier(o.url)) { mesurer('lien'); toast(t('Lien copié')); fermerFeuille(fid); }
            else toast(t('Copie impossible : sélectionnez le lien ci-dessous'), { icone: 'alerte', ton: 'danger' });
          }}>
            {tx('{0}Copier le lien', [<span class="partage-icone"><Icone n="lien" /></span>])}
          </button>
        </div>
        <input class="saisie partage-lien" readOnly value={o.url} aria-label={t('Lien à partager')} onFocus={(e) => e.currentTarget.select()} />
      </div>
    )
  });
}
