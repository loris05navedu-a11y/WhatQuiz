// Applique le thème choisi avant l'affichage pour éviter un flash de couleurs.
try {
  var theme = localStorage.getItem('wq:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {}
