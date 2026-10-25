// Sokoyetu (administration) — rayons, bannières d'accueil, codes de réduction.
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Cabas } from '../../commun/js/logo.jsx';
import { Photo, compresser } from '../../commun/js/medias.jsx';
import { envoyerPhoto } from '../../commun/js/api.js';
import { Champ, Note, Vide, Pastille, Bascule, Segment, toast, confirmer } from '../../commun/js/interface.jsx';
import { dollars, pluriel, uid, slug, copie, classes, date } from '../../commun/js/outils.js';
import { lien, route, aller, garder } from '../routeur.js';
import { cfg, produits, rayons, bannieres, remises, commandes, pret, sauver, retirer, gererErreur } from '../etat.js';
import { TetePage, BarreEnregistrer } from '../composants/cadre.jsx';
import { Chargement } from './accueil.jsx';

/* Formulaire générique : état, détection des modifications, garde avant de quitter. */
export function useFormulaire(initial) {
  const [f, setF] = useState(() => copie(initial));
  const ref = useRef(JSON.stringify(initial));
  useEffect(() => garder(() => JSON.stringify(f) !== ref.current), [f]);
  return { f, maj: (p) => setF((x) => ({ ...x, ...p })), modifie: JSON.stringify(f) !== ref.current, valider: () => { ref.current = JSON.stringify(f); } };
}

function ChoixPhoto({ m, onChange, libelle = 'Photo', aide, paysage }) {
  const [envoi, setEnvoi] = useState(false);
  const choisir = async (fichier) => {
    if (!fichier) return; setEnvoi(true);
    try { const c = await compresser(fichier, paysage ? 1920 : 1000, 0.82); const r = await envoyerPhoto(c.blob); onChange({ ...r, w: c.w, h: c.h }); toast('Photo ajoutée', { icone: 'image' }); }
    catch (e) { gererErreur(e, 'Cette photo n’a pas pu être ajoutée'); }
    setEnvoi(false);
  };
  return (
    <div class="choix-photo">
      <div class={classes('cp-apercu', paysage && 'paysage')}>{envoi ? <span class="rouet" /> : <Photo m={m} alt="" tailles="320px" />}</div>
      <div class="pile">
        <span class="champ-libelle">{libelle}</span>
        {aide ? <p class="champ-aide">{aide}</p> : null}
        <div class="rangee-l">
          <label class={classes('btn btn-secondaire btn-s', envoi && 'charge')}><Icone n="envoyer" />{m ? 'Changer la photo' : 'Ajouter une photo'}<input type="file" accept="image/*" hidden onChange={(e) => { const x = e.currentTarget.files[0]; e.currentTarget.value = ''; choisir(x); }} /></label>
          {m ? <button class="btn btn-fantome btn-s" onClick={() => onChange(null)}><Icone n="poubelle" />Retirer</button> : null}
        </div>
      </div>
    </div>
  );
}

function ListeCatalogue({ titre, sous, cle, liste, ligne, vide, icone }) {
  return (
    <>
      <TetePage titre={titre} sous={sous} parent="/plus" actions={<a class="btn btn-primaire btn-s" href={lien(`/${cle}/nouveau`)}><Icone n="plus" />Ajouter</a>} />
      {!pret.value ? <Chargement /> : liste.length ? <div class="liste">{liste.map(ligne)}</div>
        : <div class="carte"><Vide icone={icone} titre={vide[0]} texte={vide[1]}><a class="btn btn-primaire" href={lien(`/${cle}/nouveau`)}><Icone n="plus" />Ajouter</a></Vide></div>}
    </>
  );
}

/* ---------- Rayons ---------- */

export function Rayons() {
  const ps = produits.value;
  return (
    <ListeCatalogue titre="Rayons" sous="L’organisation de la boutique (Femmes, Montres, Électronique…)" cle="rayons" icone="rayons" liste={rayons.value} vide={['Aucun rayon', 'Créez vos rayons : bijoux, habits, montres, électronique, sacs…']}
      ligne={(r) => {
        const n = ps.filter((p) => (p.collectionIds || []).includes(r.id)).length;
        const img = r.image || R.imagePrincipale(ps.find((p) => (p.collectionIds || []).includes(r.id)) || {});
        return <a key={r.id} class="ligne" href={lien('/rayons/' + r.id)}><span class="ligne-vignette ronde-photo"><Photo m={img} alt="" tailles="48px" /></span><span class="ligne-texte"><b>{r.name}</b><small>{pluriel(n, 'produit')} · position {R.int(r.order) || '—'}</small><span class="ligne-pastilles">{r.visible === false ? <Pastille ton="neutre" point>Masqué</Pastille> : <Pastille ton="ok" point>Visible</Pastille>}{r.demo ? <Pastille ton="marque">Exemple</Pastille> : null}</span></span><Icone n="droite" classe="chevron" /></a>;
      }} />
  );
}

function FormRayon({ id, source }) {
  const { f, maj, modifie, valider } = useFormulaire(source || { name: '', visible: true, order: rayons.value.length + 1, image: null });
  const [occupe, setOccupe] = useState(false);
  const n = produits.value.filter((p) => (p.collectionIds || []).includes(id)).length;
  const enregistrer = async () => {
    const nom = R.nettoyer(f.name, 40); if (nom.length < 2) { toast('Donnez un nom au rayon', { icone: 'alerte', ton: 'danger' }); return; }
    setOccupe(true);
    try { await sauver('collections', id, { ...f, name: nom, order: R.int(f.order) }); valider(); toast('Rayon enregistré'); aller('/rayons', { remplacer: true, forcer: true }); }
    catch (e) { gererErreur(e); setOccupe(false); }
  };
  const supprimer = async () => {
    if (!(await confirmer({ titre: `Supprimer le rayon « ${f.name} » ?`, texte: n ? `Les ${n} produits du rayon restent en vente, simplement sans ce rayon.` : '', ok: 'Supprimer', danger: true }))) return;
    try { await retirer('collections', id); valider(); toast('Rayon supprimé', { icone: 'poubelle' }); aller('/rayons', { remplacer: true, forcer: true }); } catch (e) { gererErreur(e); }
  };
  return (
    <>
      <TetePage titre={source ? 'Modifier le rayon' : 'Nouveau rayon'} sous={source ? source.name : ''} parent="/rayons" />
      <div class="formulaire-etroit pile-l">
        <section class="carte formulaire">
          <Champ libelle="Nom du rayon">{(a) => <input class="saisie" {...a} value={f.name} onInput={(e) => maj({ name: e.currentTarget.value })} maxlength="40" placeholder="Ex. : Bijoux" />}</Champ>
          <Champ libelle="Position" aide="Ordre d’affichage dans la boutique (1 = en premier).">{(a) => <input class="saisie" {...a} inputmode="numeric" value={f.order} onInput={(e) => maj({ order: e.currentTarget.value.replace(/\D/g, '') })} />}</Champ>
          <Bascule actif={f.visible !== false} onClick={() => maj({ visible: f.visible === false })} libelle="Visible dans la boutique" />
        </section>
        <section class="carte"><ChoixPhoto m={f.image} onChange={(m) => maj({ image: m })} libelle="Photo du rayon" aide="Une photo carrée et nette d’un article du rayon. Sans photo, la boutique utilise celle d’un article." /></section>
        {source ? <section class="carte"><button class="btn btn-danger" onClick={supprimer}><Icone n="poubelle" />Supprimer le rayon</button></section> : null}
      </div>
      <BarreEnregistrer modifie={modifie} occupe={occupe} onEnregistrer={enregistrer} onAnnuler={() => aller('/rayons')} />
    </>
  );
}

/* ---------- Bannières ---------- */

export function Bannieres() {
  return (
    <ListeCatalogue titre="Bannières d’accueil" sous="Les images qui défilent derrière « Sokoyetu » en haut de l’accueil" cle="bannieres" icone="megaphone" liste={bannieres.value} vide={['Aucune bannière', 'Sans bannière, l’accueil montre les images du port, de la douane et du transit.']}
      ligne={(b) => <a key={b.id} class="ligne" href={lien('/bannieres/' + b.id)}><span class="ligne-vignette paysage"><Photo m={b.image} alt="" tailles="96px" /></span><span class="ligne-texte"><b>{b.title || 'Sans titre'}</b><small>{b.eyebrow || '—'} · position {R.int(b.order) || '—'}</small><span class="ligne-pastilles">{b.active === false ? <Pastille ton="neutre" point>Masquée</Pastille> : <Pastille ton="ok" point>Active</Pastille>}{!b.image ? <Pastille ton="alerte">Sans photo</Pastille> : null}{b.demo ? <Pastille ton="marque">Exemple</Pastille> : null}</span></span><Icone n="droite" classe="chevron" /></a>} />
  );
}

function FormBanniere({ id, source }) {
  const { f, maj, modifie, valider } = useFormulaire(source || { eyebrow: '', title: '', subtitle: '', cta: 'Découvrir', collectionId: '', image: null, order: bannieres.value.length + 1, active: true });
  const [occupe, setOccupe] = useState(false);
  const c = cfg.value;
  const enregistrer = async () => {
    if (!R.nettoyer(f.title, 80)) { toast('Donnez un titre à la bannière', { icone: 'alerte', ton: 'danger' }); return; }
    if (!f.image) { toast('Ajoutez une photo : elle défile derrière « Sokoyetu »', { icone: 'alerte', ton: 'danger' }); return; }
    setOccupe(true);
    try { await sauver('banners', id, { ...f, title: R.nettoyer(f.title, 80), eyebrow: R.nettoyer(f.eyebrow, 40), subtitle: R.nettoyer(f.subtitle, 90), cta: R.nettoyer(f.cta, 26) || 'Découvrir', order: R.int(f.order) }); valider(); toast('Bannière enregistrée'); aller('/bannieres', { remplacer: true, forcer: true }); }
    catch (e) { gererErreur(e); setOccupe(false); }
  };
  const supprimer = async () => {
    if (!(await confirmer({ titre: 'Supprimer cette bannière ?', ok: 'Supprimer', danger: true }))) return;
    try { await retirer('banners', id); valider(); toast('Bannière supprimée', { icone: 'poubelle' }); aller('/bannieres', { remplacer: true, forcer: true }); } catch (e) { gererErreur(e); }
  };
  return (
    <>
      <TetePage titre={source ? 'Modifier la bannière' : 'Nouvelle bannière'} parent="/bannieres" />
      <div class="formulaire-grille">
        <div class="pile-l">
          <section class="carte">
            <h2 class="carte-titre"><Icone n="oeil" />Aperçu</h2>
            <div class="apercu-heros">
              {f.image ? <Photo m={f.image} alt="" tailles="640px" /> : <div class="media-vide"><Icone n="image" /></div>}
              <div class="ah-voile" />
              <div class="ah-texte"><span class="ah-marque"><Cabas taille={48} />{c.name}</span><small>{c.tagline}</small>{f.eyebrow ? <em>{f.eyebrow}</em> : null}<b>{f.title || 'Votre titre'}</b>{f.cta ? <span class="ah-cta">{f.cta}</span> : null}</div>
            </div>
          </section>
          <section class="carte formulaire">
            <Champ libelle="Surtitre" facultatif>{(a) => <input class="saisie" {...a} value={f.eyebrow} onInput={(e) => maj({ eyebrow: e.currentTarget.value })} maxlength="40" placeholder="Ex. : Arrivage de la semaine" />}</Champ>
            <Champ libelle="Titre">{(a) => <input class="saisie" {...a} value={f.title} onInput={(e) => maj({ title: e.currentTarget.value })} maxlength="80" placeholder="Ex. : Les montres de la saison" />}</Champ>
            <Champ libelle="Sous-titre" facultatif>{(a) => <input class="saisie" {...a} value={f.subtitle} onInput={(e) => maj({ subtitle: e.currentTarget.value })} maxlength="90" />}</Champ>
            <div class="deux-colonnes">
              <Champ libelle="Texte du bouton">{(a) => <input class="saisie" {...a} value={f.cta} onInput={(e) => maj({ cta: e.currentTarget.value })} maxlength="26" />}</Champ>
              <Champ libelle="Le bouton mène à">{(a) => (
                <select class="saisie" {...a} value={f.collectionId || ''} onChange={(e) => maj({ collectionId: e.currentTarget.value })}>
                  <option value="">Tous les rayons</option><option value="new">Nouveautés</option><option value="aide">Comment ça marche</option>
                  {rayons.value.map((r) => <option key={r.id} value={r.id}>Rayon : {r.name}</option>)}
                </select>
              )}</Champ>
            </div>
          </section>
        </div>
        <div class="pile-l colonne-cote">
          <section class="carte"><ChoixPhoto paysage m={f.image} onChange={(m) => maj({ image: m })} libelle="Photo de fond" aide="Une photo large (paysage), sans texte : le port, un arrivage, vos articles mis en scène. « Sokoyetu » s’écrit au centre, par-dessus." /></section>
          <section class="carte formulaire">
            <Champ libelle="Position" aide="1 = la première image du défilement.">{(a) => <input class="saisie" {...a} inputmode="numeric" value={f.order} onInput={(e) => maj({ order: e.currentTarget.value.replace(/\D/g, '') })} />}</Champ>
            <Bascule actif={f.active !== false} onClick={() => maj({ active: f.active === false })} libelle="Afficher sur l’accueil" />
          </section>
          {source ? <section class="carte"><button class="btn btn-danger" onClick={supprimer}><Icone n="poubelle" />Supprimer la bannière</button></section> : null}
        </div>
      </div>
      <BarreEnregistrer modifie={modifie} occupe={occupe} onEnregistrer={enregistrer} onAnnuler={() => aller('/bannieres')} />
    </>
  );
}

/* ---------- Réductions ---------- */

const utilisations = (code) => commandes.value.filter((o) => o.status !== 'cancelled' && o.discount && o.discount.code === String(code).toUpperCase());
export function Remises() {
  return (
    <ListeCatalogue titre="Réductions" sous="Codes promo saisis par les clients au moment de payer" cle="remises" icone="pourcent" liste={remises.value} vide={['Aucun code promo', 'Créez un code (ex. BIENVENUE10) à partager sur WhatsApp ou Facebook.']}
      ligne={(d) => {
        const u = utilisations(d.code); const fini = d.endsAt && d.endsAt < Date.now();
        return <a key={d.id} class="ligne" href={lien('/remises/' + d.id)}><span class="ligne-vignette"><Icone n="pourcent" /></span><span class="ligne-texte"><b class="code">{d.code}</b><small>{d.type === 'percent' ? `−${R.num(d.value)} %` : `−${dollars(d.value)}`}{R.num(d.minSubtotal) ? ` dès ${dollars(d.minSubtotal)}` : ''} · {pluriel(u.length, 'utilisation')}</small><span class="ligne-pastilles">{d.active === false || fini ? <Pastille ton="neutre" point>{fini ? 'Expiré' : 'Inactif'}</Pastille> : <Pastille ton="ok" point>Actif</Pastille>}{d.demo ? <Pastille ton="marque">Exemple</Pastille> : null}</span></span><Icone n="droite" classe="chevron" /></a>;
      }} />
  );
}

function FormRemise({ id, source }) {
  const { f, maj, modifie, valider } = useFormulaire(source || { code: '', type: 'percent', value: 10, minSubtotal: '', endsAt: null, active: true });
  const [occupe, setOccupe] = useState(false);
  const u = source ? utilisations(source.code) : [];
  const enregistrer = async () => {
    const code = R.valider.codePromo(f.code); const v = R.num(f.value);
    const err = !code ? 'Code : 3 à 20 lettres, chiffres ou tirets' : !(v > 0) ? 'Indiquez la valeur de la réduction' : f.type === 'percent' && v > 90 ? 'Une réduction ne peut pas dépasser 90 %'
      : remises.value.some((d) => d.id !== id && String(d.code).toUpperCase() === code) ? 'Ce code existe déjà' : '';
    if (err) { toast(err, { icone: 'alerte', ton: 'danger' }); return; }
    setOccupe(true);
    try { await sauver('discounts', id, { ...f, code, value: v, minSubtotal: R.num(f.minSubtotal) }); valider(); toast('Code promo enregistré'); aller('/remises', { remplacer: true, forcer: true }); }
    catch (e) { gererErreur(e); setOccupe(false); }
  };
  const supprimer = async () => {
    if (!(await confirmer({ titre: `Supprimer le code ${f.code} ?`, texte: 'Les commandes passées avec ce code restent intactes.', ok: 'Supprimer', danger: true }))) return;
    try { await retirer('discounts', id); valider(); toast('Code supprimé', { icone: 'poubelle' }); aller('/remises', { remplacer: true, forcer: true }); } catch (e) { gererErreur(e); }
  };
  return (
    <>
      <TetePage titre={source ? 'Modifier le code promo' : 'Nouveau code promo'} sous={source ? `${pluriel(u.length, 'utilisation')} · ${dollars(u.reduce((a, o) => a + R.num(o.discount.amount), 0))} offerts` : ''} parent="/remises" />
      <div class="formulaire-etroit pile-l">
        <section class="carte formulaire">
          <Champ libelle="Code" aide="Le client le saisit à l’étape Paiement.">{(a) => <input class="saisie saisie-code" {...a} value={f.code} onInput={(e) => maj({ code: e.currentTarget.value.toUpperCase().replace(/\s+/g, '') })} maxlength="20" placeholder="Ex. : BIENVENUE10" autocapitalize="characters" />}</Champ>
          <span class="champ-libelle">Type de réduction</span>
          <Segment plein libelle="Type" options={[['percent', 'Pourcentage'], ['fixed', 'Montant fixe']]} valeur={f.type} onChange={(v) => maj({ type: v })} />
          <div class="deux-colonnes">
            <Champ libelle={f.type === 'percent' ? 'Valeur (%)' : 'Valeur ($)'}>{(a) => <input class="saisie" {...a} inputmode="decimal" value={f.value} onInput={(e) => maj({ value: e.currentTarget.value })} />}</Champ>
            <Champ libelle="Achat minimum ($)" facultatif>{(a) => <input class="saisie" {...a} inputmode="decimal" value={f.minSubtotal || ''} onInput={(e) => maj({ minSubtotal: e.currentTarget.value })} placeholder="0" />}</Champ>
          </div>
          <Champ libelle="Date de fin" facultatif>{(a) => <input class="saisie" {...a} type="date" value={f.endsAt ? new Date(f.endsAt).toISOString().slice(0, 10) : ''} onInput={(e) => maj({ endsAt: e.currentTarget.value ? new Date(e.currentTarget.value + 'T23:59:59').getTime() : null })} />}</Champ>
          <Bascule actif={f.active !== false} onClick={() => maj({ active: f.active === false })} libelle="Code actif" sous={f.endsAt ? `Valable jusqu’au ${date(f.endsAt, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Sans date de fin'} />
        </section>
        {source ? <section class="carte"><button class="btn btn-danger" onClick={supprimer}><Icone n="poubelle" />Supprimer le code</button></section> : null}
      </div>
      <BarreEnregistrer modifie={modifie} occupe={occupe} onEnregistrer={enregistrer} onAnnuler={() => aller('/remises')} />
    </>
  );
}

/* Une fiche (rayon, bannière ou code) : identifiant de l'adresse ou nouveau. */
export function FicheCatalogue({ type }) {
  const id0 = route.value.segs[1];
  const [nouvelId] = useState(() => uid());
  if (!pret.value) return <Chargement />;
  const listes = { rayons: rayons.value, bannieres: bannieres.value, remises: remises.value };
  const source = id0 === 'nouveau' ? null : listes[type].find((x) => x.id === id0);
  if (id0 !== 'nouveau' && !source) return <><TetePage titre="Introuvable" parent={'/' + type} /><div class="carte"><Vide icone="info" titre="Élément introuvable" texte="Il a peut-être été supprimé." /></div></>;
  const id = source ? source.id : type === 'rayons' ? nouvelId : nouvelId;
  const F = { rayons: FormRayon, bannieres: FormBanniere, remises: FormRemise }[type];
  return <F key={route.value.cle} id={id} source={source ? (({ id: _, ...r }) => r)(source) : null} />;
}

export const slugRayon = (nom) => slug(nom);
