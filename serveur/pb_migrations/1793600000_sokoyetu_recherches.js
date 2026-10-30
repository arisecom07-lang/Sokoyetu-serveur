/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — recherches de la boutique (voir pb_hooks/lib/audience.js) : une ligne par jour, mot cherché et appareil
 * (identifiant tiré au sort, ni nom, ni téléphone, ni adresse IP), avec le nombre d'articles trouvés. Elles donnent les
 * recherches populaires proposées aux visiteurs, et à la boutique ce que ses clients cherchent sans le trouver.
 * Limites anti-abus : recherches populaires (lues à l'ouverture de la recherche) et pages des paniers partagés.
 */
const LIMITES = [
  { label: '/api/sokoyetu/recherches', audience: '', maxRequests: 300, duration: 60 },
  { label: '/panier/partage', audience: '', maxRequests: 600, duration: 60 }
];

migrate((app) => {
  const db = app.db();
  db.newQuery(`CREATE TABLE IF NOT EXISTS sokoyetu_recherches (
    jour TEXT NOT NULL, terme TEXT NOT NULL, visiteur TEXT NOT NULL, texte TEXT NOT NULL DEFAULT '',
    resultats INTEGER NOT NULL DEFAULT 0, vu INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (jour, terme, visiteur))`).execute();
  db.newQuery('CREATE INDEX IF NOT EXISTS idx_sokoyetu_recherches_terme ON sokoyetu_recherches (terme, vu)').execute();

  const s = app.settings();
  const labels = LIMITES.map((r) => r.label);
  const regles = s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0);
  // Avant la règle générale « /api/ » (la première règle qui correspond s'applique).
  const generale = regles.findIndex((r) => r.label === '/api/');
  regles.splice(generale < 0 ? regles.length : generale, 0, ...LIMITES);
  s.rateLimits.rules = regles;
  app.save(s);
}, (app) => {
  app.db().newQuery('DROP TABLE IF EXISTS sokoyetu_recherches').execute();
  const s = app.settings();
  const labels = LIMITES.map((r) => r.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0);
  app.save(s);
});
