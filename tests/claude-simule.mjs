// Faux service Claude pour les tests de l'assistant (même adresse et même forme de réponse que l'API Messages) :
//   POST /v1/messages   → fiche produit (schéma avec « title ») ou cadre seul, en JSON dans un bloc texte.
// Clé acceptée : sk-ant-essai-0123456789. Les cadres renvoyés tournent dans la liste CADRES ([gauche, haut, droite, bas] en millièmes).
//   PORT=8097 CADRES='[[458,528,777,826],[126,461,511,723]]' node tests/claude-simule.mjs
//   ANTHROPIC_API_KEY=sk-ant-essai-0123456789 ANTHROPIC_URL=http://127.0.0.1:8097 bash outils/serveur-local.sh
import http from 'node:http';
const PORT = Number(process.env.PORT || 8097);
const CLE = 'sk-ant-essai-0123456789';
const CADRES = JSON.parse(process.env.CADRES || '[[250,200,750,800]]');
let n = 0;
http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const r = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.method !== 'POST' || req.url !== '/v1/messages') return r(404, { type: 'error', error: { type: 'not_found_error', message: 'Not found' } });
    if (req.headers['x-api-key'] !== CLE) return r(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const b = JSON.parse(corps || '{}'); const schema = ((b.output_config || {}).format || {}).schema || {};
    const contenu = ((b.messages || [])[0] || {}).content || [];
    if (!b.model || !(contenu[0] && contenu[0].type === 'image') || !schema.properties || !schema.properties.cadre) return r(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } });
    const [gauche, haut, droite, bas] = CADRES[n++ % CADRES.length];
    const cadre = { gauche, haut, droite, bas };
    const sortie = schema.properties.title ? {
      title: 'Sac bandoulière en cuir camel', description: 'Un petit sac à rabat en cuir grainé, à porter en bandoulière ou à la main. Assez grand pour le téléphone, le portefeuille et les clés.',
      details: [{ name: 'Matière', value: 'Cuir grainé (probable)' }, { name: 'Fermeture', value: 'Rabat' }, { name: 'Bandoulière', value: 'Réglable' }],
      colors: [{ name: 'Camel', hex: '#8B4A2B' }], sizes: [], collectionIds: [], newCollection: 'Sacs', tags: ['sac', 'bandoulière', 'cuir', 'camel', 'femme'],
      alt: 'Sac bandoulière en cuir camel, vue de trois quarts', cadre
    } : { cadre };
    console.log(`claude → ${schema.properties.title ? 'fiche' : 'cadre'} ${JSON.stringify(cadre)}`);
    r(200, { id: 'msg_essai' + Date.now(), type: 'message', role: 'assistant', model: b.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(sortie) }], usage: { input_tokens: 1500, output_tokens: 200 } });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Faux Claude sur http://127.0.0.1:${PORT}`));
