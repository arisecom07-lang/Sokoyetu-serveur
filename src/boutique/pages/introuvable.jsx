// Sokoyetu (boutique) — page introuvable.
import { Vide } from '../../commun/js/interface.jsx';
import { lien } from '../routeur.js';
import { EnteteBoutique, Pied } from '../composants/cadre.jsx';
import { useSeo } from './commun.jsx';
import { t } from '../../commun/js/langue.js';

export function Introuvable({ texte = t('Le lien est peut-être ancien ou mal recopié. La boutique, elle, est toujours ouverte.') }) {
  useSeo(() => ({ titre: t('Page introuvable'), noindex: true }), []);
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur">
        <Vide icone="recherche" titre={t('Cette page n’existe pas')} texte={texte}>
          <a class="btn btn-primaire" href={lien('/')}>{t('Retour à l’accueil')}</a>
          <a class="btn btn-secondaire" href={lien('/recherche')}>{t('Rechercher un article')}</a>
        </Vide>
      </main>
      <Pied />
    </>
  );
}
