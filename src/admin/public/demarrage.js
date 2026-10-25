/* Sokoyetu — applique le thème choisi (clair par défaut, sombre en option) avant l’affichage de l’administration, pour éviter un éclair blanc. */
(function () {
  try {
    if (localStorage.getItem('sokoyetu:theme') === '"sombre"' || localStorage.getItem('sokoyetu:mode') === '"dark"') {
      document.documentElement.dataset.theme = 'dark';
      var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', '#15110E');
    }
  } catch (e) { }
})();
