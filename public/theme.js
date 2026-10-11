/* =========================================================================
   İç Hatlar — tema seçici

   Temanın kendisi CSS'te: html[data-theme="..."] blokları :root token'larını
   yeniden tanımlıyor, bileşen CSS'i hiç değişmiyor. Bu dosya yalnızca
   seçiciyi çizer ve tercihi saklar.

   Seçici üst banttaki Tema düğmesinin penceresinde ([data-theme-slot]): beş
   renk örneği yan yana, seçili olanın çevresinde halka. Pencere zaten açılır
   kapanır; içinde ikinci bir açılır liste olmasın diye seçenekler doğrudan
   görünür. Pencerenin açılıp kapanması index.html'de (setThemePop).

   Tercih localStorage'da tutuluyor, sunucuda değil: bu bir görüntü tercihi,
   kişinin kayıtlarıyla ilgisi yok ve cihaz başına farklı olması makul.
   Sunucuya taşınması istenirse User tablosuna bir kolon eklenip
   /api/bootstrap ile gönderilmesi yeterli.

   İlk boyamadan önce uygulama index.html <head> içindeki küçük betikte
   yapılıyor — buraya bırakılsa tema bir kare gecikmeyle otururdu.
   ========================================================================= */
(function () {
  'use strict';

  var KEY = 'ih_theme';

  var THEMES = [
    { id: 'light',    label: 'Aydınlık',  bg: '#f6f8fc', accent: '#2563eb' },
    { id: 'dark',     label: 'Koyu',      bg: '#151c2e', accent: '#3b82f6' },
    { id: 'softdark', label: 'Yumuşak koyu', bg: '#1c2434', accent: '#eef1f6' },
    { id: 'zumrut',   label: 'Zümrüt',    bg: '#04372c', accent: '#10b981' },
    { id: 'santral',  label: 'Santral',   bg: '#2a2019', accent: '#e9ac45' },
  ];
  var IDS = THEMES.map(function (t) { return t.id; });

  function current() {
    var t = document.documentElement.dataset.theme;
    return IDS.indexOf(t) > 0 ? t : 'light';
  }

  function meta(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }

  function swatch(t) {
    var sw = document.createElement('span');
    sw.className = 'theme-swatch';
    sw.style.background = t.bg;
    sw.style.setProperty('--sw-accent', t.accent);
    return sw;
  }

  /* --------------------------------------------------------------- durum */

  var els = null; // { wrap, curName, opts }

  function apply(id) {
    if (id === 'light') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = id;
    try { localStorage.setItem(KEY, id); } catch (e) { /* yok sayılabilir */ }
    sync();
  }

  function sync() {
    if (!els) return;
    var now = current();
    els.curName.textContent = meta(now).label;
    els.opts.forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.theme === now));
    });
  }

  /* ---------------------------------------------------------------- kur */

  function build() {
    var host = document.querySelector('[data-theme-slot]');
    if (!host || host.querySelector('.theme-row')) return;

    var lbl = document.createElement('div');
    lbl.className = 'switch-lbl';
    lbl.appendChild(document.createTextNode('Tema: '));
    var cur = document.createElement('span');
    cur.className = 'tt-cur';
    lbl.appendChild(cur);

    var row = document.createElement('div');
    row.className = 'theme-row';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Tema');

    var opts = THEMES.map(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-opt';
      b.dataset.theme = t.id;
      b.title = t.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', t.label);
      b.appendChild(swatch(t));
      b.addEventListener('click', function () { apply(t.id); });
      row.appendChild(b);
      return b;
    });

    host.appendChild(lbl);
    host.appendChild(row);
    els = { wrap: host, curName: cur, opts: opts };
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  window.IhTheme = { apply: apply, current: current };
})();
