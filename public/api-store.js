/* =========================================================================
   İç Hatlar — arayüz veri katmanı köprüsü
   =========================================================================

   Prototip (ichatlar4.html) verisini localStorage'da tutuyordu. Bu dosya
   aynı arayüzü sunucuya bağlar ve **prototipin kendi kodunda tek satır
   değişiklik gerektirmez**. Bunu şu üç gerçek mümkün kılıyor:

     1. `const Store` yeniden atanamaz ama nesne özellikleri değiştirilebilir.
     2. `const DEPARTMENTS` / `USERS` dizileri yerinde mutasyona uğrar
        (uzunluk sıfırlanıp yeni öğeler push edilir).
     3. Klasik betikte `function foo(){}` tanımları `window` üzerinde durur,
        yani üzerine yazılabilir.

   Yükleme sırası önemli: bu dosya prototipin satır içi betiğinden SONRA,
   ama DOMContentLoaded'dan ÖNCE çalışır. Prototipin `init()` fonksiyonu boş
   veriyle bir kez çalışır (kullanıcı bunu görmez, üstte açılış katmanı var),
   ardından buradaki dinleyici gerçek veriyi yükleyip yeniden çizer.

   YETKİ NOTU: Buradaki hiçbir kontrol güvenlik sağlamaz. Düğmeleri gizlemek
   yalnızca arayüz kolaylığı; her aksiyonu sunucu `permissions.ts` ile
   yeniden doğrular. Bu dosya kurcalansa bile veri korunur.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- HTTP */

  async function req(method, path, body) {
    // FormData (dosya yükleme) olduğu gibi gider; tarayıcı sınır başlığını kendisi koyar.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    checkBuild(res);

    if (res.status === 401) {
      // Açılışta oturum yoksa doğrudan girişe. Uygulama açıkken düşerse
      // sayfadan atılmaz: kişi yarım kalan yazısını kaybetmesin diye bant
      // gösterilir, girişe ne zaman gideceğine kendisi karar verir.
      if (document.getElementById('ih-boot')) {
        location.href = loginUrl();
        throw new Error('oturum yok');
      }
      sessionExpired();
      const err = new Error('Oturumunuz sona erdi. Yeniden giriş yapın.');
      err.status = 401;
      throw err;
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        // Sunucu yeniden başlarken ara katman (ör. Cloudflare) HTML hata sayfası
        // döndürür; teknik "Unexpected token '<'" yerine anlaşılır mesaj.
        const err = new Error(res.ok
          ? 'Sunucudan beklenmeyen bir yanıt geldi. Sayfayı yenileyin.'
          : 'Sunucuya şu an ulaşılamıyor. Birkaç saniye sonra sayfayı yenileyin.');
        err.status = res.status;
        throw err;
      }
    }

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || 'İstek başarısız oldu.';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Girişten sonra aynı ekrana dönülsün (adres çubuğundaki #/... dahil). */
  const loginUrl = () => '/auth/login?returnTo=' + encodeURIComponent(location.pathname + location.hash);

  /** Sayfanın üstünde kalıcı bant: kişi ne zaman tıklayacağına kendisi karar verir. */
  function topBar(cls, html, label, onClick) {
    const bar = document.createElement('div');
    bar.className = 'session-bar ' + cls;
    bar.setAttribute('role', 'alert');
    bar.innerHTML = '<span>' + html + '</span><button type="button" class="btn btn-primary">' + label + '</button>';
    bar.querySelector('button').addEventListener('click', onClick);
    document.body.appendChild(bar);
  }

  let expired = false;
  function sessionExpired() {
    if (expired) return;
    expired = true;
    topBar('expired', '<b>Oturumunuz sona erdi.</b> Yazdıklarınız bu sayfada duruyor; ' +
      'gerekirse kopyalayın, sonra yeniden giriş yapın.', 'Yeniden giriş yap', () => { location.href = loginUrl(); });
  }

  /*
   * Arayüz sürümü (sunucu her yanıtta x-ih-build gönderir). Sunucu yeni
   * arayüzle yeniden başladığında açık sekme eski kodla çalışmaya devam
   * ediyordu: kişi düzeltilmiş ekranı göremiyordu. Sürüm değişince bant çıkar.
   */
  let build = null;
  let outdated = false;
  function checkBuild(res) {
    const b = res && res.headers && res.headers.get('x-ih-build');
    if (!b) return;
    if (!build) { build = b; return; }
    if (b === build || outdated) return;
    outdated = true;
    topBar('update', '<b>Uygulamanın yeni sürümü hazır.</b> Yazdıklarınızı gönderdiyseniz sayfayı yenileyin.',
      'Sayfayı yenile', () => location.reload());
  }
  // index.html'deki bildirim sorgusu (fetch ile) da aynı denetimden geçer.
  window.IhNet = { checkBuild, sessionExpired };

  const Api = {
    bootstrap: () => req('GET', '/api/bootstrap'),
    records: (params) => req('GET', '/api/records?' + new URLSearchParams(params || {})),
    record: (code) => req('GET', '/api/records/' + encodeURIComponent(code)),
    create: (payload) => req('POST', '/api/records', payload),
    similar: (payload) => req('POST', '/api/similar', payload),
    /** `bind: 'create'` → dosyalar doğrudan "kayıt oluşturuldu" adımına bağlanır. */
    upload: (code, files, opts) => {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('file', f, f.name));
      const q = opts && opts.bind ? '?bind=' + encodeURIComponent(opts.bind) : '';
      return req('POST', '/api/records/' + encodeURIComponent(code) + '/attachments' + q, fd);
    },
    dropAttachment: (id) => req('DELETE', '/api/attachments/' + encodeURIComponent(id)),
    act: (code, action, payload) =>
      req('POST', '/api/records/' + encodeURIComponent(code) + '/' + action, payload || {}),
    /** Yeni modüller (modules.js) için genel istek. */
    req,
  };

  /* Yardım oturumu (kayıt önleme günlüğü): kimliği sunucu üretir, sekme
     boyunca taşınır. Kayıt açılınca ya da "işime yaradı" ile form kapanınca
     bırakılır. Tarayıcı deposu kullanılamazsa günlük yalnızca oturumsuz kalır. */
  window.IhHelp = {
    session: {
      get() { try { return sessionStorage.getItem('ih_help') || null; } catch (_) { return null; } },
      set(id) {
        try { if (id) sessionStorage.setItem('ih_help', id); else sessionStorage.removeItem('ih_help'); } catch (_) { /* yok sayılabilir */ }
      },
    },
    /** Oturumsuz ilk istek yanıtlanmadan gelen ikincisi beklesin: ikisi ayrı oturum açardı. */
    pending: null,
    async sessionFor() {
      if (!this.session.get() && this.pending) await this.pending.catch(() => {});
      return this.session.get();
    },
    track(p) {
      if (!this.session.get()) this.pending = p;
      return p;
    },
    /** Sonuçla etkileşim; yazılamasa da arayüz etkilenmez. */
    mark(resultId, action) {
      if (resultId) req('POST', '/api/help/results/' + encodeURIComponent(resultId), { action }).catch(() => {});
    },
  };

  /* ------------------------------------------------------ açılış katmanı */

  const veil = document.createElement('div');
  veil.id = 'ih-boot';
  veil.innerHTML =
    '<style>' +
    '#ih-boot{position:fixed;inset:0;z-index:9999;background:#f6f8fc;display:flex;' +
    'align-items:center;justify-content:center;flex-direction:column;gap:14px;' +
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#3f4f75}" +
    '#ih-boot .r{width:26px;height:26px;border:2.5px solid #d6deec;border-top-color:#2563eb;' +
    'border-radius:50%;animation:ihs .8s linear infinite}' +
    '@keyframes ihs{to{transform:rotate(360deg)}}' +
    '#ih-boot b{font-size:14px;font-weight:600}' +
    '#ih-boot span{font-size:12.5px;color:#7b89a6;max-width:34ch;text-align:center;line-height:1.5}' +
    '#ih-boot button{margin-top:6px;border:1px solid #d6deec;background:#fff;border-radius:10px;' +
    'padding:8px 14px;font:inherit;font-size:13px;cursor:pointer}' +
    '</style>' +
    '<div class="r"></div><b>İç Hatlar yükleniyor</b>' +
    '<span>Kayıtlar ve ekip tanımları alınıyor.</span>';
  document.body.appendChild(veil);

  function veilError(message) {
    veil.innerHTML =
      veil.querySelector('style').outerHTML +
      '<b>Bağlantı kurulamadı</b>' +
      '<span>' + String(message).replace(/[<>&]/g, '') + '</span>' +
      '<button type="button">Yeniden dene</button>';
    // Satır içi onclick CSP (script-src-attr 'none') ile engellenir
    veil.querySelector('button').addEventListener('click', () => location.reload());
  }

  const hideVeil = () => veil.remove();

  /* ------------------------------------------------- yerel önbellek + Store */

  // Prototip `Store.data.records` dizisini her yerde eşzamanlı okuyor.
  // O yüzden sunucudan gelen kayıtları burada tutup mutasyonlardan sonra
  // yamalıyoruz — arayüz kodu değişmeden çalışsın.
  // Prototipin init()'i bizim bootstrap'ımızdan ÖNCE çalışıyor (dinleyicisi
  // daha erken kaydedildi). O ilk geçişte Store.me() null dönerse renderChrome
  // `me.name` üzerinde patlıyor ve prototipin hata bandı açılıyor. Bu yüzden
  // veri gelene kadar yer tutucu bir kullanıcı duruyor; bootstrap USERS
  // dizisini baştan doldurduğu için yer tutucu kendiliğinden kalkıyor.
  // Ayni sorun DEPARTMENTS icin de var: renderDashboard bos dizide
  // `perDept.sort()[0].d` okuyup "reading d" hatasi veriyordu. Yer tutucu
  // acilis katmaninin arkasinda kaldigi icin kullaniciya gorunmez.
  var BOOT_USER = { id: '__boot__', name: '—', dept: '__boot__', role: '—' };
  var BOOT_DEPT = { id: '__boot__', name: '—', short: '—' };
  USERS.length = 0;
  USERS.push(BOOT_USER);
  DEPARTMENTS.length = 0;
  DEPARTMENTS.push(BOOT_DEPT);

  Store.data = { currentUserId: BOOT_USER.id, records: [], seq: 0 };

  // Sunucudan dönen her kayıt sırası: yenileme sürerken yapılan işlemin
  // sonucu, yenilemenin daha önce başlamış (eski) yanıtıyla ezilmesin.
  let touchSeq = 0;
  const touched = new Map();
  function upsertLocal(rec) {
    touched.set(rec.code, ++touchSeq);
    const i = Store.data.records.findIndex((r) => r.code === rec.code);
    if (i >= 0) Store.data.records[i] = rec;
    else Store.data.records.unshift(rec);
    return rec;
  }

  Store.me = function () {
    return USERS.find((u) => u.id === Store.data.currentUserId) || null;
  };

  Store.find = function (code) {
    return Store.data.records.find((r) => r.code === code);
  };

  /* --------------------------------------------------------- yenileme */

  // Sunucu bir istekte en fazla 200 kayıt döner. Eskiden yalnızca ilk sayfa
  // alınıyordu: 300 kaydı görebilen yönetici 200 görüyordu. Artık toplam
  // sayıya ulaşana kadar sayfa sayfa çekilir.
  const PAGE_SIZE = 200;

  // scope=visible: her görünümün (Açtıklarım, Ekibime Gelenler, Üzerimdekiler,
  // Tüm Kayıtlar) kayıtları tek listede; Tüm Kayıtlar kayıttaki inAllRecords
  // bayrağıyla süzer (departman kapsamı, kısıtlı kayıt yok — 2026-10-09).
  // Aynı anda iki yenileme olmaz: ikinci çağıran ilkini bekler.
  let inflight = null;
  function refreshRecords() {
    if (!inflight) inflight = loadRecords().finally(() => { inflight = null; });
    return inflight;
  }

  async function loadRecords() {
    const seq0 = touchSeq;
    const first = await Api.records({ scope: 'visible', pageSize: PAGE_SIZE, page: 1 });
    const all = first.records.slice();
    for (let page = 2; all.length < first.total; page++) {
      const next = await Api.records({ scope: 'visible', pageSize: PAGE_SIZE, page });
      if (!next.records.length) break; // arada kayıt silindiyse sonsuz döngüye girme
      all.push(...next.records);
    }
    // Sayfalar arasında bir kayıt güncellenirse sıralaması kayar ve iki sayfada
    // birden gelebilir; kayıt numarasına göre tekilleştir.
    const byCode = new Map(all.map((r) => [r.code, r]));
    for (const local of Store.data.records) {
      const got = byCode.get(local.code);
      // Yükleme başladıktan sonra yerelde güncellenen (ya da açılan) kayıt daha yeni.
      if ((touched.get(local.code) || 0) > seq0) byCode.set(local.code, local);
      // Liste yalnızca son olayı taşır; değişmemiş kaydın detaydan gelen tam geçmişi kalsın.
      else if (got && got.historyPartial && !local.historyPartial && got.updatedAt === local.updatedAt) byCode.set(local.code, local);
    }
    const unique = [...byCode.values()];
    Store.data.records.length = 0;
    unique.forEach((r) => Store.data.records.push(r));
    return { ...first, records: unique };
  }

  /*
   * Güncellik (UX denetimi B03). Kayıtlar açılışta bir kez yüklendiği için
   * başka sekmede / başka kişinin eklediği yanıt, detaya yeniden girilse bile
   * görünmüyordu. Artık:
   *   - detay her açılışta sunucudan taze çekilir,
   *   - sekmeye dönüldüğünde ve görünürken dakikada bir veriler yenilenir.
   * Yeniden çizimde yazılmakta olan güncelleme metni korunur; açık pencere ya
   * da Yeni Kayıt formu varken liste yeniden çizilmez.
   */
  function rerenderKeepingDraft() {
    const box = $('#cmtInput');
    const text = box ? box.value : null;
    const focused = box && document.activeElement === box;
    if (typeof renderDetail === 'function') renderDetail();
    const again = $('#cmtInput');
    if (again && text != null) {
      again.value = text;
      if (focused) again.focus();
    }
  }

  async function refreshDetail(code) {
    try {
      const out = await Api.record(code);
      upsertLocal(out.record);
      if (typeof CURRENT !== 'undefined' && CURRENT === 'detail' && DETAIL_CODE === code) rerenderKeepingDraft();
    } catch (err) {
      if (err.status === 404 || err.status === 403) toast('Bu kayda artık erişiminiz yok', 'err');
    }
  }

  let lastRefresh = Date.now();
  async function refreshVisible() {
    if (expired || document.hidden || Date.now() - lastRefresh < 15000) return;
    if (!$('#modalRoot').hidden) return;
    lastRefresh = Date.now();
    try {
      if (CURRENT === 'detail') return refreshDetail(DETAIL_CODE);
      if (CURRENT === 'new-ticket') return;
      // Kayıt listesine bağlı olmayan ekranlar tazelenmez: yeniden çizim
      // yarım kalmış seçimleri (ör. yetki verilecek kişi) silerdi.
      if (CURRENT === 'kb' || CURRENT === 'search') return;
      await refreshRecords();
      if (typeof renderView === 'function') renderView(CURRENT);
      if (typeof renderChrome === 'function') renderChrome();
    } catch (_) { /* sessiz: bir sonraki denemede tekrar */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVisible(); });
  window.addEventListener('focus', refreshVisible);
  setInterval(refreshVisible, 60000);

  const origShow = window.show;
  window.show = function (id, param) {
    const out = origShow.apply(this, arguments);
    if (id === 'detail' && DETAIL_CODE) refreshDetail(DETAIL_CODE);
    return out;
  };

  /** Sunucu yanıtını önbelleğe yaz, ekranı tazele. */
  function applyAndRender(rec) {
    upsertLocal(rec);
    if (typeof renderDetail === 'function' && typeof CURRENT !== 'undefined' && CURRENT === 'detail') {
      renderDetail();
    } else if (typeof renderView === 'function' && typeof CURRENT !== 'undefined') {
      renderView(CURRENT);
    }
    if (typeof renderChrome === 'function') renderChrome();
  }

  /**
   * Aksiyon sarmalayıcı — hata mesajını sunucudan gelen metinle gösterir.
   * Hata çoğu zaman kaydın bu arada değiştiği anlamına gelir (ör. başkası
   * üzerine aldı): kayıt tazelenir ki ekranda geçersiz düğmeler kalmasın.
   */
  async function run(code, action, payload, okMessage) {
    try {
      const out = await Api.act(code, action, payload);
      applyAndRender(out.record);
      if (okMessage) toast(okMessage, 'ok');
      return out.record;
    } catch (err) {
      toast(err.message, 'err');
      if (err.status !== 401) refreshDetail(code);
      throw err;
    }
  }

  /* ------------------------------------------------------ ek dosyalar */

  /*
   * Güncelleme ve çözümle birlikte dosya ekleme. Dosya seçilince hemen
   * yüklenir (sunucuda "taslak"), etiket olarak listelenir; güncelleme/çözüm
   * gönderilince kimlikleri birlikte gider ve o olaya bağlanır. Taslaklar
   * kayıt + yuva (comment / resolve) bazında tutulur ki detay yeniden
   * çizildiğinde kaybolmasın.
   */
  const Uploads = { maxMb: 10, maxFiles: 5, extensions: [] };
  const Drafts = {};
  const draftKey = (slot) => slot + ':' + DETAIL_CODE;
  const drafts = (slot) => (Drafts[draftKey(slot)] = Drafts[draftKey(slot)] || []);

  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
    : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' bayt');
  window.fmtSize = fmtSize;

  /*
   * Yeni kayıt formu ("create" yuvası): henüz kayıt yok, dosyalar yüklenmez;
   * File nesneleri form.files içinde bekler ve kayıt oluşunca gönderilir.
   */
  const createItems = () => ((typeof form !== 'undefined' && form && form.files) || [])
    .map((f, i) => ({ id: 'f' + i, name: f.name, size: f.size }));

  function chipsHtml(slot) {
    return (slot === 'create' ? createItems() : drafts(slot)).map((a) =>
      '<span class="attach-chip">' + icon('clip') + ' ' + esc(a.name) + ' <small>' + fmtSize(a.size) + '</small>' +
      '<button type="button" data-attach-rm="' + esc(a.id) + '" data-slot="' + slot + '" aria-label="Kaldır: ' + esc(a.name) + '">' + icon('x') + '</button></span>',
    ).join('');
  }

  /** index.html'deki detay ve çözüm penceresi bunu çağırır. */
  window.attachPicker = function (slot) {
    const accept = Uploads.extensions.map((e) => '.' + e).join(',');
    return '<div class="attach" data-slot="' + slot + '">' +
      '<button type="button" class="btn btn-ghost btn-attach" data-attach-pick="' + slot + '">' + icon('clip') + ' Dosya ekle</button>' +
      '<input type="file" multiple hidden data-attach-input="' + slot + '" accept="' + accept + '">' +
      '<span class="attach-hint">En fazla ' + Uploads.maxFiles + ' dosya, her biri ' + Uploads.maxMb + ' MB. PDF, Office, görsel, TXT/CSV, e-posta, ZIP.</span>' +
      '<div class="attach-list" data-attach-list="' + slot + '">' + chipsHtml(slot) + '</div></div>';
  };

  function repaint(slot) {
    document.querySelectorAll('[data-attach-list="' + slot + '"]').forEach((el) => { el.innerHTML = chipsHtml(slot); });
    if (slot === 'create' && form.type === 'oneri' && typeof renderOneriPreview === 'function') renderOneriPreview();
  }
  /** Kaldırılan çipin düğmesi DOM'dan gider; odak sayfa başına düşmesin. */
  const focusPicker = (slot) => {
    const b = document.querySelector('[data-attach-pick="' + slot + '"]');
    if (b) b.focus();
  };
  window.repaintAttach = repaint;

  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-attach-pick]');
    if (pick) {
      const input = document.querySelector('[data-attach-input="' + pick.dataset.attachPick + '"]');
      if (input) input.click();
      return;
    }
    const rm = e.target.closest('[data-attach-rm]');
    if (rm && rm.dataset.slot === 'create') {
      form.files.splice(Number(rm.dataset.attachRm.slice(1)), 1);
      repaint('create');
      focusPicker('create');
      return;
    }
    if (rm) {
      const slot = rm.dataset.slot;
      const id = rm.dataset.attachRm;
      Api.dropAttachment(id).catch(() => {}); // sunucuda kalsa bile 24 saatte silinir
      Drafts[draftKey(slot)] = drafts(slot).filter((a) => a.id !== id);
      repaint(slot);
      focusPicker(slot);
    }
  });

  const extOf = (n) => ((/\.([a-z0-9]+)$/i.exec(n) || [])[1] || '').toLowerCase();

  document.addEventListener('change', async (e) => {
    const input = e.target.closest && e.target.closest('[data-attach-input]');
    if (!input || !input.files || !input.files.length) return;
    const slot = input.dataset.attachInput;
    const files = Array.from(input.files);
    input.value = '';

    // Uygun olanlar eklenir; olmayanlar tek mesajda nedeniyle söylenir.
    // (Önceden tek bir uygunsuz dosya geçerli olanları da düşürüyordu; boş
    // dosya ise sunucuda reddedilip kayıt anındaki tüm ekleri kaybettiriyordu.)
    const have = slot === 'create' ? form.files : drafts(slot);
    const same = (a, b) => a.name === b.name && a.size === b.size;
    const ok = [];
    const why = [];
    for (const f of files) {
      if (!Uploads.extensions.includes(extOf(f.name))) why.push('"' + f.name + '" türü desteklenmiyor');
      else if (f.size === 0) why.push('"' + f.name + '" boş bir dosya');
      else if (f.size > Uploads.maxMb * 1048576) why.push('"' + f.name + '" ' + Uploads.maxMb + ' MB sınırını aşıyor');
      else if (have.some((x) => same(x, f)) || ok.some((x) => same(x, f))) why.push('"' + f.name + '" zaten ekli');
      else ok.push(f);
    }
    const room = Math.max(0, Uploads.maxFiles - have.length);
    if (ok.length > room) {
      why.push('en fazla ' + Uploads.maxFiles + ' dosya eklenebilir, ' + (ok.length - room) + ' dosya dışarıda kaldı');
      ok.length = room;
    }
    if (why.length) {
      toast(why.join('; ') + (ok.length ? '. Diğer ' + ok.length + ' dosya eklendi.' : '.'), 'err');
    }
    if (!ok.length) return;

    if (slot === 'create') {
      form.files.push(...ok);
      return repaint('create');
    }

    const list = document.querySelector('[data-attach-list="' + slot + '"]');
    if (list) list.insertAdjacentHTML('beforeend', '<span class="attach-chip busy">Yükleniyor…</span>');
    const key = draftKey(slot);
    const job = (async () => {
      try {
        const out = await Api.upload(DETAIL_CODE, ok);
        (Drafts[key] = Drafts[key] || []).push(...out.attachments);
      } catch (err) {
        toast(err.message, 'err');
      }
      repaint(slot);
    })();
    Pending[key] = Promise.all([Pending[key], job]);
    await job;
  });

  /*
   * Yükleme sürerken gönderilen güncelleme dosyasız gidiyor, dosya bir
   * sonraki güncellemeye yapışıyordu. Gönderim önce süren yüklemeleri bekler.
   */
  const Pending = {};
  const uploadsSettled = (slot) => Pending[draftKey(slot)] || Promise.resolve();

  const takeDrafts = (slot) => drafts(slot).map((a) => a.id);
  const clearDrafts = (slot) => { Drafts[draftKey(slot)] = []; repaint(slot); };

  /* ----------------------------------------------- aksiyonlar (override) */

  window.actClaim = function (r) {
    return run(r.code, 'claim', {}, 'Kayıt üzerinize alındı').catch(() => {});
  };

  window.actForward = function (r) {
    const me = Store.me();
    // Kaydın ekip(ler)indeki, kaydı üzerine alabilen kişiler (sunucu da yalnızca
    // bunları kabul eder). Yönlendiren başka ekipten (ör. sistem yöneticisi) olabilir.
    const teams = [r.department, r.department2].filter(Boolean);
    const mates = USERS.filter((u) => teams.includes(u.dept) && u.teamRole && u.id !== me.id);
    // "Yalnızca ilgili ekip görsün" kaydı başka ekibe gönderilemez (sunucu da
    // reddeder); ekip içinde devir serbest (kullanıcı isteği, 2026-10-09).
    const teamPart = r.restricted
      ? '<p class="hint" style="margin:0 0 14px">' + icon('lock', 'ic-sm') +
        ' Bu kayıt yalnızca ilgili ekibe açık; başka bir ekibe yönlendirilemez. Ekip içinde devredebilirsiniz.</p>' +
        '<input type="hidden" id="fwdDept" value="" />'
      : '<div class="field"><label for="fwdDept">Başka bir ekibe gönder</label><select id="fwdDept"><option value="">— seçin —</option>' +
        teamOptions(null, r.department) +
        '</select></div>';
    openModal(
      'Kayıt Yönlendirme',
      teamPart +
        '<div class="field"><label for="fwdMate">' + (r.restricted ? 'Ekip arkadaşına devret' : '— ya da — Ekip arkadaşına devret') +
        '</label><select id="fwdMate"><option value="">— seçin —</option>' +
        mates.map((u) => '<option value="' + u.id + '">' + esc(u.name) + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label for="fwdNote">Yönlendirme notu</label><textarea id="fwdNote" placeholder="Yönlendirme sebebini yazın..."></textarea></div>',
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: 'Yönlendirmeyi Kaydet',
          cls: 'btn-primary',
          run() {
            const d = $('#fwdDept').value;
            const u = $('#fwdMate').value;
            const note = ($('#fwdNote').value || '').trim();
            if (!d && !u) return toast('Bir ekip ya da ekip arkadaşı seçin', 'err');
            if (d && u) return toast('Ekip ya da kişi seçin — ikisi birlikte olmaz', 'err');
            const payload = d ? { departmentId: d } : { assigneeId: u };
            if (note) payload.note = note;
            return run(r.code, 'forward', payload, 'Kayıt yönlendirildi').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actStatus = function (r) {
    // Ek bilgi ayrı düğmeyle istenir (soru zorunlu).
    const ids = r.type === 'oneri' ? ['degerlendiriliyor'] : ['inceleniyor', 'calisiliyor'];
    const opts = STATUSES.filter((s) => ids.includes(s.id));
    openModal(
      'Durum Güncelle',
      '<div class="field"><label for="stSel">Yeni durum</label><select id="stSel">' +
        opts
          .map((s) => '<option value="' + s.id + '"' + (r.status === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>')
          .join('') +
        '</select></div><div class="field"><label for="stNote">Not (isteğe bağlı)</label>' +
        '<textarea id="stNote" placeholder="Kısa açıklama..."></textarea></div>',
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: 'Durumu Güncelle',
          cls: 'btn-primary',
          run() {
            const payload = { status: $('#stSel').value };
            const note = ($('#stNote').value || '').trim();
            if (note) payload.note = note;
            return run(r.code, 'status', payload, 'Durum güncellendi').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actInfoRequest = function (r) {
    openModal(
      'Ek Bilgi İste',
      '<div class="field"><label for="infoQ">Kaydı açan kişiye sorunuz</label>' +
        '<textarea id="infoQ" maxlength="1000" placeholder="Neyi öğrenmeniz gerekiyor? Bu metin kaydı açan kişiye görünür."></textarea>' +
        '<p class="hint" style="margin-top:8px">Kayıt “Ek Bilgi Bekleniyor” olur. Yanıt gelince kayıt kaldığı duruma döner ve size bildirim gelir.</p></div>',
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: 'Soruyu Gönder',
          cls: 'btn-primary',
          run() {
            const q = ($('#infoQ').value || '').trim();
            if (q.length < 5) return toast('Sorunuzu en az 5 karakterle yazın', 'err');
            return run(r.code, 'info-request', { question: q }, 'Ek bilgi istendi').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actResolve = function (r) {
    const oneri = r.type === 'oneri';
    openModal(
      oneri ? 'Öneriyi Sonuçlandır' : 'Çözüldü olarak işaretle',
      (oneri
        ? '<div class="field"><label for="resTxt">Değerlendirme sonucu</label>' +
          '<textarea id="resTxt" placeholder="Öneri hayata geçirilecek mi? Karar, gerekçesi ve varsa sonraki adımlar..."></textarea>' +
          '<p class="hint" style="margin-top:8px">Sonuç öneri sahibine bildirilir; uygun bulursa öneriyi kapatır.</p></div>'
        : '<div class="field"><label for="resTxt">Çözüm açıklaması</label>' +
          '<textarea id="resTxt" placeholder="Sorunu/talebi nasıl çözdüğünüzü anlatın..."></textarea>' +
          '<p class="hint" style="margin-top:8px">Bu açıklama, gelecekteki benzer kayıtlarda Akıllı Çözüm Asistanı tarafından önerilecektir.</p></div>') +
        window.attachPicker('resolve') +
        // Kısıtlı kayıt öneri havuzuna giremez (sunucu da yok sayar): kutu gösterilmez.
        (oneri || r.restricted ? '' :
          '<label class="learn-toggle"><input type="checkbox" id="resLearn" />' +
          '<div><b>Benzer kayıtlarda öner</b><span>Bu çözüm, benzer bir talep açılırken onaylı çözüm olarak gösterilir; ' +
          'doğru ekibi önerme de bu kayıttan öğrenir.</span></div></label>'),
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: oneri ? 'Sonuçlandır' : 'Çözüldü olarak işaretle',
          cls: 'btn-success',
          run() {
            const t = ($('#resTxt').value || '').trim();
            if (t.length < 10) return toast((oneri ? 'Değerlendirme sonucu' : 'Çözüm açıklaması') + ' en az 10 karakter olmalı', 'err');
            const learnBox = $('#resLearn');
            return uploadsSettled('resolve').then(() =>
              run(r.code, 'resolve', { resolution: t, attachmentIds: takeDrafts('resolve'), learn: !!(learnBox && learnBox.checked) },
                oneri ? 'Öneri sonuçlandırıldı' : 'Kayıt çözüldü olarak işaretlendi'))
              .then(() => { clearDrafts('resolve'); closeModal(); }, () => {});
          },
        },
      ],
    );
  };

  /*
   * Öneri değerlendirmesi: değerlendiren sonucu seçer. Üçü de son durumdur;
   * öneri sahibine bildirim gider.
   */
  window.actEvaluate = function (r) {
    const opt = (id, title, desc, checked) =>
      '<label class="outcome"><input type="radio" name="evOutcome" value="' + id + '"' + (checked ? ' checked' : '') + ' />' +
      '<div><b>' + title + '</b><span>' + desc + '</span></div></label>';
    openModal(
      'Değerlendirmeyi Bitir',
      '<fieldset class="outcome-set"><legend>Sonuç</legend>' +
        opt('fayda_sagladi', 'Fayda Sağladı', 'Öneri uygulamaya alındı ya da alınacak; beklenen fayda görüldü.', false) +
        opt('degerlendirildi', 'Değerlendirildi', 'Öneri incelendi; şimdilik uygulamaya alınmıyor ama kayıt altında.', true) +
        opt('uygun_bulunmadi', 'Uygun Bulunmadı', 'Öneri bu hâliyle uygulanabilir değil; gerekçeyi yazın.', false) +
      '</fieldset>' +
      '<div class="field"><label for="evNote">Değerlendirme notu</label>' +
        '<textarea id="evNote" placeholder="Karar, gerekçesi ve varsa sonraki adımlar. Bu not öneri sahibine görünür; teşekkür etmeyi unutmayın."></textarea></div>' +
      window.attachPicker('resolve'),
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: 'Değerlendirmeyi Bitir',
          cls: 'btn-success',
          run() {
            const sel = document.querySelector('input[name="evOutcome"]:checked');
            const t = ($('#evNote').value || '').trim();
            if (!sel) return toast('Bir sonuç seçin', 'err');
            if (t.length < 10) return toast('Değerlendirme notunu en az 10 karakter yazın', 'err');
            const label = sel.closest('.outcome').querySelector('b').textContent;
            return uploadsSettled('resolve').then(() =>
              run(r.code, 'evaluate', { outcome: sel.value, note: t, attachmentIds: takeDrafts('resolve') },
                'Değerlendirme tamamlandı: ' + label))
              .then(() => { clearDrafts('resolve'); closeModal(); }, () => {});
          },
        },
      ],
    );
  };

  /** Detaydaki "Yenilenen kayıt" kutucuğu. */
  window.actLearn = function (r, on) {
    run(r.code, 'learn', { on: !!on },
      on ? 'Çözüm benzer kayıtlarda önerilecek' : 'Çözüm artık önerilmeyecek')
      .catch(() => { if (typeof renderDetail === 'function') renderDetail(); });
  };

  window.actReject = function (r) {
    const oneri = r.type === 'oneri';
    openModal(
      oneri ? 'Öneriyi Reddet' : 'Kaydı Reddet',
      // Ret kalıcıdır; yanlış ekibe gelen kayıt için doğru yol yönlendirmek.
      (oneri
        ? '<p class="hint" style="margin:0 0 12px">Reddedilen öneri yeniden açılamaz; gerekçesiyle öneri sahibine bildirilir. ' +
          'Öneri başka bir ekibin konusuysa reddetmek yerine <b>Kaydı Yönlendir</b>’i kullanın.</p>' +
          '<div class="field"><label for="rejTxt">Gerekçe</label><textarea id="rejTxt" placeholder="Öneri neden şu an uygulanamıyor? Bu metin öneri sahibine görünür."></textarea></div>'
        : '<p class="hint" style="margin:0 0 12px">Reddedilen kayıt yeniden açılamaz ve kaydı açan kişiye bildirilir. ' +
          'Kayıt yanlış ekibe geldiyse reddetmek yerine <b>Kaydı Yönlendir</b>\'i kullanın.</p>' +
          '<div class="field"><label for="rejTxt">Ret sebebi</label><textarea id="rejTxt" placeholder="Neden reddediyorsunuz? Bu metin kaydı açan kişiye görünür."></textarea></div>'),
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: 'Reddet',
          cls: 'btn-danger',
          run() {
            const t = ($('#rejTxt').value || '').trim();
            if (t.length < 10) return toast((oneri ? 'Gerekçeyi' : 'Ret sebebini') + ' en az 10 karakter yazın', 'err');
            return run(r.code, 'reject', { reason: t }, oneri ? 'Öneri reddedildi' : 'Kayıt reddedildi').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actReopen = function (r) {
    const oneri = r.type === 'oneri';
    openModal(
      oneri ? 'Yeniden Değerlendirilsin' : 'Çözüm İşe Yaramadı',
      (oneri
        ? '<p class="hint" style="margin:0 0 12px">Öneri yeniden değerlendirmeye alınır ve değerlendirene bildirim gider. ' +
          'Sonucun hangi noktada eksik kaldığını yazın.</p>' +
          '<div class="field"><label for="reoTxt">Neden</label><textarea id="reoTxt" placeholder="Ör. Maliyet hesabı eski fiyatlarla yapılmış."></textarea></div>'
        : '<p class="hint" style="margin:0 0 12px">Kayıt yeniden çalışmaya alınır ve sahibine bildirim gider. ' +
          'Neyin eksik kaldığını yazın ki ekip doğru noktadan devam etsin.</p>' +
          '<div class="field"><label for="reoTxt">Neden</label><textarea id="reoTxt" placeholder="Ör. Fark ekim bordrosunda da ödenmedi."></textarea></div>'),
      [
        { label: 'Vazgeç', cls: 'btn-ghost' },
        {
          label: oneri ? 'Yeniden Değerlendirmeye Gönder' : 'Yeniden Aç',
          cls: 'btn-primary',
          run() {
            const t = ($('#reoTxt').value || '').trim();
            if (t.length < 10) return toast('Nedeni en az 10 karakterle yazın', 'err');
            return run(r.code, 'reopen', { reason: t }, oneri ? 'Öneri yeniden değerlendirmeye gönderildi' : 'Kayıt yeniden açıldı').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actClose = function (r) {
    const oneri = r.type === 'oneri';
    openModal(oneri ? 'Öneriyi Kapat' : 'Kaydı Kapat',
      '<p class="hint">' + (oneri
        ? 'Değerlendirme sonucunu uygun bulduysanız öneriyi kapatın. Kapatılan kayıt yeniden açılamaz.'
        : 'Çözüm işinizi gördüyse kaydı kapatın. Kapatılan kayıt yeniden açılamaz.') + '</p>', [
      { label: 'Vazgeç', cls: 'btn-ghost' },
      {
        label: oneri ? 'Öneriyi Kapat' : 'Kaydı Kapat',
        cls: 'btn-primary',
        run() {
          return run(r.code, 'close', {}, oneri ? 'Öneri kapatıldı' : 'Kayıt kapatıldı').then(closeModal, () => {});
        },
      },
    ]);
  };

  window.actComment = async function (r) {
    const el = $('#cmtInput');
    const t = ((el && el.value) || '').trim();
    await uploadsSettled('comment');
    const ids = takeDrafts('comment');
    if (!t && !ids.length) return toast('Bir güncelleme yazın ya da dosya ekleyin', 'err');
    try {
      await run(r.code, 'comments', { text: t, attachmentIds: ids }, el && el.dataset.answer ? 'Yanıt gönderildi' : 'Güncelleme eklendi');
    } catch (_) {
      return; // metin kutuda ve taslakta kalır
    }
    clearDrafts('comment');
    if (typeof CommentDrafts !== 'undefined') delete CommentDrafts[r.code];
    const box = $('#cmtInput');
    if (box) box.value = '';
  };

  /* -------------------------------------------------- yeni kayıt + ML */

  // Sunucudan gelen son eşleşmeler. runMl bunları doldurur, findSimilar okur.
  let similarCache = null;
  // Sunucudan gelen ekip önerisi: { lowConfidence, candidates:[{id,name,percent,terms}] }
  let deptCache = null;

  /** index.html'deki renderDeptSuggestion bunu okur. */
  window.mlDepartmentSuggestion = function () {
    return deptCache;
  };

  const origRunMl = window.runMl;
  /*
   * Tarama yazarken kendiliğinden çalışır (index.html → scheduleScan) ve
   * kaydı açmayı engellemez. Sunucu yanıt veremezse kişi yine kayıt açabilir;
   * panelde "Tekrar dene" kalır, her otomatik denemede hata bildirimi çıkmaz.
   */
  const scanThenRender = async function (opts) {
    const f = typeof form !== 'undefined' ? form : null;
    if (f && f.type !== 'bilgi') return origRunMl.call(this, opts);
    const title = ($('#fTitle').value || '').trim();
    const desc = ($('#fDesc').value || '').trim();

    if (title.length >= 5 && desc.length >= 10) {
      $('#mlStatus').innerHTML = '<div class="ml-loading"><div class="spin"></div>Benzer çözümler aranıyor…</div>';
      try {
        // Departman ve tür sunucudaki skorlamada bonus veriyor (bkz.
        // src/domain/similarity.ts), bu yüzden formdaki seçimler birlikte gönderilir.
        const call = Api.similar({
          title,
          description: desc,
          department: ($('#fDept1') && $('#fDept1').value) || null,
          // `form` prototipte `let` ile tanımlı: klasik betikte global
          // SÖZCÜKSEL kapsamda durur, window üzerinde DEĞİL. `window.form`
          // yazmak undefined döndürüyordu ve tür bonusu (+5) hiç gitmiyordu.
          type: f ? f.type || null : null,
          // İşaretliyse sunucu taramayı ML veritabanına hiç yazmaz.
          restricted: !!($('#fRestricted') && $('#fRestricted').checked),
          helpSessionId: await IhHelp.sessionFor(),
        });
        IhHelp.track(call);
        // Kayıt, süren tarama bitmeden gönderilmesin (createRecord bekler).
        if (f) f.scanBusy = call.catch(() => {});
        const out = await call;
        // Yanıt gelene dek form sıfırlandıysa (kayıt açıldı, "işime yaradı")
        // eski sonuç boş forma çizilmesin.
        if (f !== form) return;
        if (out.helpSessionId) {
          IhHelp.session.set(out.helpSessionId);
          // Taslak uzun aradan sonra yeni oturum açtıysa o da kayda toplanır.
          if (f) (f.helpSessionIds = f.helpSessionIds || []).push(out.helpSessionId);
        }
        // Prototipin beklediği şekle çevir: { record, percent, keywords }
        similarCache = out.matches.map((m) => ({
          record: {
            code: m.code,
            type: m.type,
            title: m.title,
            description: m.description,
            resolution: m.resolution,
            resolvedAt: m.resolvedAt || null,
            department: m.departmentId,
            verified: !!m.verified,
            source: m.source || 'kayit',
            url: m.url || null,
          },
          percent: m.percent,
          keywords: m.terms,
          resultId: m.resultId || null,
        }));
        deptCache = out.department || null;
        // Kayıt açılırsa sonucu ML veritabanındaki bu çalıştırmaya bağlamak için.
        f.mlInferenceId = out.inferenceId || null;
        // Kayıt kısıtlı ya da anonim açılırsa önceki taramalar da temizlensin.
        if (out.inferenceId) (f.mlInferenceIds = f.mlInferenceIds || []).push(out.inferenceId);
        f.deptApplied = false;
      } catch (err) {
        if (f !== form) return;
        // Hata "benzer kayıt bulunamadı" gibi sunulmasın; ama kayıt açmak da
        // engellenmesin. Yazılanlar olduğu gibi kalır.
        similarCache = null;
        deptCache = null;
        f.mlDone = false;
        f.sig = null;
        $('#mlResults').innerHTML = ''; $('#mlDept').innerHTML = '';
        $('#mlStatus').innerHTML = '<b>Benzer çözümler şu an getirilemedi.</b> Kaydı yine de oluşturabilirsiniz. ' +
          '<button type="button" class="mini-btn" id="mlRetry">Tekrar dene</button>';
        $('#mlRetry').onclick = () => window.runMl();
        if (typeof syncCreateBtn === 'function') syncCreateBtn();
        return;
      }
    }
    // Geri kalan her şeyi prototipin kendi akışı çizer.
    return origRunMl.call(this, opts);
  };

  window.runMl = async function (opts) {
    const f = form;
    // Tarama sürerken yeni bir istek gelirse kaybolmasın: bitince bir kez daha.
    if (f.mlBusy) { f.scanAgain = true; return; }
    f.mlBusy = true;
    try {
      return await scanThenRender.call(this, opts);
    } finally {
      f.mlBusy = false;
      if (f === form && f.scanAgain) {
        f.scanAgain = false;
        if (typeof scheduleScan === 'function') scheduleScan();
      }
    }
  };

  window.findSimilar = function (_query, _records, topN) {
    // Yerel tarama yapmıyoruz: eşleşme adayları arasında kullanıcının görmeye
    // yetkili olmadığı kayıtlar var, tarama sunucuda kalmalı.
    return similarCache ? similarCache.slice(0, topN || 3) : [];
  };

  /*
   * Yeni kayıt. Bilgi ve öneri farklı alanlar gönderir (bkz. routes/records.ts).
   * Formda seçilen dosyalar kayıt oluştuktan sonra yüklenir ve "kayıt
   * oluşturuldu" adımına bağlanır; yükleme başarısız olursa kayıt yine
   * oluşmuştur, kullanıcıya dosyaları güncelleme olarak eklemesi söylenir.
   */
  window.createRecord = async function () {
    if (form.busy) return;
    const isOneri = form.type === 'oneri';
    const title = ($('#fTitle').value || '').trim();
    const d1 = $('#fDept1').value;
    let payload;

    if (!form.type) return toast('Kayıt türünü seçin', 'err');
    if (isOneri) {
      const miss = oneriMissing();
      if (miss) return toast(miss, 'err');
      const o = oneriData();
      payload = {
        type: 'oneri',
        title,
        current: o.current,
        proposal: o.proposal,
        benefits: o.benefits,
        benefitNote: o.benefitNote || undefined,
        department: d1,
        anonymous: !!form.anon,
        restricted: !!($('#fRestricted') && $('#fRestricted').checked),
      };
    } else {
      const desc = ($('#fDesc').value || '').trim();
      const d2 = $('#fDept2').value;
      if (!title || !desc) return toast('Başlık ve açıklama gereklidir', 'err');
      if (!d1) return toast('İlgili ekibi seçin', 'err');
      if (d2 && d2 === d1) return toast('İkinci ekip birinciyle aynı olamaz', 'err');
      payload = {
        type: form.type,
        title,
        description: desc,
        department: d1,
        department2: d2 || null,
        priority: $('#fPrio').value || 'normal',
        anonymous: !!form.anon,
        restricted: !!($('#fRestricted') && $('#fRestricted').checked),
        mlInferenceId: form.mlInferenceId || null,
        mlInferenceIds: form.mlInferenceIds || [],
        deptSuggestionApplied: !!form.deptApplied,
      };
    }

    const files = (form.files || []).slice();
    const btn = $('#createBtn');
    form.busy = true;
    syncCreateBtn();
    btn.textContent = isOneri ? 'Gönderiliyor…' : 'Oluşturuluyor…';
    // Süren tarama bitmeden gönderilmesin: oturumu ve ML çalıştırması bu kayda
    // bağlanmaz, anonim/kısıtlı gizlemesi de ona uygulanmazdı.
    if (form.scanBusy) {
      await form.scanBusy;
      if (!isOneri) Object.assign(payload, { mlInferenceId: form.mlInferenceId || null, mlInferenceIds: form.mlInferenceIds || [] });
    }
    payload.helpSessionId = IhHelp.session.get();
    payload.helpSessionIds = form.helpSessionIds || [];
    try {
      let rec = (await Api.create(payload)).record;
      IhHelp.session.set(null);   // kayıt açıldı: sonraki yardım yeni oturum
      let fileErr = null;
      if (files.length) {
        try {
          await Api.upload(rec.code, files, { bind: 'create' });
          rec = (await Api.record(rec.code)).record;
        } catch (err) {
          fileErr = err;
        }
      }

      upsertLocal(rec);
      form.busy = false;
      if (typeof resetForm === 'function') resetForm();
      if (fileErr) {
        toast((isOneri ? 'Öneri iletildi (' : 'Kayıt oluşturuldu (') + rec.code + ') ama dosyalar yüklenemedi: ' +
          fileErr.message + ' Dosyaları kayda güncelleme olarak ekleyebilirsiniz.', 'err');
      } else {
        toast((isOneri ? 'Öneriniz iletildi: ' : 'Kayıt oluşturuldu: ') + rec.code, 'ok');
      }
      if (typeof show === 'function') show('detail', rec.code);
      if (typeof renderChrome === 'function') renderChrome();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      form.busy = false;
      btn.textContent = form.type === 'oneri' ? 'Öneriyi Gönder' : 'Kaydı Oluştur';
      syncCreateBtn();
    }
  };

  /* ----------------------------------------------------------- CSV */

  window.exportCsv = function () {
    // Aktarım sunucuda yapılır: yetki kontrolü ve denetim izi orada.
    // Raporlar ekranında departman/ekip seçiliyse CSV de yalnızca onların kayıtları.
    const dept = typeof repDept !== 'undefined' ? repDept : '';
    const team = typeof repTeam !== 'undefined' ? repTeam : '';
    window.location.href = '/api/reports/export.csv' + repQuery(dept, team);
  };

  /* ------------------------------------------------------------ açılış */

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const boot = await Api.bootstrap();

      // Sabit dizileri yerinde doldur — prototip bunları const olarak tutuyor.
      const fill = (arr, items) => {
        arr.length = 0;
        items.forEach((x) => arr.push(x));
      };
      fill(DEPARTMENTS, boot.departments);
      fill(USERS, boot.users);
      fill(TYPES, boot.types);
      fill(PRIORITIES, boot.priorities);
      fill(STATUSES, boot.statuses);

      if (boot.uploads) Object.assign(Uploads, boot.uploads);
      if (Array.isArray(boot.benefits) && boot.benefits.length) fill(BENEFITS, boot.benefits);

      // Kuruluş adı (.env → ORG_NAME): sekme başlığı ve kenar çubuğunda logonun altı.
      if (boot.org && boot.org.name) {
        APP_TITLE = 'İç Hatlar — ' + boot.org.name;
        $('#orgName').textContent = boot.org.name;
      }

      // Rol: yönetim menüsü yalnızca yönetici ve sistem yöneticisine. Yetki
      // kararı yine sunucuda; bu yalnızca anlamsız menüyü gizler.
      const isManager = boot.me.role === 'MANAGER' || boot.me.role === 'ADMIN';
      document.querySelectorAll('[data-role-min="manager"]').forEach((el) => { el.hidden = !isManager; });
      document.body.dataset.role = boot.me.role;
      // Kurulum ve yapılandırma notları yalnızca sistem yöneticisine.
      document.querySelectorAll('[data-admin-only]').forEach((el) => { el.hidden = boot.me.role !== 'ADMIN'; });
      window.IH_KB = boot.kb || { view: false, admin: false, edit: [] };
      document.querySelectorAll('[data-kb-gate]').forEach((el) => { el.hidden = !window.IH_KB.view; });

      Store.data.currentUserId = boot.me.id;

      // Oturum sahibi kullanıcı listesinde yoksa (departmansız yeni kullanıcı)
      // Store.me() null döner ve arayüz patlar; kendini ekle.
      if (!USERS.some((u) => u.id === boot.me.id)) {
        USERS.push({
          id: boot.me.id,
          name: boot.me.name,
          dept: boot.me.dept,
          role: boot.me.role === 'MANAGER' ? 'Yönetici' : 'Ekip Üyesi',
        });
      }

      await refreshRecords();

      // init() boş veriyle çalışmış olabilir: veriye bağlı alanları tazele.
      rewireAfterBoot(boot);

      if (typeof renderChrome === 'function') renderChrome();
      // Adres çubuğundaki ekran açılır (#/kayit/KAY-…, #/raporlar); yoksa ana
      // sayfa: ekip üyesi ve yöneticiye Genel Bakış, çalışana Açtıklarım.
      if (boot.me.role === 'USER') HOME_VIEW = 'my-tickets';
      if (typeof show === 'function') {
        const r = typeof parseRoute === 'function' ? parseRoute(location.hash) : null;
        // Tanınmayan eski adres (ör. kaldırılan #/sik-sorulanlar) açılan ekranınkiyle değişir.
        show(r ? r.id : HOME_VIEW, r && r.param, r || !location.hash ? { history:false } : { replace:true });
      }

      // Açılış sırası kaynaklı hata bandını temizle: veri geldiğine göre
      // gerçek bir arıza değildi. Bundan sonraki hatalar görünür kalır.
      const stale = document.getElementById('fatalErr');
      if (stale) stale.remove();

      hideVeil();
    } catch (err) {
      console.error(err);
      veilError(err.message || 'Sunucuya ulaşılamadı.');
    }
  });

  /**
   * init() içinde veriye bağlı olarak doldurulan alanlar burada yeniden
   * kurulur (kullanıcı seçici, ekip ve öncelik listeleri). Prototipin
   * init'ini ikinci kez çağırmıyoruz — olay dinleyicilerini ikiye katlardı.
   */
  function rewireAfterBoot(boot) {
    if (typeof renderBenefitChips === 'function') renderBenefitChips();
    const fa = $('#fAttach');
    if (fa) fa.innerHTML = window.attachPicker('create');

    // Departman → Ekip seçimleri index.html'deki ortak yardımcıyla (fillDeptSelects).
    const prio = $('#fPrio');
    if ($('#fRoot1') && typeof fillDeptSelects === 'function') fillDeptSelects();
    if (prio) {
      prio.innerHTML = PRIORITIES.map(
        (p) => '<option value="' + p.id + '"' + (p.id === 'normal' ? ' selected' : '') + '>' +
          p.label + '</option>',
      ).join('');
    }

    // Hesap satırındaki tek düğme: çıkış. Test ortamında (geliştirme girişi)
    // aynı çıkış "Kişi değiştir" olur: /auth/login giriş sayfasındaki kişi
    // listesine döner. Canlıda kişi seçiciden iz kalmaz.
    const act = $('#acctAct');
    if (act) {
      if (boot.devAuth) {
        act.title = 'Kişi değiştir';
        act.setAttribute('aria-label', 'Kişi değiştir');
        act.innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/></svg>';
      }
      act.onclick = async () => {
        await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
        location.href = '/auth/login';
      };
    }

    // Demo verisini sıfırlama düğmesi üretimde olmamalı.
    const reset = $('#resetBtn');
    if (reset) reset.remove();
  }

  // Konsoldan erişim — hata ayıklama kolaylığı.
  window.IhApi = Api;
  window.IhRefresh = refreshRecords;
})();
