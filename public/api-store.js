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

    if (res.status === 401) {
      // Oturum düştü — girişe gönder, kullanıcı boş ekranla kalmasın.
      location.href = '/auth/login?returnTo=' + encodeURIComponent(location.pathname);
      throw new Error('oturum yok');
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || 'İstek başarısız oldu.';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

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

  // Prototipin "geçici mod" uyarısı artık gereksiz: veri sunucuda.
  try { safeStore.persistent = true; } catch (e) { /* yok sayılabilir */ }

  function upsertLocal(rec) {
    const i = Store.data.records.findIndex((r) => r.code === rec.code);
    if (i >= 0) Store.data.records[i] = rec;
    else Store.data.records.unshift(rec);
    return rec;
  }

  Store.load = function () { /* veri sunucudan gelir; senkron yükleme yok */ };
  Store.save = function () { /* yazma işlemleri API üzerinden yapılır */ };
  Store.reset = function () {
    toast('Demo verisi sıfırlama yalnızca geliştirme ortamında yapılır.', 'err');
  };

  Store.me = function () {
    return USERS.find((u) => u.id === Store.data.currentUserId) || null;
  };

  Store.setMe = function () {
    // Gerçek sistemde kullanıcı değiştirilemez; kimlik Entra oturumundan gelir.
    toast('Kullanıcı değiştirme kapalı — oturum kurumsal hesabınıza bağlı.', 'err');
  };

  Store.find = function (code) {
    return Store.data.records.find((r) => r.code === code);
  };

  Store.nextCode = function () {
    // Numara sunucuda atomik olarak üretilir; istemci tahmin etmez.
    return '(sunucu atayacak)';
  };

  /* --------------------------------------------------------- yenileme */

  // Sunucu bir istekte en fazla 200 kayıt döner. Eskiden yalnızca ilk sayfa
  // alınıyordu: 300 kaydı görebilen yönetici 200 görüyordu. Artık toplam
  // sayıya ulaşana kadar sayfa sayfa çekilir.
  const PAGE_SIZE = 200;

  async function refreshRecords() {
    const first = await Api.records({ scope: 'all', pageSize: PAGE_SIZE, page: 1 });
    const all = first.records.slice();
    for (let page = 2; all.length < first.total; page++) {
      const next = await Api.records({ scope: 'all', pageSize: PAGE_SIZE, page });
      if (!next.records.length) break; // arada kayıt silindiyse sonsuz döngüye girme
      all.push(...next.records);
    }
    // Sayfalar arasında bir kayıt güncellenirse sıralaması kayar ve iki sayfada
    // birden gelebilir; kayıt numarasına göre tekilleştir.
    const unique = [...new Map(all.map((r) => [r.code, r])).values()];
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
    if (document.hidden || Date.now() - lastRefresh < 15000) return;
    if (!$('#modalRoot').hidden) return;
    lastRefresh = Date.now();
    try {
      if (CURRENT === 'detail') return refreshDetail(DETAIL_CODE);
      if (CURRENT === 'new-ticket') return;
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

  /** Aksiyon sarmalayıcı — hata mesajını sunucudan gelen metinle gösterir. */
  async function run(code, action, payload, okMessage) {
    try {
      const out = await Api.act(code, action, payload);
      applyAndRender(out.record);
      if (okMessage) toast(okMessage, 'ok');
      return out.record;
    } catch (err) {
      toast(err.message, 'err');
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
    try {
      const out = await Api.upload(DETAIL_CODE, ok);
      drafts(slot).push(...out.attachments);
    } catch (err) {
      toast(err.message, 'err');
    }
    repaint(slot);
  });

  const takeDrafts = (slot) => drafts(slot).map((a) => a.id);
  const clearDrafts = (slot) => { Drafts[draftKey(slot)] = []; repaint(slot); };

  /* ----------------------------------------------- aksiyonlar (override) */

  window.actClaim = function (r) {
    run(r.code, 'claim', {}, 'Kayıt üzerinize alındı');
  };

  window.actForward = function (r) {
    const me = Store.me();
    const mates = USERS.filter((u) => u.dept === me.dept && u.id !== me.id);
    openModal(
      'Kayıt Yönlendirme',
      '<div class="field"><label for="fwdDept">Başka bir ekibe gönder</label><select id="fwdDept"><option value="">— seçin —</option>' +
        DEPARTMENTS.filter((d) => d.id !== r.department)
          .map((d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>')
          .join('') +
        '</select></div>' +
        '<div class="field"><label for="fwdMate">— ya da — Ekip arkadaşına devret</label><select id="fwdMate"><option value="">— seçin —</option>' +
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
            run(r.code, 'forward', payload, 'Kayıt yönlendirildi').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actStatus = function (r) {
    const opts = STATUSES.filter((s) => ['inceleniyor', 'calisiliyor', 'ek_bilgi'].includes(s.id));
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
            run(r.code, 'status', payload, 'Durum güncellendi').then(closeModal, () => {});
          },
        },
      ],
    );
  };

  window.actResolve = function (r) {
    const oneri = r.type === 'oneri';
    openModal(
      oneri ? 'Öneriyi Sonuçlandır' : 'Kaydı Çözüldü Yap',
      (oneri
        ? '<div class="field"><label for="resTxt">Değerlendirme sonucu</label>' +
          '<textarea id="resTxt" placeholder="Öneri hayata geçirilecek mi? Karar, gerekçesi ve varsa sonraki adımlar..."></textarea>' +
          '<p class="hint" style="margin-top:8px">Sonuç öneri sahibine bildirilir; uygun bulursa öneriyi kapatır.</p></div>'
        : '<div class="field"><label for="resTxt">Çözüm açıklaması</label>' +
          '<textarea id="resTxt" placeholder="Sorunu/talebi nasıl çözdüğünüzü anlatın..."></textarea>' +
          '<p class="hint" style="margin-top:8px">Bu açıklama, gelecekteki benzer kayıtlarda Akıllı Çözüm Asistanı tarafından önerilecektir.</p></div>') +
        window.attachPicker('resolve'),
      [
        { label: 'İptal', cls: 'btn-ghost' },
        {
          label: oneri ? 'Sonuçlandır' : 'Çözüldü Olarak İşaretle',
          cls: 'btn-success',
          run() {
            const t = ($('#resTxt').value || '').trim();
            if (t.length < 10) return toast((oneri ? 'Değerlendirme sonucu' : 'Çözüm açıklaması') + ' en az 10 karakter olmalı', 'err');
            run(r.code, 'resolve', { resolution: t, attachmentIds: takeDrafts('resolve') },
              oneri ? 'Öneri sonuçlandırıldı' : 'Kayıt çözüldü olarak işaretlendi')
              .then(() => { clearDrafts('resolve'); closeModal(); }, () => {});
          },
        },
      ],
    );
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
            run(r.code, 'reject', { reason: t }, oneri ? 'Öneri reddedildi' : 'Kayıt reddedildi').then(closeModal, () => {});
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
            run(r.code, 'reopen', { reason: t }, oneri ? 'Öneri yeniden değerlendirmeye gönderildi' : 'Kayıt yeniden açıldı').then(closeModal, () => {});
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
          run(r.code, 'close', {}, oneri ? 'Öneri kapatıldı' : 'Kayıt kapatıldı').then(closeModal, () => {});
        },
      },
    ]);
  };

  window.actComment = function (r) {
    const el = $('#cmtInput');
    const t = ((el && el.value) || '').trim();
    const ids = takeDrafts('comment');
    if (!t && !ids.length) return toast('Bir güncelleme yazın ya da dosya ekleyin', 'err');
    run(r.code, 'comments', { text: t, attachmentIds: ids }, 'Güncelleme eklendi').then(() => {
      clearDrafts('comment');
      const box = $('#cmtInput');
      if (box) box.value = '';
    }, () => {});
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
  const scanThenRender = async function () {
    if (typeof form !== 'undefined' && form && form.type !== 'bilgi') return origRunMl.apply(this, arguments);
    const title = ($('#fTitle').value || '').trim();
    const desc = ($('#fDesc').value || '').trim();

    if (title.length >= 5 && desc.length >= 10) {
      try {
        // Departman ve tür skorlamada bonus veriyor (prototipteki mlScore ile
        // aynı), bu yüzden formdaki seçimler birlikte gönderilir.
        const out = await Api.similar({
          title,
          description: desc,
          department: ($('#fDept1') && $('#fDept1').value) || null,
          // `form` prototipte `let` ile tanımlı: klasik betikte global
          // SÖZCÜKSEL kapsamda durur, window üzerinde DEĞİL. `window.form`
          // yazmak undefined döndürüyordu ve tür bonusu (+5) hiç gitmiyordu.
          type: typeof form !== 'undefined' && form ? form.type || null : null,
        });
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
          },
          percent: m.percent,
          keywords: m.terms,
        }));
        deptCache = out.department || null;
        // Kayıt açılırsa sonucu ML veritabanındaki bu çalıştırmaya bağlamak için.
        if (typeof form !== 'undefined' && form) {
          form.mlInferenceId = out.inferenceId || null;
          form.deptApplied = false;
        }
      } catch (err) {
        // Hata "benzer kayıt bulunamadı" gibi sunulmasın: kontrol tamamlanmış
        // sayılmaz, form korunur, kullanıcı tekrar dener.
        similarCache = null;
        deptCache = null;
        if (typeof form !== 'undefined' && form) { form.mlDone = false; form.mlOk = false; }
        $('#mlResults').innerHTML = ''; $('#mlConfirm').innerHTML = ''; $('#mlDept').innerHTML = '';
        $('#mlStatus').innerHTML = '<b>Benzer kayıt taraması yapılamadı.</b> Bağlantınızı kontrol edip ' +
          '<b>ML ile Kontrol Et</b>’e yeniden basın. Yazdıklarınız korunuyor.';
        if (typeof syncCreateBtn === 'function') syncCreateBtn();
        toast('Benzer kayıt taraması yapılamadı: ' + err.message, 'err');
        return;
      }
    }
    // Geri kalan her şeyi prototipin kendi akışı çizer.
    return origRunMl.apply(this, arguments);
  };

  window.runMl = async function () {
    if (form.mlBusy) return;
    const f = form;
    const btn = $('#mlBtn');
    f.mlBusy = true;
    if (btn) btn.disabled = true;
    try {
      return await scanThenRender.apply(this, arguments);
    } finally {
      // Prototip sonucu 700 ms gecikmeyle çiziyor; kilit o bitince açılır.
      setTimeout(() => { f.mlBusy = false; if (btn) btn.disabled = false; }, 750);
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
        shownSuggestions: (form.matches || []).map((m) => ({
          code: m.record.code,
          score: m.percent / 100,
        })),
        mlInferenceId: form.mlInferenceId || null,
        deptSuggestionApplied: !!form.deptApplied,
      };
    }

    const files = (form.files || []).slice();
    const btn = $('#createBtn');
    form.busy = true;
    syncCreateBtn();
    btn.textContent = isOneri ? 'Gönderiliyor…' : 'Oluşturuluyor…';
    try {
      let rec = (await Api.create(payload)).record;
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
    // Raporlar ekranında ekip seçiliyse CSV de yalnızca o ekibin kayıtları.
    const dept = typeof repDept !== 'undefined' ? repDept : '';
    window.location.href = '/api/reports/export.csv' + (dept ? '?department=' + encodeURIComponent(dept) : '');
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

      // Kuruluş adı (.env → ORG_NAME): sekme başlığı ve kenar çubuğu alt bilgisi.
      if (boot.org && boot.org.name) {
        document.title = 'İç Hatlar — ' + boot.org.name;
        const foot = document.querySelector('.side-foot');
        if (foot) foot.textContent = '© ' + new Date().getFullYear() + ' ' + boot.org.name;
      }

      // Rol: yönetim menüsü yalnızca yönetici ve sistem yöneticisine. Yetki
      // kararı yine sunucuda; bu yalnızca anlamsız menüyü gizler.
      const isManager = boot.me.role === 'MANAGER' || boot.me.role === 'ADMIN';
      document.querySelectorAll('[data-role-min="manager"]').forEach((el) => { el.hidden = !isManager; });
      document.body.dataset.role = boot.me.role;

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
      if (typeof show === 'function') show('dashboard');

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

    const deptOpts = (placeholder) =>
      '<option value="">' + placeholder + '</option>' +
      DEPARTMENTS.map((d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('');

    const d1 = $('#fDept1');
    const d2 = $('#fDept2');
    const prio = $('#fPrio');
    if (d1) d1.innerHTML = deptOpts('Seçiniz...');
    if (d2) d2.innerHTML = deptOpts('Seçiniz (isteğe bağlı)');
    if (prio) {
      prio.innerHTML = PRIORITIES.map(
        (p) => '<option value="' + p.id + '"' + (p.id === 'normal' ? ' selected' : '') + '>' +
          p.label + ' — SLA ' + p.sla + ' sa</option>',
      ).join('');
    }

    // Test ortamında (geliştirme girişi) prototipteki kullanıcı seçici kalır;
    // seçim yerel durumu değil, sunucudaki oturumu değiştirir.
    const sw = $('#userSwitch');
    if (sw && boot.devAuth) {
      sw.innerHTML = USERS.map((u) =>
        '<option value="' + u.id + '"' + (u.id === boot.me.id ? ' selected' : '') + '>' +
          esc(u.name) + ' — ' + esc(deptName(u.dept)) + '</option>',
      ).join('');
      sw.onchange = (e) => {
        location.href = '/auth/dev-login?userId=' + encodeURIComponent(e.target.value) + '&returnTo=/';
      };
    } else if (sw) {
      // Gerçek girişte seçici anlamsız: yerine oturum sahibi ve çıkış.
      const wrap = sw.parentElement;
      sw.remove();
      const out = document.createElement('button');
      out.className = 'chrome-btn';
      out.textContent = 'Çıkış yap';
      out.onclick = async () => {
        await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
        location.href = '/auth/login';
      };
      wrap.appendChild(out);
      const lbl = wrap.querySelector('.switch-lbl');
      if (lbl) lbl.textContent = boot.me.email;
    }

    // Demo verisini sıfırlama düğmesi üretimde olmamalı.
    const reset = $('#resetBtn');
    if (reset) reset.remove();
  }

  // Konsoldan erişim — hata ayıklama kolaylığı.
  window.IhApi = Api;
  window.IhRefresh = refreshRecords;
})();
