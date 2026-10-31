/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — discussion du client avec la boutique (pb_hooks/lib/discussions.js) : le service client dans l'application,
 * gratuit (ni SMS ni WhatsApp). Le client écrit depuis son compte, sinon depuis son appareil ; l'équipe répond depuis
 * l'administration (propriétaire et vendeurs : droit « messages »), et chaque réponse le prévient par une notification gratuite.
 *   discussions         une par client : son compte (client) ou son appareil (empreinte, jamais montrée), son nom, son
 *                       téléphone, le début du dernier message, messages non lus par l'équipe, à répondre, moments de lecture ;
 *                       lue en temps réel par l'administration, modifiée seulement par les routes du serveur
 *   sokoyetu_messages   les messages : auteur (client ou boutique), texte, article ou commande dont il parle, membre de l'équipe
 */
const EQUIPE = '@request.auth.collectionName = "admins" && @request.auth.role != "livreur"';
const LIMITES = [
  { label: '/api/sokoyetu/discussion', audience: '', maxRequests: 90, duration: 60 },
  { label: '/api/sokoyetu/discussion/envoyer', audience: '', maxRequests: 15, duration: 60 }
];

migrate((app) => {
  const discussions = new Collection({
    type: 'base', name: 'discussions',
    listRule: EQUIPE, viewRule: EQUIPE, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'client', type: 'text', max: 20 },
      { name: 'appareil', type: 'text', max: 64, hidden: true },
      { name: 'nom', type: 'text', max: 60 },
      { name: 'telephone', type: 'text', max: 20 },
      { name: 'dernier', type: 'text', max: 200 },
      { name: 'auteur', type: 'text', max: 10 },
      { name: 'maj', type: 'number' },
      { name: 'non_lus', type: 'number' },
      { name: 'a_repondre', type: 'bool' },
      { name: 'lu_client', type: 'number' },
      { name: 'lu_boutique', type: 'number' },
      { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: [
      'CREATE INDEX idx_discussions_client ON discussions (client)',
      'CREATE INDEX idx_discussions_appareil ON discussions (appareil)',
      'CREATE INDEX idx_discussions_maj ON discussions (maj)'
    ]
  });
  app.save(discussions);

  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, discussion TEXT NOT NULL, auteur TEXT NOT NULL, texte TEXT NOT NULL,
    produit TEXT NOT NULL DEFAULT '', commande TEXT NOT NULL DEFAULT '', par TEXT NOT NULL DEFAULT '', cree INTEGER NOT NULL DEFAULT 0)`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_messages_discussion ON sokoyetu_messages (discussion, id)').execute();

  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  const liste = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  const generale = liste.findIndex((x) => x.label === '/api/');
  liste.splice(generale < 0 ? liste.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = liste;
  app.save(s);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('discussions')); } catch (e) { }
  app.db().newQuery('DROP TABLE IF EXISTS sokoyetu_messages').execute();
  const s = app.settings();
  const labels = LIMITES.map((x) => x.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((x) => labels.indexOf(x.label) < 0);
  app.save(s);
});
