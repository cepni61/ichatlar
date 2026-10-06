/* =========================================================================
   İç Hatlar — tema seçici

   Temanın kendisi CSS'te: html[data-theme="..."] blokları :root token'larını
   yeniden tanımlıyor, bileşen CSS'i hiç değişmiyor. Bu dosya yalnızca
   seçiciyi çizer ve tercihi saklar.

   Seçici katlanabilir: kapalı dururken yalnızca mevcut temayı gösterir,
   tıklanınca listeyi açar. Menü YUKARI açılır çünkü profil bloğu kenar
   çubuğunun dibinde; aşağı açılsa görünür alandan taşardı.

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
  ];
  var IDS = THEMES.map(function (t) { return t.id; });

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(path, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }

  var CHEVRON = 'm6 15 6-6 6 6';
  var CHECK = 'M20 6 9 17l-5-5';

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

  var els = null; // { wrap, trigger, menu, curSwatch, curName, opts }

  function apply(id) {
    if (id === 'light') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = id;
    try { localStorage.setItem(KEY, id); } catch (e) { /* yok sayılabilir */ }
    sync();
  }

  function sync() {
    if (!els) return;
    var now = current();
    var m = meta(now);
    els.curName.textContent = m.label;
    els.curSwatch.style.background = m.bg;
    els.curSwatch.style.setProperty('--sw-accent', m.accent);
    els.opts.forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.theme === now));
    });
  }

  function open() {
    if (!els) return;
    els.menu.hidden = false;
    els.trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }

  function close(focusTrigger) {
    if (!els) return;
    els.menu.hidden = true;
    els.trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (focusTrigger) els.trigger.focus();
  }

  function isOpen() {
    return els && !els.menu.hidden;
  }

  function onOutside(e) {
    if (els && !els.wrap.contains(e.target)) close(false);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
    // Oklarla seçenekler arasında dolaşma
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var list = els.opts;
    var i = list.indexOf(document.activeElement);
    if (i === -1) { e.preventDefault(); list[0].focus(); return; }
    e.preventDefault();
    var next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  }

  /* ---------------------------------------------------------------- kur */

  function build() {
    // Kopru profil blogunu yeniden kurarsa onceki menu DOM'dan dusmus olur;
    // acik kalmis belge dinleyicilerini birakmadan once temizle.
    if (els && !els.wrap.isConnected) { close(false); els = null; }

    var host = document.querySelector('.sidebar .profile');
    if (!host || host.querySelector('.theme-pick')) return;

    var wrap = document.createElement('div');
    wrap.className = 'theme-pick';

    // Tetikleyici: mevcut temayı gösterir
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'theme-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-controls', 'themeMenu');

    var curSwatch = swatch(meta(current()));
    trigger.appendChild(curSwatch);

    var txt = document.createElement('span');
    txt.className = 'tt-txt';
    var lbl = document.createElement('span');
    lbl.className = 'tt-lbl';
    lbl.textContent = 'Tema';
    var cur = document.createElement('span');
    cur.className = 'tt-cur';
    cur.textContent = meta(current()).label;
    txt.appendChild(lbl);
    txt.appendChild(cur);
    trigger.appendChild(txt);
    trigger.appendChild(icon(CHEVRON, 'tt-chev'));

    trigger.addEventListener('click', function () {
      if (isOpen()) close(false);
      else open();
    });

    // Menü
    var menu = document.createElement('div');
    menu.className = 'theme-menu';
    menu.id = 'themeMenu';
    menu.setAttribute('role', 'radiogroup');
    menu.setAttribute('aria-label', 'Tema seçimi');
    menu.hidden = true;

    var opts = THEMES.map(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-opt';
      b.dataset.theme = t.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.id === current()));

      b.appendChild(swatch(t));

      var nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = t.label;
      b.appendChild(nm);
      b.appendChild(icon(CHECK, 'tick'));

      b.addEventListener('click', function () {
        apply(t.id);
        close(true);
      });
      menu.appendChild(b);
      return b;
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    host.appendChild(wrap);

    els = { wrap: wrap, trigger: trigger, menu: menu, curSwatch: curSwatch, curName: cur, opts: opts };
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  // Köprü (api-store.js) profil bloğunu yeniden kurduğunda seçici silinebilir;
  // kısa bir gecikmeyle tekrar denenir.
  setTimeout(build, 1200);
  setTimeout(build, 3000);

  window.IhTheme = { apply: apply, current: current, open: open, close: close };
})();
