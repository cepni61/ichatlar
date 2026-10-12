/* =========================================================================
   İç Hatlar — API'ye bağlı modüller:
     - Kaynak Bul         (/api/search/resources)
     - Bilgi Bankası      (/api/kb)
     - Yetkiler           (/api/admin/grants, /api/admin/handover)
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
  const shortUrl = (u) => {
    try { const x = new URL(u); return x.host + (x.pathname !== '/' ? x.pathname : ''); } catch (_) { return u; }
  };
  const linkHtml = (u, rid) =>
    '<a class="ext-link" ' + (rid ? 'data-rid="' + esc(rid) + '" ' : '') + 'href="' + esc(u) +
    '" target="_blank" rel="noopener noreferrer">' + esc(shortUrl(u)) + '</a>';
  const LOADING = '<p class="hint">Yükleniyor…</p>';

  /* ============================================================== Arama */

  let searchBound = false;
  let resSeq = 0;

  window.renderSearch = function () {
    if (searchBound) return;
    searchBound = true;
    const rq = $('#resQ');
    rq.addEventListener('input', debounce(() => loadRes(rq.value.trim()), 250));
    // Sonuç bağlantısına tıklama kayıt önleme günlüğüne yazılır.
    $('#resRes').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-rid]');
      if (a && window.IhHelp) IhHelp.mark(a.dataset.rid, 'open');
    });
    loadRes('');
  };

  const KIND_TONE = { UYGULAMA: 'blue', SUREC: 'purple', BILGI: 'teal', KAYIT: 'green', CORTEX: 'gray' };

  async function loadRes(q) {
    const my = ++resSeq;
    $('#resRes').innerHTML = LOADING;
    try {
      const sid = q && window.IhHelp ? await IhHelp.sessionFor() : null;
      const call = api('GET', '/api/search/resources?' + new URLSearchParams(sid ? { q, helpSessionId: sid } : { q }));
      if (q && window.IhHelp) IhHelp.track(call);
      const out = await call;
      if (out.helpSessionId && window.IhHelp) IhHelp.session.set(out.helpSessionId);
      if (my !== resSeq) return;
      const head = out.sample ? 'Örnek sonuçlar' : out.items.length + ' sonuç';
      $('#resRes').innerHTML = '<div class="res-head">' + head + '</div>'
        + (out.items.length
            ? out.items.map((x) => {
                const src = x.source === 'kb' ? 'Bilgi Bankası' + (x.department ? ' · ' + x.department : '')
                  : x.source === 'kayit' ? 'Çözülmüş kayıt' + (x.department ? ' · ' + x.department : '')
                  : 'Kurumsal kaynak';
                const lead = x.url
                  ? '<p style="margin:0"><b style="display:inline">' + esc(x.title) + '</b> için ' + linkHtml(x.url, x.resultId)
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
    return a.edit === 'all' ? teamUnits().map((d) => d.id) : a.edit || [];
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
      $('#kbDept').innerHTML = '<option value="">Tüm ekipler</option>' + teamOptions('');
      $('#kbKind').innerHTML = '<option value="">Tüm türler</option>'
        + kbKinds().map((k) => '<option value="' + esc(k.id) + '">' + esc(k.label) + '</option>').join('');
    }
    $('#kbNew').hidden = kbEditable().length === 0;
    await loadKb();
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
      + '<div class="field"><label for="kbfDept">Ekip</label><select id="kbfDept">' + teamOptions(v.department.id, null, depts) + '</select></div>'
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

  /* ============================================================ Yetkiler */

  const ROLE_NAME = { USER: 'Çalışan', TEAM_MEMBER: 'Ekip üyesi', MANAGER: 'Ekip yöneticisi', ADMIN: 'Sistem yöneticisi' };
  const KIND_NAME = {
    MANAGER: 'Ekip yöneticisi', ADMIN: 'Sistem yöneticisi', DEPT_HEAD: 'Departman sorumlusu',
    REPORTS: 'Rapor görüntüleyici', KB_EDITOR: 'Bilgi Bankası düzenleyici',
  };
  const dayOf = (iso) => new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });
  let permBound = false;

  /* Kişi seçenekleri: departman başlıkları altında, yanında ekibi */
  function personOptions(list, first) {
    const opt = (u) => '<option value="' + esc(u.id) + '">' + esc(u.name) + (u.dept ? ' — ' + esc(deptName(u.dept)) : '') + '</option>';
    const sorted = (xs) => xs.slice().sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return '<option value="">' + esc(first) + '</option>'
      + rootUnits().map((r) => {
        const ids = teamsOfDept(r.id).map((t) => t.id);
        const xs = list.filter((u) => ids.includes(u.dept));
        return xs.length ? '<optgroup label="' + esc(r.name) + '">' + sorted(xs).map(opt).join('') + '</optgroup>' : '';
      }).join('')
      + (() => {
        const xs = list.filter((u) => !teamUnits().some((d) => d.id === u.dept));
        return xs.length ? '<optgroup label="Ekibi olmayanlar">' + sorted(xs).map(opt).join('') + '</optgroup>' : '';
      })();
  }

  /* Kapsam: departman sorumlusunda departman, Bilgi Bankası'nda ekip (varsayılan kişinin ekibi) */
  function syncScope() {
    const kind = $('#permKind').value;
    const sel = $('#permScope');
    const u = USERS.find((x) => x.id === $('#permUser').value);
    if (kind === 'DEPT_HEAD') {
      sel.innerHTML = '<option value="">Departman seçin…</option>'
        + rootUnits().map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('');
      if (u && u.dept) sel.value = rootOf(u.dept) || '';
    } else if (kind === 'KB_EDITOR') {
      sel.innerHTML = '<option value="">Ekip seçin…</option>' + teamOptions(u ? u.dept : '');
    }
    sel.hidden = kind !== 'DEPT_HEAD' && kind !== 'KB_EDITOR';
  }

  window.renderPerms = function () {
    if (document.body.dataset.role !== 'ADMIN') { show('dashboard'); return toast('Yetkiler yalnızca sistem yöneticisine açık', 'err'); }
    if (!permBound) {
      permBound = true;
      const me = Store.me();
      const others = USERS.filter((u) => u.id !== me.id);
      $('#permUser').innerHTML = personOptions(others, 'Kişi seçin…');
      $('#hoFrom').innerHTML = personOptions(others, 'Ayrılan kişi…');
      $('#hoTo').innerHTML = personOptions(USERS.filter((u) => u.teamRole && u.dept), 'Devralacak kişi yok: ekibin havuzuna bırak');
      $('#permUntil').min = new Date().toISOString().slice(0, 10);
      $('#permKind').addEventListener('change', syncScope);
      $('#permUser').addEventListener('change', syncScope);
      $('#permGrant').addEventListener('click', grantNow);
      $('#permRows').addEventListener('click', (e) => {
        const b = e.target.closest('[data-perm-revoke]');
        if (b) revoke(b.dataset.permRevoke, b.dataset.what);
      });
      $('#hoFrom').addEventListener('change', previewHandover);
      $('#hoGo').addEventListener('click', confirmHandover);
      syncScope();
    }
    loadPerms();
    loadHistory();
  };

  async function loadPerms() {
    $('#permRows').innerHTML = '<tr><td colspan="5" class="empty">Yükleniyor…</td></tr>';
    try {
      const out = await api('GET', '/api/admin/grants');
      $('#permCount').textContent = out.grants.length + ' yetki';
      $('#permRows').innerHTML = out.grants.map((g) => {
        const what = g.label + (g.department ? ' (' + g.department.name + ')' : '');
        const left = g.expiresAt ? Math.floor((new Date(g.expiresAt) - Date.now()) / 86400000) : null;
        return '<tr><td><div class="perm-who"><div class="avatar sm" aria-hidden="true">' + esc(initials(g.user.name)) + '</div>'
          + '<div><b>' + esc(g.user.name) + '</b><small>' + esc(g.user.departmentId ? deptName(g.user.departmentId) : g.user.email) + '</small></div></div></td>'
          + '<td>' + esc(what) + (g.note ? '<span class="perm-note">' + esc(g.note) + '</span>' : '') + '</td>'
          + '<td class="small">' + esc(g.grantedBy || '—') + '<br>' + esc(fmtRel(g.createdAt)) + '</td>'
          + '<td class="small">' + (g.expiresAt ? esc(dayOf(g.expiresAt)) + '<br>' + esc(left < 1 ? 'son gün' : left + ' gün kaldı') : 'Süresiz') + '</td>'
          + '<td><button class="mini-btn" type="button" data-perm-revoke="' + esc(g.id) + '" data-what="' + esc(g.user.name + ': ' + what) + '">Yetkiyi al</button></td></tr>';
      }).join('') || '<tr><td colspan="5" class="empty">Bu ekrandan verilmiş yetki yok.</td></tr>';

      $('#permDirHint').textContent = out.source
        ? 'Bu kişilerin rolü ' + out.source + ' gruplarından gelir; buradan değişmez, BT grubu düzenler.'
        : 'Bu kişilerin rolü kurulum verisinden gelir; buradan değişmez.';
      $('#permDirCount').textContent = out.directory.length + ' kişi';
      $('#permDirRows').innerHTML = out.directory.map((u) =>
        '<tr><td><div class="perm-who"><div class="avatar sm" aria-hidden="true">' + esc(initials(u.name)) + '</div>'
        + '<div><b>' + esc(u.name) + '</b><small>' + esc(u.email) + '</small></div></div></td>'
        + '<td>' + esc(u.departmentId ? deptName(u.departmentId) : '—') + '</td>'
        + '<td><span class="pill ' + (u.baseRole === 'ADMIN' ? 'purple' : 'blue') + '">' + esc(ROLE_NAME[u.baseRole] || u.baseRole) + '</span></td></tr>').join('')
        || '<tr><td colspan="3" class="empty">Kimse yok.</td></tr>';
    } catch (err) {
      $('#permRows').innerHTML = '<tr><td colspan="5" class="empty">Yetkiler yüklenemedi: ' + esc(err.message) + '</td></tr>';
    }
  }

  /* Geçmiş: denetim izindeki yetki olayları, cümle olarak */
  function historyLine(h) {
    const d = h.detail || {};
    const what = (d.label || '') + (d.department ? ' (' + d.department + ')' : '');
    const until = d.expiresAt ? ', ' + dayOf(d.expiresAt) + ' tarihine kadar' : '';
    const who = h.actor || 'Sistem';
    switch (h.action) {
      case 'grant.add': return who + ', ' + d.user + ' kişisine ' + what + ' yetkisi verdi' + until + '.';
      case 'grant.renew': return who + ', ' + d.user + ' kişisinin ' + what + ' yetkisini yeniledi' + (until || ' (süresiz)') + '.';
      case 'grant.revoke': return who + ', ' + d.user + ' kişisinden ' + what + ' yetkisini aldı.';
      case 'grant.expire': return d.user + ' kişisinin ' + what + ' yetkisinin süresi doldu.';
      case 'handover':
      case 'handover.deactivate':
        return who + ', ' + d.user + ' kişisinin açık kayıtlarını devretti: '
          + (d.assigned ? d.assigned + ' kayıt ' + d.to + ' kişisine' : '') + (d.assigned && d.pooled ? ', ' : '')
          + (d.pooled ? d.pooled + ' kayıt ekibin havuzuna' : '') + (!d.assigned && !d.pooled ? 'açık kayıt yoktu' : '')
          + (h.action === 'handover.deactivate' ? '; kişi uygulamada kapatıldı' : '') + '.';
      default: return h.action;
    }
  }

  async function loadHistory() {
    $('#permHistory').innerHTML = LOADING;
    try {
      const out = await api('GET', '/api/admin/grants/history');
      $('#permHistory').innerHTML = out.items.length
        ? '<ul class="perm-log">' + out.items.map((h) =>
            '<li><time datetime="' + esc(h.at) + '">' + esc(fmtDate(h.at)) + '</time><span>' + esc(historyLine(h)) + '</span></li>').join('') + '</ul>'
        : '<p class="hint" style="margin:0">Henüz yetki değişikliği yok.</p>';
    } catch (err) {
      $('#permHistory').innerHTML = '<p class="hint">Geçmiş yüklenemedi: ' + esc(err.message) + '</p>';
    }
  }

  function refreshUserRole(userId, role) {
    // Kişi listelerindeki rol etiketi (seçiciler, kayıt sahibi) tazelensin.
    const u = USERS.find((x) => x.id === userId);
    if (!u || !role) return;
    u.role = role === 'MANAGER' ? 'Yönetici' : role === 'ADMIN' ? 'Sistem Yöneticisi' : 'Ekip Üyesi';
    u.teamRole = role !== 'USER';
  }

  async function grantNow() {
    const userId = $('#permUser').value;
    const kind = $('#permKind').value;
    if (!userId) return toast('Kişi seçin', 'err');
    const scoped = kind === 'DEPT_HEAD' || kind === 'KB_EDITOR';
    if (scoped && !$('#permScope').value) return toast(kind === 'DEPT_HEAD' ? 'Departman seçin' : 'Ekip seçin', 'err');
    const body = { userId, kind, until: $('#permUntil').value || null };
    if (scoped) body.departmentId = $('#permScope').value;
    try {
      const out = await api('POST', '/api/admin/grants', body);
      refreshUserRole(userId, out.role);
      const u = USERS.find((x) => x.id === userId);
      toast((u ? u.name : 'Kişi') + ': ' + KIND_NAME[kind] + (out.renewed ? ' yetkisi yenilendi' : ' yetkisi verildi'), 'ok');
      $('#permUser').value = '';
      $('#permUntil').value = '';
      syncScope();
      loadPerms();
      loadHistory();
    } catch (err) { toast(err.message, 'err'); }
  }

  function revoke(id, what) {
    openModal('Yetkiyi al', '<p style="margin:0">' + esc(what) + ' yetkisi alınsın mı? Kişiye bildirim gider.</p>', [
      { label: 'Vazgeç', cls: 'btn-ghost' },
      { label: 'Yetkiyi al', cls: 'btn-danger', run: async () => {
        try {
          await api('DELETE', '/api/admin/grants/' + encodeURIComponent(id));
          closeModal();
          toast('Yetki alındı', 'ok');
          loadPerms();
          loadHistory();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
  }

  /* ------------------------------------------- ayrılan çalışanın kayıtları */

  let hoSeq = 0;
  async function previewHandover() {
    const id = $('#hoFrom').value;
    const seq = ++hoSeq;
    $('#hoPreview').textContent = id ? 'Hesaplanıyor…' : '';
    if (!id) return;
    try {
      const out = await api('GET', '/api/admin/handover/' + encodeURIComponent(id));
      if (seq !== hoSeq) return;
      $('#hoPreview').textContent = out.open
        ? out.user.name + ' kişisinin üzerinde ' + out.open + ' açık kayıt var: ' + out.teams.map((t) => t.name + ' ' + t.n).join(', ') + '.'
        : out.user.name + ' kişisinin üzerinde açık kayıt yok.';
    } catch (err) { $('#hoPreview').textContent = err.message; }
  }

  function confirmHandover() {
    const from = USERS.find((u) => u.id === $('#hoFrom').value);
    if (!from) return toast('Kayıtları devredilecek kişiyi seçin', 'err');
    const to = USERS.find((u) => u.id === $('#hoTo').value);
    const off = $('#hoDeactivate').checked;
    openModal('Kayıtları devret',
      '<p style="margin:0 0 8px">' + esc(from.name) + ' kişisinin açık kayıtları '
      + (to ? esc(to.name) + ' kişisine devredilecek; ' + esc(to.name) + ' kişisinin ekibinde olmayanlar ekibin havuzuna dönecek.' : 'ekiplerinin havuzuna dönecek.')
      + '</p>' + (off ? '<p style="margin:0">Kişi uygulamada kapatılacak: oturumu sonlanır, yetkileri silinir.</p>' : ''),
      [
        { label: 'Vazgeç', cls: 'btn-ghost' },
        { label: 'Devret', cls: off ? 'btn-danger' : 'btn-primary', run: async () => {
          try {
            const out = await api('POST', '/api/admin/handover', { fromUserId: from.id, toUserId: to ? to.id : null, deactivate: off });
            closeModal();
            toast(out.assigned + ' kayıt devredildi, ' + out.pooled + ' kayıt ekibin havuzuna döndü' + (out.deactivated ? '; kişi kapatıldı' : ''), 'ok');
            $('#hoFrom').value = ''; $('#hoTo').value = ''; $('#hoDeactivate').checked = false; $('#hoPreview').textContent = '';
            loadPerms();
            loadHistory();
            if (typeof IhRefresh === 'function') IhRefresh();
          } catch (err) { toast(err.message, 'err'); }
        } },
      ]);
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
