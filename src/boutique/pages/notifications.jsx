// Sokoyetu (boutique) — centre de notifications, et invitation à recevoir les notifications sur le téléphone (gratuites).
import { useEffect, useState } from 'preact/hooks';
import { Icone } from '../../commun/js/icones.jsx';
import { Note, Vide, toast } from '../../commun/js/interface.jsx';
import { ilya, classes } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { notifications, chargerNotifications, marquerLues, pushEtat, activerPush } from '../notifications.js';
import { EntetePage, Pied } from '../composants/cadre.jsx';
import { useSeo } from './commun.jsx';

const ICONES = { payee: 'portefeuille', preparation: 'colis', expediee: 'camion', prete: 'boutique', livree: 'coche', retiree: 'coche', annulee: 'alerte', expiree: 'alerte', remboursee: 'portefeuille' };
const TONS = { livree: 'ok', retiree: 'ok', payee: 'ok', annulee: 'danger', expiree: 'danger' };

/*
 * Invitation à activer les notifications du téléphone. discret : rien quand elles sont bloquées ou impossibles
 * (page de remerciement, suivi) ; sinon une explication (centre de notifications, compte).
 */
export function ActiverNotifications({ titre, texte, discret }) {
  const [occupe, setOccupe] = useState(false);
  const e = pushEtat.value;
  if (e === 'actif' || e === 'indisponible') return null;
  if (e === 'ios') return discret ? null : <Note icone="mobile">Sur iPhone, installez d’abord l’application (bouton Partager → « Sur l’écran d’accueil ») pour recevoir les notifications. Elles restent aussi ici.</Note>;
  if (e === 'bloque') return discret ? null : <Note ton="alerte" icone="cloche">Les notifications sont bloquées sur ce navigateur. Pour les recevoir, autorisez-les dans ses réglages (cadenas à côté de l’adresse → Notifications).</Note>;
  const activer = async () => {
    setOccupe(true);
    try {
      if (await activerPush()) toast('Notifications activées sur ce téléphone', { icone: 'cloche' });
      else if (pushEtat.value === 'bloque') toast('Notifications refusées : autorisez-les dans les réglages du navigateur', { icone: 'alerte', ton: 'danger', duree: 5000 });
    } catch (err) { toast('Activation impossible pour le moment. Réessayez plus tard.', { icone: 'alerte', ton: 'danger' }); }
    setOccupe(false);
  };
  return (
    <section class="carte-notifs">
      <span class="menu-icone" aria-hidden="true"><Icone n="cloche" /></span>
      <div><b>{titre || 'Soyez prévenu à chaque étape'}</b><p>{texte || 'Paiement reçu, préparation, en route, livrée : une notification sur ce téléphone, gratuite, même boutique fermée.'}</p></div>
      <button class={classes('btn btn-primaire btn-s', occupe && 'charge')} onClick={activer}>Activer</button>
    </section>
  );
}

export function Notifications() {
  useSeo(() => ({ titre: 'Notifications', noindex: true }), []);
  const [pret, setPret] = useState(notifications.value.length > 0);
  // Ouvrir le centre vaut lecture : les notifications sont marquées lues un instant après.
  useEffect(() => { let t = 0; chargerNotifications().then(() => { setPret(true); t = setTimeout(marquerLues, 1500); }); return () => clearTimeout(t); }, []);
  const l = notifications.value;
  return (
    <>
      <EntetePage titre="Notifications" repli="/compte" />
      <main id="contenu" class="page conteneur page-notifications">
        <div class="pile-l">
          <ActiverNotifications />
          {!l.length && !pret ? <div class="pile">{[1, 2, 3].map((i) => <div key={i} class="squelette" style={{ height: 76 }} />)}</div>
            : !l.length ? <Vide icone="cloche" titre="Aucune notification" texte="Vos commandes vous préviennent ici à chaque étape : paiement reçu, préparation, en route, livrée." />
              : (
                <ul class="liste-notifs" aria-label="Notifications">
                  {l.map((n) => (
                    <li key={n.id}>
                      <a class={classes('notif', !n.lu && 'non-lue', TONS[n.type] && 'notif-' + TONS[n.type])} href={lien(n.url || '/')}>
                        <span class="notif-icone" aria-hidden="true"><Icone n={ICONES[n.type] || 'cloche'} /></span>
                        <span class="notif-texte"><b>{n.titre}</b><span>{n.texte}</span><small>{ilya(n.cree)}</small></span>
                        {!n.lu ? <span class="notif-point"><span class="sr">Non lue</span></span> : null}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </main>
      <Pied />
    </>
  );
}
