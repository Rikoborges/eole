/* ReproBench — thème clair / sombre.
   Chargé dans <head>, avant la feuille de style, pour éviter un flash.
   « auto » suit le réglage de l'appareil. Le choix est gardé sur ce
   navigateur (préférence personnelle, rien en base). */
const THEME_ICO = (function(){
  const svg = p => '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  const rays = '<path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
  return { light: svg('<circle cx="12" cy="12" r="4"/>' + rays), dark: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'), auto: svg('<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"/>' + rays) };
})();
(function(){
  var KEY = 'rb-theme', ORDER = ['auto', 'light', 'dark'];
  var LABEL = { dark: 'sombre', light: 'clair', auto: 'automatique (comme l’appareil)' };
  function get(){ try{ return localStorage.getItem(KEY) || 'auto'; }catch(e){ return 'auto'; } }
  function effective(t){ return t === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; }
  function apply(t){
    document.documentElement.setAttribute('data-theme', effective(t));
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', effective(t) === 'light' ? '#F3F4F6' : '#161E27');
    var b = document.getElementById('btnTheme');
    if(b){ b.title = 'Thème : ' + LABEL[t]; b.setAttribute('aria-label', 'Changer le thème (actuel : ' + LABEL[t] + ')'); b.innerHTML = THEME_ICO[t] || THEME_ICO.auto; }
  }
  apply(get());
  document.addEventListener('DOMContentLoaded', function(){
    apply(get());
    var b = document.getElementById('btnTheme');
    if(b) b.addEventListener('click', function(){
      var next = ORDER[(ORDER.indexOf(get()) + 1) % ORDER.length];
      try{ localStorage.setItem(KEY, next); }catch(e){}
      apply(next);
    });
  });
  if(window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', function(){ if(get() === 'auto') apply('auto'); });
})();

/* Application installable (téléphone / PC) : service worker, si le navigateur le permet */
if('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker :', e)); });
}

/* Bandeau « hors ligne » : rassure quand le Wi-Fi de l'atelier coupe */
(function(){
  function bar(){
    let el = document.getElementById('offlineBar');
    if(!el){ el = document.createElement('div'); el.id = 'offlineBar'; el.className = 'offline-bar'; el.setAttribute('role', 'status');
      el.textContent = 'Hors ligne : pas de réseau. Attendez son retour avant de valider une déclaration.'; el.hidden = true; document.body.appendChild(el); }
    return el;
  }
  function update(){ if(document.body) bar().hidden = navigator.onLine !== false; }
  window.addEventListener('online', () => { update(); });
  window.addEventListener('offline', update);
  document.addEventListener('DOMContentLoaded', update);
})();
