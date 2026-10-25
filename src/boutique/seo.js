// Sokoyetu (boutique) — titre, description et données structurées de chaque page (référencement, partages).
function meta(attr, nom, valeur) {
  let m = document.head.querySelector(`meta[${attr}="${nom}"]`);
  if (!m) { m = document.createElement('meta'); m.setAttribute(attr, nom); document.head.appendChild(m); }
  m.setAttribute('content', valeur);
}

export function pageSeo({ titre, description, noindex = false, image, ld, chemin }) {
  document.title = titre;
  if (description) { meta('name', 'description', description.slice(0, 200)); meta('property', 'og:description', description.slice(0, 200)); }
  meta('property', 'og:title', titre);
  meta('name', 'robots', noindex ? 'noindex' : 'index, follow');
  if (image) meta('property', 'og:image', new URL(image, location.href).href);
  let c = document.head.querySelector('link[rel="canonical"]');
  if (chemin !== undefined) {
    if (!c) { c = document.createElement('link'); c.rel = 'canonical'; document.head.appendChild(c); }
    c.href = location.origin + chemin;
    meta('property', 'og:url', location.origin + chemin);
  }
  let s = document.getElementById('donnees-structurees');
  if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'donnees-structurees'; document.head.appendChild(s); }
  s.textContent = ld ? JSON.stringify(ld).replace(/</g, '\\u003c') : '';
}
