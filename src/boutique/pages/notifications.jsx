// Sokoyetu (boutique) — centre de notifications, et invitation à recevoir les notifications sur le téléphone (gratuites).
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Note, Vide, toast } from '../../commun/js/interface.jsx';
import { ilya, classes } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { produitsParId } from '../etat.js';
import { notifications, chargerNotifications, marquerLues, pushEtat, activerPush, alertes, basculerAlerte } from '../notifications.js';
import { EntetePage, Pied } from '../composants/cadre.jsx';
import { lienProduit } from '../composants/produits.jsx';
import { useSeo } from './commun.jsx';
import { t, tx } from '../../commun/js/langue.js';

const ICONES = { payee: 'portefeuille', preparation: 'colis', expediee: 'camion', prete: 'boutique', livree: 'coche', retiree: 'coche', annulee: 'alerte', expiree: 'alerte', remboursee: 'portefeuille', stock: 'etincelle', promo: 'megaphone', panier: 'sac', message: 'bulle', avis: 'etoile', avis_reponse: 'etoile', parrainage: 'cadeau', cagnotte: 'cadeau' };
const TONS = { livree: 'ok', retiree: 'ok', payee: 'ok', stock: 'ok', annulee: 'danger', expiree: 'danger' };

/*
 * Invitation à activer les notifications du téléphone. discret : rien quand elles sont bloquées ou impossibles
 * (page de remerciement, suivi) ; sinon une explication (centre de notifications, compte).
 */
export function ActiverNotifications({ titre, texte, discret }) {
  const [occupe, setOccupe] = useState(false);
  const e = pushEtat.value;
  if (e === 'actif' || e === 'indisponible') return null;
  if (e === 'ios') return discret ? null : <Note icone="mobile">{t('Sur iPhone, installez d’abord l’application (bouton Partager → « Sur l’écran d’accueil ») pour recevoir les notifications. Elles restent aussi ici.')}</Note>;
  if (e === 'bloque') return discret ? null : <Note ton="alerte" icone="cloche">{t('Les notifications sont bloquées sur ce navigateur. Pour les recevoir, autorisez-les dans ses réglages (cadenas à côté de l’adresse → Notifications).')}</Note>;
  const activer = async () => {
    setOccupe(true);
    try {
      if (await activerPush()) toast(t('Notifications activées sur ce téléphone'), { icone: 'cloche' });
      else if (pushEtat.value === 'bloque') toast(t('Notifications refusées : autorisez-les dans les réglages du navigateur'), { icone: 'alerte', ton: 'danger', duree: 5000 });
    } catch (err) { toast(t('Activation impossible pour le moment. Réessayez plus tard.'), { icone: 'alerte', ton: 'danger' }); }
    setOccupe(false);
  };
  return (
    <section class="carte-notifs">
      <span class="menu-icone" aria-hidden="true"><Icone n="cloche" /></span>
      <div><b>{titre || t('Soyez prévenu à chaque étape')}</b><p>{texte || t('Paiement reçu, préparation, en route, livrée : une notification sur ce téléphone, gratuite, même boutique fermée.')}</p></div>
      <button class={classes('btn btn-primaire btn-s', occupe && 'charge')} onClick={activer}>{t('Activer')}</button>
    </section>
  );
}

/* Articles épuisés dont le client attend le retour (« Prévenez-moi ») : il peut ne plus les attendre. */
function ArticlesAttendus() {
  const l = alertes.value.map((a) => ({ ...a, p: produitsParId.value.get(a.produit) })).filter((a) => a.p);
  if (!l.length) return null;
  const retirer = async (a) => {
    try { await basculerAlerte(a.produit, a.variante); toast(t('Alerte retirée'), { icone: 'cloche' }); }
    catch (err) { toast(err.message || t('Impossible pour le moment. Réessayez.'), { icone: 'alerte', ton: 'danger' }); }
  };
  return (
    <section class="pile" aria-labelledby="titre-attendus">
      <h2 class="sous-titre" id="titre-attendus">{t('Vous attendez leur retour')}</h2>
      <ul class="liste-attendus">
        {l.map((a) => (
          <li key={a.produit + '#' + a.variante}>
            <a class="attendu" href={lienProduit(a.p)}>
              <Photo m={R.imagePrincipale(a.p)} alt="" tailles="56px" />
              <span class="notif-texte"><b>{a.p.title}</b><span>{tx('{0} · prévenu dès son retour', [a.variante ? R.libelleVariante(a.variante) : t('Toutes les options')])}</span></span>
            </a>
            <button type="button" class="btn-icone" aria-label={t('Ne plus attendre « {0} »', [a.p.title])} onClick={() => retirer(a)}><Icone n="fermer" /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Notifications() {
  useSeo(() => ({ titre: t('Notifications'), noindex: true }), []);
  const [pret, setPret] = useState(notifications.value.length > 0);
  // Ouvrir le centre vaut lecture : les notifications sont marquées lues un instant après.
  useEffect(() => { let t = 0; chargerNotifications().then(() => { setPret(true); t = setTimeout(marquerLues, 1500); }); return () => clearTimeout(t); }, []);
  const l = notifications.value;
  return (
    <>
      <EntetePage titre={t('Notifications')} repli="/compte" />
      <main id="contenu" class="page conteneur page-notifications">
        <div class="pile-l">
          <ActiverNotifications />
          {!l.length && !pret ? <div class="pile">{[1, 2, 3].map((i) => <div key={i} class="squelette" style={{ height: 76 }} />)}</div>
            : !l.length ? <Vide icone="cloche" titre={t('Aucune notification')} texte={t('Vos commandes vous préviennent ici à chaque étape : paiement reçu, préparation, en route, livrée. Et les articles épuisés, à leur retour en stock.')} />
              : (
                <ul class="liste-notifs" aria-label={t('Notifications')}>
                  {l.map((n) => (
                    <li key={n.id}>
                      <a class={classes('notif', !n.lu && 'non-lue', TONS[n.type] && 'notif-' + TONS[n.type])} href={lien(n.url || '/')}>
                        <span class="notif-icone" aria-hidden="true"><Icone n={ICONES[n.type] || 'cloche'} /></span>
                        <span class="notif-texte"><b>{n.titre}</b><span>{n.texte}</span><small>{ilya(n.cree)}</small></span>
                        {!n.lu ? <span class="notif-point"><span class="sr">{t('Non lue')}</span></span> : null}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
          <ArticlesAttendus />
        </div>
      </main>
      <Pied />
    </>
  );
}
