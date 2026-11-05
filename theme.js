/* ReproBench — thème clair / sombre.
   Chargé dans <head>, avant la feuille de style, pour éviter un flash.
   « auto » suit le réglage de l'appareil. Le choix est gardé sur ce
   navigateur (préférence personnelle, rien en base). */
(function(){
  var KEY = 'rb-theme', ORDER = ['dark', 'light', 'auto'];
  var LABEL = { dark: 'sombre', light: 'clair', auto: 'automatique (comme l’appareil)' };
  function get(){ try{ return localStorage.getItem(KEY) || 'dark'; }catch(e){ return 'dark'; } }
  function effective(t){ return t === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; }
  function apply(t){
    document.documentElement.setAttribute('data-theme', effective(t));
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', effective(t) === 'light' ? '#eef3f2' : '#12181a');
    var b = document.getElementById('btnTheme');
    if(b){ b.title = 'Thème : ' + LABEL[t]; b.setAttribute('aria-label', 'Changer le thème (actuel : ' + LABEL[t] + ')'); b.textContent = t === 'light' ? '☀' : t === 'dark' ? '☾' : '◐'; }
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
