/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — avis et notes des clients sur les articles (pb_hooks/lib/avis.js). Seuls les clients qui ont reçu l'article
 * donnent leur avis (commande livrée, prouvée par leur compte, leur appareil ou le lien de suivi) : un avis par article et
 * par téléphone, que le client peut modifier. L'équipe (propriétaire et vendeurs : droit « avis ») les lit en temps réel,
 * répond publiquement, et masque un avis abusif ; les routes du serveur sont seules à les écrire.
 *   avis   article, commande et numéro, téléphone, compte, appareil (empreinte, jamais montrée), nom public (« Aline F. »),
 *          note de 1 à 5, texte, option achetée, état (publie, attente, masque) et motif, réponse de la boutique
 */
const EQUIPE = '@request.auth.collectionName = "admins" && @request.auth.role != "livreur"';
const LIMITES = [
  { label: '/api/sokoyetu/avis', audience: '', maxRequests: 120, duration: 60 },
  { label: '/api/sokoyetu/avis/a-donner', audience: '', maxRequests: 60, duration: 60 },
  { label: '/api/sokoyetu/avis/donner', audience: '', maxRequests: 12, duration: 60 }
];

migrate((app) => {
  app.save(new Collection({
    type: 'base', name: 'avis',
    listRule: EQUIPE, viewRule: EQUIPE, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'produit', type: 'text', max: 40 },
      { name: 'commande', type: 'text', max: 20 },
      { name: 'numero', type: 'text', max: 12 },
      { name: 'telephone', type: 'text', max: 20 },
      { name: 'client', type: 'text', max: 20 },
      { name: 'appareil', type: 'text', max: 64, hidden: true },
      { name: 'nom', type: 'text', max: 60 },
      { name: 'note', type: 'number' },
      { name: 'texte', type: 'text', max: 700 },
      { name: 'variante', type: 'text', max: 90 },
      { name: 'etat', type: 'text', max: 10 },
      { name: 'motif', type: 'text', max: 20 },
      { name: 'reponse', type: 'text', max: 700 },
      { name: 'reponse_par', type: 'text', max: 80 },
      { name: 'reponse_le', type: 'number' },
      { name: 'cree', type: 'number' },
      { name: 'maj', type: 'number' },
      { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_avis_produit_telephone ON avis (produit, telephone)',
      'CREATE INDEX idx_avis_produit_etat ON avis (produit, etat, cree)',
      'CREATE INDEX idx_avis_etat ON avis (etat, cree)',
      'CREATE INDEX idx_avis_client ON avis (client)'
    ]
  }));

  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  const liste = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  const generale = liste.findIndex((x) => x.label === '/api/');
  liste.splice(generale < 0 ? liste.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = liste;
  app.save(s);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('avis')); } catch (e) { }
  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  app.save(s);
});
