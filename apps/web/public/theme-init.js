// Applies the saved theme before first paint (external file: the CSP forbids inline scripts).
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('kae.theme') || 'system';
  } catch {
    /* storage unavailable */
  }
  var dark = pref === 'dark' || (pref === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0d1017' : '#f6f7f9');
})();
