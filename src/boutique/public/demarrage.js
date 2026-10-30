/* Sokoyetu — applique le thème choisi (clair par défaut, sombre en option) avant l'affichage, pour éviter un éclair blanc. */
(function () {
  try {
    if (localStorage.getItem('sokoyetu:theme') === '"sombre"' || localStorage.getItem('sokoyetu:mode') === '"dark"') {
      document.documentElement.dataset.theme = 'dark';
      var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', '#15110E');
    }
  } catch (e) { }
})();

/* Démarrage lent ou impossible (connexion très faible, fichier bloqué) : au bout de 15 secondes sans application,
   le cercle de chargement laisse place à un message et à un bouton « Réessayer » (jamais un écran figé). */
setTimeout(function () {
  try {
    if (window.__sokoyetuDemarre) return;
    var app = document.getElementById('app');
    if (!app || !app.querySelector('.ecran-demarrage, .demarrage')) return;
    var boite = document.createElement('div');
    boite.setAttribute('role', 'alert');
    boite.style.cssText = 'min-height:100vh;display:grid;place-content:center;justify-items:center;gap:14px;padding:24px;text-align:center;font:16px/1.5 system-ui,sans-serif;color:inherit';
    var titre = document.createElement('p'); titre.style.cssText = 'font-weight:700;font-size:18px;margin:0';
    titre.textContent = navigator.onLine === false ? 'Pas de connexion internet' : 'Le chargement prend plus de temps que prévu';
    var texte = document.createElement('p'); texte.style.cssText = 'margin:0;opacity:.75;max-width:32ch';
    texte.textContent = navigator.onLine === false ? 'Vérifiez votre connexion, puis réessayez.' : 'Votre connexion semble lente. Réessayez dans un instant.';
    var bouton = document.createElement('button'); bouton.type = 'button'; bouton.textContent = 'Réessayer';
    bouton.style.cssText = 'margin-top:6px;padding:12px 22px;border-radius:999px;border:0;background:#2A1D16;color:#FBF8F4;font:600 16px system-ui,sans-serif;cursor:pointer';
    bouton.onclick = function () { location.reload(); };
    boite.appendChild(titre); boite.appendChild(texte); boite.appendChild(bouton);
    app.textContent = ''; app.appendChild(boite);
  } catch (e) { }
}, 15000);
