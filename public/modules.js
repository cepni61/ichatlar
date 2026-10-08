/* =========================================================================
   İç Hatlar — API'ye bağlı modüller:
     - Arama              (/api/search/people, /api/search/resources)
     - Bilgi Bankası      (/api/kb, /api/kb/editors)
     - Uygulama geri bildirimi (/api/feedback) ve Yönetim'deki listesi

   index.html'deki renderView bu fonksiyonları ekran açılınca çağırır.
   Ortak yardımcılar (esc, icon, toast, openModal, DEPARTMENTS…) index.html'den.
   ========================================================================= */
(function () {
  'use strict';

  const api = (method, path, body) => window.IhApi.req(method, path, body);
  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase('tr-TR')).join('');
  const deptOptions = (first, selected, only) =>
    (first != null ? '<option value="">' + esc(first) + '</option>' : '') +
    DEPARTMENTS.filter((d) => !only || only.includes(d.id))
      .map((d) => '<option value="' + esc(d.id) + '"' + (d.id === selected ? ' selected' : '') + '>' + esc(d.name) + '</option>')
      .join('');
  const shortUrl = (u) => {
    try { const x = new URL(u); return x.host + (x.pathname !== '/' ? x.pathname : ''); } catch (_) { return u; }
  };
  const linkHtml = (u) =>
    '<a class="ext-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(shortUrl(u)) + '</a>';
  const LOADING = '<p class="hint">Yükleniyor…</p>';

  /* ============================================================== Arama */

  let searchBound = false;
  let peopleSeq = 0;
  let resSeq = 0;

  window.renderSearch = function () {
    if (searchBound) return;
    searchBound = true;
    const pq = $('#peopleQ');
    const rq = $('#resQ');
    pq.addEventListener('input', debounce(() => loadPeople(pq.value.trim()), 250));
    rq.addEventListener('input', debounce(() => loadRes(rq.value.trim()), 250));
    loadPeople('');
    loadRes('');
  };

  async function loadPeople(q) {
    const my = ++peopleSeq;
    $('#peopleRes').innerHTML = LOADING;
    try {
      const out = await api('GET', '/api/search/people?q=' + encodeURIComponent(q));
      if (my !== peopleSeq) return;   // bu arada yeni arama başladı
      const head = out.sample ? 'Örnek kişiler' : out.items.length + ' kişi';
      $('#peopleRes').innerHTML = '<div class="res-head">' + head + '</div>'
        + (out.items.length
            ? out.items.map((p) =>
                '<div class="person"><div class="avatar" aria-hidden="true">' + esc(initials(p.name)) + '</div>'
                + '<div style="min-width:0"><b>' + esc(p.name) + '</b>'
                + '<span class="meta">' + (p.title ? esc(p.title) + ' · ' : '') + esc(p.department ? p.department.name : '—') + '</span>'
                + (p.reason ? '<span class="why">' + esc(p.reason) + '</span>' : '')
                + (p.email ? '<span class="meta"><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></span>' : '')
                + '</div></div>').join('')
            : '<p class="hint">Eşleşen kişi bulunamadı. Başka bir ad, unvan ya da konu deneyin.</p>');
    } catch (err) {
      if (my === peopleSeq) $('#peopleRes').innerHTML = '<p class="hint">Kişi araması yapılamadı: ' + esc(err.message) + '</p>';
    }
  }

  const KIND_TONE = { UYGULAMA: 'blue', SUREC: 'purple', BILGI: 'teal', KAYIT: 'green', CORTEX: 'gray' };

  async function loadRes(q) {
    const my = ++resSeq;
    $('#resRes').innerHTML = LOADING;
    try {
      const out = await api('GET', '/api/search/resources?q=' + encodeURIComponent(q));
      if (my !== resSeq) return;
      const head = out.sample ? 'Örnek sonuçlar' : out.items.length + ' sonuç';
      $('#resRes').innerHTML = '<div class="res-head">' + head + '</div>'
        + (out.items.length
            ? out.items.map((x) => {
                const src = x.source === 'kb' ? 'Bilgi Bankası' + (x.department ? ' · ' + x.department : '')
                  : x.source === 'kayit' ? 'Çözülmüş kayıt' + (x.department ? ' · ' + x.department : '')
                  : 'Kurumsal kaynak';
                const lead = x.url
                  ? '<p style="margin:0"><b style="display:inline">' + esc(x.title) + '</b> için ' + linkHtml(x.url)
                    + ' linkine tıklayıp erişebilirsiniz.</p>'
                  : '<b>' + esc(x.title) + '</b>';
                return '<div class="resource"><span class="pill ' + (KIND_TONE[x.kind] || 'gray') + '">' + esc(x.kindLabel) + '</span>'
                  + '<div style="min-width:0">' + lead
                  + (x.text ? '<p>' + esc(clip(x.text, 240)) + '</p>' : '')
                  + '<span class="meta">' + esc(src) + '</span></div></div>';
              }).join('')
            : '<p class="hint">Sonuç bulunamadı. Uygulama adı (ör. SAP) ya da işin adı (ör. izin talebi) ile deneyin.</p>');
      const c = out.sources && out.sources.cortex;
      // Yapılandırma eksiği yalnızca sistem yöneticisini ilgilendirir; geçici
      // kesinti ise herkese söylenir (sonuçlar neden az, bilinsin).
      const admin = document.body.dataset.role === 'ADMIN';
      $('#cortexNote').textContent = c === 'kapali'
        ? (admin ? 'Kurumsal arama kaynağı (Cortex) yapılandırılmadı; sonuçlar Bilgi Bankası ve çözülmüş kayıtlardan geliyor.' : '')
        : c === 'hata' ? 'Kurumsal kaynaklar şu an yanıt vermedi; sonuçlar yalnızca Bilgi Bankası ve çözülmüş kayıtlardan.' : '';
    } catch (err) {
      if (my === resSeq) $('#resRes').innerHTML = '<p class="hint">Arama yapılamadı: ' + esc(err.message) + '</p>';
    }
  }

  /* ====================================================== Bilgi Bankası */

  let kbBound = false;
  let kbItems = [];

  const kbAccess = () => window.IH_KB || { view: false, admin: false, edit: [] };
  const kbEditable = () => {
    const a = kbAccess();
    return a.edit === 'all' ? DEPARTMENTS.map((d) => d.id) : a.edit || [];
  };
  const kbKinds = () => (kbAccess().kinds || [
    { id: 'BILGI', label: 'Bilgi yanıtı' }, { id: 'UYGULAMA', label: 'Uygulama' }, { id: 'SUREC', label: 'Süreç' },
  ]);

  window.renderKb = async function () {
    const a = kbAccess();
    if (!a.view) { show('dashboard'); return toast('Bilgi Bankası yalnızca yöneticilere ve yetki verilen kişilere açık', 'err'); }
    if (!kbBound) {
      kbBound = true;
      $('#kbDept').addEventListener('change', loadKb);
      $('#kbKind').addEventListener('change', loadKb);
      $('#kbQ').addEventListener('input', debounce(loadKb, 250));
      $('#kbNew').addEventListener('click', () => openKbEditor(null));
      $('#kbRows').addEventListener('click', (e) => {
        const b = e.target.closest('[data-kb-edit]');
        if (b) openKbEditor(kbItems.find((x) => x.id === b.dataset.kbEdit));
      });
      $('#kbGrant').addEventListener('click', grantEditor);
      $('#kbEditors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-kb-revoke]');
        if (b) revokeEditor(b.dataset.kbRevoke);
      });
      $('#kbDept').innerHTML = deptOptions('Tüm ekipler', '');
      $('#kbKind').innerHTML = '<option value="">Tüm türler</option>'
        + kbKinds().map((k) => '<option value="' + esc(k.id) + '">' + esc(k.label) + '</option>').join('');
    }
    $('#kbNew').hidden = kbEditable().length === 0;
    $('#kbEditorsCard').hidden = !a.admin;
    await loadKb();
    if (a.admin) loadEditors();
  };

  async function loadKb() {
    const p = new URLSearchParams();
    if ($('#kbDept').value) p.set('department', $('#kbDept').value);
    if ($('#kbKind').value) p.set('kind', $('#kbKind').value);
    if ($('#kbQ').value.trim()) p.set('q', $('#kbQ').value.trim());
    $('#kbRows').innerHTML = '<tr><td colspan="5" class="empty">Yükleniyor…</td></tr>';
    try {
      const out = await api('GET', '/api/kb?' + p);
      kbItems = out.items;
    } catch (err) {
      $('#kbRows').innerHTML = '<tr><td colspan="5" class="empty">Yüklenemedi: ' + esc(err.message) + '</td></tr>';
      return;
    }
    $('#kbCount').textContent = kbItems.length + ' madde';
    $('#kbRows').innerHTML = kbItems.length
      ? kbItems.map((x) =>
          '<tr><td><div class="ticket-title">' + esc(x.title) + '</div>'
          + '<div class="small">' + esc(x.code) + (x.keywords ? ' · ' + esc(clip(x.keywords, 80)) : '') + '</div>'
          + (x.url ? '<div class="small">' + linkHtml(x.url) + '</div>' : '') + '</td>'
          + '<td><span class="pill ' + (KIND_TONE[x.kind] || 'gray') + '">' + esc(x.kindLabel) + '</span></td>'
          + '<td>' + esc(x.department.name) + '</td>'
          + '<td class="small">' + esc(fmtRel(x.updatedAt)) + (x.updatedBy ? '<br>' + esc(x.updatedBy) : '') + '</td>'
          + '<td>' + (x.canEdit ? '<button class="mini-btn" type="button" data-kb-edit="' + esc(x.id) + '">Düzenle</button>' : '<span class="small">—</span>') + '</td>'
          + '</tr>').join('')
      : '<tr><td colspan="5" class="empty">Madde yok.' + (kbEditable().length ? ' “Yeni madde” ile ekleyebilirsiniz.' : '') + '</td></tr>';
  }

  /*
   * opts: prefill — dolu yeni madde, title /
   * intro — pencere başlığı ve açıklaması, onDone — kayıt / silme sonrası
   * yenilenecek ekran (varsayılan: Bilgi Bankası listesi).
   */
  function openKbEditor(item, opts) {
    opts = opts || {};
    const depts = kbEditable();
    if (!depts.length) return toast('Madde ekleme yetkiniz yok', 'err');
    const v = item || opts.prefill || { kind: 'BILGI', department: { id: depts.includes(Store.me().dept) ? Store.me().dept : depts[0] }, title: '', keywords: '', answer: '', url: '' };
    const buttons = [{ label: 'İptal', cls: 'btn-ghost' }];
    if (item) buttons.push({ label: 'Kaldır', cls: 'btn-danger', run: () => confirmKbDelete(item, opts) });
    buttons.push({ label: 'Kaydet', cls: 'btn-primary', run: () => saveKb(item, opts) });
    openModal(opts.title || (item ? 'Maddeyi düzenle · ' + item.code : 'Yeni Bilgi Bankası maddesi'),
      (opts.intro ? '<p class="hint" style="margin:0 0 14px">' + esc(opts.intro) + '</p>' : '')
      + '<div class="grid two-col">'
      + '<div class="field"><label for="kbfKind">Tür</label><select id="kbfKind">'
      +   kbKinds().map((k) => '<option value="' + esc(k.id) + '"' + (k.id === v.kind ? ' selected' : '') + '>' + esc(k.label) + '</option>').join('')
      + '</select></div>'
      + '<div class="field"><label for="kbfDept">Ekip</label><select id="kbfDept">' + deptOptions(null, v.department.id, depts) + '</select></div>'
      + '</div>'
      + '<div class="field"><label for="kbfTitle">Başlık</label><input id="kbfTitle" maxlength="200" value="' + esc(v.title) + '" placeholder="ör. Bordro ve ücret pusulası" /></div>'
      + '<div class="field"><label for="kbfKeys">Anahtar kelimeler <span class="opt">(isteğe bağlı)</span></label>'
      +   '<input id="kbfKeys" maxlength="500" value="' + esc(v.keywords || '') + '" placeholder="Aynı sorunun başka söylenişleri: bordro, maaş, e-bordro" /></div>'
      + '<div class="field"><label for="kbfAnswer">Yanıt</label><textarea id="kbfAnswer" maxlength="5000" placeholder="Çalışanın göreceği hazır yanıt…">' + esc(v.answer) + '</textarea></div>'
      + '<div class="field"><label for="kbfUrl">Bağlantı <span class="opt">(isteğe bağlı)</span></label>'
      +   '<input id="kbfUrl" type="url" maxlength="500" value="' + esc(v.url || '') + '" placeholder="https://…" /></div>',
      buttons);
  }

  let kbSaving = false;
  async function saveKb(item, opts) {
    opts = opts || {};
    if (kbSaving) return;
    const body = {
      kind: $('#kbfKind').value,
      departmentId: $('#kbfDept').value,
      title: $('#kbfTitle').value.trim(),
      keywords: $('#kbfKeys').value.trim() || null,
      answer: $('#kbfAnswer').value.trim(),
      url: $('#kbfUrl').value.trim() || null,
    };
    if (body.title.length < 5) return toast('Başlık en az 5 karakter olmalı', 'err');
    if (body.answer.length < 10) return toast('Yanıt en az 10 karakter olmalı', 'err');
    kbSaving = true;
    try {
      if (item) await api('PUT', '/api/kb/' + encodeURIComponent(item.id), body);
      else await api('POST', '/api/kb', body);
      closeModal();
      toast(item ? 'Yanıt güncellendi; birkaç dakika içinde önerilere yansır' : 'Yanıt Bilgi Bankası’na eklendi; birkaç dakika içinde önerilere yansır', 'ok');
      (opts.onDone || loadKb)();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      kbSaving = false;
    }
  }

  function confirmKbDelete(item, opts) {
    opts = opts || {};
    openModal('Maddeyi kaldır',
      '<p class="hint" style="margin:0"><b>' + esc(item.title) + '</b> Bilgi Bankası’ndan kaldırılsın mı? '
      + 'Arama ve yeni kayıttaki önerilerden de çıkar.</p>',
      [
        { label: 'Vazgeç', cls: 'btn-ghost', run: () => openKbEditor(item, opts) },
        { label: 'Kaldır', cls: 'btn-danger', run: async () => {
          try {
            await api('DELETE', '/api/kb/' + encodeURIComponent(item.id));
            closeModal();
            toast('Madde kaldırıldı', 'ok');
            (opts.onDone || loadKb)();
          } catch (err) { toast(err.message, 'err'); }
        } },
      ]);
  }

  /* Kişi seçimi: yalnızca ekip üyeleri (yöneticiler kendi ekiplerinde zaten
     yetkili) ve henüz yetkisi olmayanlar. Liste yeniden çizilse de yapılmış
     seçim korunur. */
  function fillGrantUsers(granted) {
    const keep = $('#kbGrantUser').value;
    $('#kbGrantUser').innerHTML = '<option value="">Kişi seçin…</option>'
      + USERS.filter((u) => u.dept && u.role !== 'Yönetici' && u.role !== 'Sistem Yöneticisi' && !granted.has(u.id))
        .map((u) => '<option value="' + esc(u.id) + '"' + (u.id === keep ? ' selected' : '') + '>' + esc(u.name) + ' — ' + esc(deptName(u.dept)) + '</option>').join('');
  }

  async function loadEditors() {
    $('#kbEditors').innerHTML = LOADING;
    try {
      const out = await api('GET', '/api/kb/editors');
      fillGrantUsers(new Set(out.items.map((x) => x.user.id)));
      $('#kbEditors').innerHTML = out.items.length
        ? out.items.map((x) =>
            '<div class="leader"><div class="avatar" aria-hidden="true">' + esc(initials(x.user.name)) + '</div>'
            + '<div style="flex:1;min-width:0"><b>' + esc(x.user.name) + '</b><span>' + esc(x.department.name) + ' maddeleri'
            + (x.grantedBy ? ' · veren: ' + esc(x.grantedBy) : '') + ' · ' + esc(fmtRel(x.createdAt)) + '</span></div>'
            + '<button class="mini-btn" type="button" data-kb-revoke="' + esc(x.id) + '" aria-label="' + esc(x.user.name + ' kişisinden yetkiyi al') + '">Yetkiyi al</button></div>').join('')
        : '<p class="hint" style="margin:0">Ek yetki verilmedi.</p>';
    } catch (err) {
      fillGrantUsers(new Set());
      $('#kbEditors').innerHTML = '<p class="hint">Yetkiler yüklenemedi: ' + esc(err.message) + '</p>';
    }
  }

  async function grantEditor() {
    const userId = $('#kbGrantUser').value;
    if (!userId) return toast('Kişi seçin', 'err');
    try {
      await api('POST', '/api/kb/editors', { userId });
      toast('Yetki verildi', 'ok');
      $('#kbGrantUser').value = '';
      loadEditors();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function revokeEditor(id) {
    try {
      await api('DELETE', '/api/kb/editors/' + encodeURIComponent(id));
      toast('Yetki alındı', 'ok');
      loadEditors();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ================================================ Uygulama geri bildirimi */

  let fbSending = false;
  window.openFeedback = function () {
    openModal('Uygulama için geri bildirim',
      '<p class="hint" style="margin:0 0 12px">Görüşünüzü, karşılaştığınız bir sorunu ya da iyileştirme önerinizi yazın; sistem yöneticisine iletilir.</p>'
      + '<div class="field"><label for="fbText">Geri bildiriminiz</label>'
      + '<textarea id="fbText" maxlength="2000" placeholder="ör. Raporlardaki ekip filtresi çok işime yaradı; CSV’de çözüm tarihi de olsa iyi olur."></textarea>'
      + '<p class="hint" id="fbCount" style="margin-top:6px" aria-live="polite">0 / 2000</p></div>',
      [
        { label: 'Vazgeç', cls: 'btn-ghost' },
        { label: 'Gönder', cls: 'btn-primary', run: async () => {
          if (fbSending) return;
          const text = ($('#fbText').value || '').trim();
          if (text.length < 5) return toast('Geri bildiriminizi en az 5 karakter yazın', 'err');
          fbSending = true;
          try {
            await api('POST', '/api/feedback', { text, page: typeof CURRENT !== 'undefined' ? CURRENT : null });
            closeModal();
            toast('Teşekkürler, geri bildiriminiz iletildi', 'ok');
          } catch (err) {
            toast(err.message, 'err');
          } finally {
            fbSending = false;
          }
        } },
      ]);
    const ta = $('#fbText');
    ta.addEventListener('input', () => { $('#fbCount').textContent = ta.value.length + ' / 2000'; });
  };

  let fbBound = false;
  window.renderFeedbackAdmin = async function () {
    const card = $('#fbAdminCard');
    if (document.body.dataset.role !== 'ADMIN') { card.hidden = true; return; }
    card.hidden = false;
    if (!fbBound) {
      fbBound = true;
      $('#fbAdminList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-fb-read]');
        if (!b) return;
        try {
          await api('POST', '/api/feedback/' + encodeURIComponent(b.dataset.fbRead) + '/read');
          window.renderFeedbackAdmin();
        } catch (err) { toast(err.message, 'err'); }
      });
    }
    $('#fbAdminList').innerHTML = LOADING;
    try {
      const out = await api('GET', '/api/feedback');
      $('#fbAdminCount').textContent = out.unread + ' okunmamış · ' + out.items.length + ' toplam';
      const pageName = (p) => (p && typeof TITLES !== 'undefined' && TITLES[p] ? TITLES[p][0] : p || '');
      $('#fbAdminList').innerHTML = out.items.length
        ? out.items.map((x) =>
            '<div class="leader"><div class="avatar" aria-hidden="true">' + (x.read ? '•' : '!') + '</div>'
            + '<div style="flex:1;min-width:0"><b style="white-space:pre-wrap;overflow-wrap:anywhere;font-weight:' + (x.read ? 500 : 650) + '">' + esc(x.text) + '</b>'
            + '<span>' + esc(x.user ? x.user.name + (x.user.department ? ' · ' + x.user.department : '') : 'Silinmiş kullanıcı')
            + (x.page ? ' · ' + esc(pageName(x.page)) + ' ekranından' : '') + ' · ' + esc(fmtRel(x.createdAt)) + '</span></div>'
            + (x.read ? '' : '<button class="mini-btn" type="button" data-fb-read="' + esc(x.id) + '">Okundu</button>')
            + '</div>').join('')
        : '<p class="hint" style="margin:0">Henüz geri bildirim yok.</p>';
    } catch (err) {
      $('#fbAdminList').innerHTML = '<p class="hint">Geri bildirimler yüklenemedi: ' + esc(err.message) + '</p>';
    }
  };
})();
