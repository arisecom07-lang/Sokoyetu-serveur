/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — fiches produits enrichies :
 *  - une courte vidéo par article (MP4 ou WebM, 30 Mo au plus) dans la médiathèque ;
 *  - limites anti-abus pour l'import depuis un fournisseur (lecture de pages et copie de photos).
 */
const VIDEOS = ['video/mp4', 'video/webm', 'video/quicktime'];
const LIMITES = [
  { label: '/api/sokoyetu/import/lien', audience: '', maxRequests: 20, duration: 60 },
  { label: '/api/sokoyetu/import/photo', audience: '', maxRequests: 120, duration: 60 }
];
migrate((app) => {
  const media = app.findCollectionByNameOrId('media');
  const fichier = media.fields.getByName('file');
  fichier.mimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].concat(VIDEOS);
  fichier.maxSize = 31457280;
  app.save(media);
  const s = app.settings();
  const labels = LIMITES.map((r) => r.label);
  // Avant la règle générale « /api/ » : la première règle qui correspond s'applique.
  s.rateLimits.rules = LIMITES.concat(s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0));
  app.save(s);
}, (app) => {
  const media = app.findCollectionByNameOrId('media');
  const fichier = media.fields.getByName('file');
  fichier.mimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  fichier.maxSize = 10485760;
  app.save(media);
  const s = app.settings();
  const labels = LIMITES.map((r) => r.label);
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => labels.indexOf(r.label) < 0);
  app.save(s);
});
