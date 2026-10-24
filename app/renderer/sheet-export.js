"use strict";
// キャラの設定シート（SNS向けの画像）の書き出し画面。載せるものを選び、仕上がりを見てから保存する。
// 選択はこのフォームだけが持つ。本体へはキャラのIDと選んだ項目だけを渡し、本体が保存データから組み立てる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SheetExportUI = api.createSheetExportUI({
    document, $, esc, api: root.ouip, toast,
    reportError: (message, form) => UIAccess.reportError(message, form),
    getState: () => S,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const X_LIMIT = 5 * 1024 * 1024;
  // Node（試験・書き出し本体）ではrequire、画面では大域のCharacterStatsを使う。
  const CharacterStats = typeof module === 'object' && module.exports ? require('./character-stats') : globalThis.CharacterStats;
  const StatusModel = typeof module === 'object' && module.exports ? require('./status-model') : globalThis.StatusModel;
  function createSheetExportUI({ document, $, esc, api, toast, reportError, getState }) {
    let current = null, timer = null, serial = 0, previewing = Promise.resolve();
    const need = name => { if (typeof api[name] !== 'function') throw new Error('この機能を使うには本体の更新が必要です。編集を確定して、閉じて開き直してください'); return api[name]; };
    function read() {
      const form = $('sheet-form'), checked = key => !!form.querySelector(`[data-sheet="${key}"]`)?.checked;
      return {
        size: form.querySelector('[name="sheet-size"]:checked')?.value || 'square',
        author: $('sheet-author').value,
        image: checked('image'), imagePath: $('sheet-image')?.value || '', desc: checked('desc'), stats: checked('stats'), fields: checked('fields'), credit: checked('credit'),
        tags: [...form.querySelectorAll('[data-sheet-tag]:checked')].map(input => input.value),
        sections: [...form.querySelectorAll('[data-sheet-section]:checked')].map(input => Number(input.value)),
      };
    }
    async function open(id) {
      try {
        const entry = getState().entries.find(e => e.id === id); if (!entry) return;
        const { options, sizes } = await need('sheetDefaults')(id);
        current = { id };
        const box = (key, label, on, disabled = false, note = '') => `<label><input type="checkbox" data-sheet="${key}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}${note ? `<span class="small muted">${esc(note)}</span>` : ''}</label>`;
        const tags = Object.keys(entry.tags || {}), sections = entry.sections || [];
        const imageItems = typeof ImageSet !== 'undefined' ? ImageSet.list(entry) : [];
        const viewer = $('viewer');
        viewer.classList.remove('image-editor', 'site-export-viewer', 'bs-incoming-viewer'); viewer.classList.add('sheet-export-viewer');
        viewer.innerHTML = `<div class="vh"><h3 id="vt">設定シートを画像で書き出す</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div>
          <form id="sheet-form"><div class="sheet-body"><div class="sheet-options">
            <fieldset><legend>大きさ</legend>${Object.entries(sizes).map(([key, size]) => `<label><input type="radio" name="sheet-size" value="${esc(key)}" ${options.size === key ? 'checked' : ''}>${esc(size.label)}<span class="small muted">${size.width}×${size.height}</span></label>`).join('')}</fieldset>
            <label class="sheet-author" for="sheet-author">作者名</label><input id="sheet-author" class="inp" maxlength="200" autocomplete="off" value="${esc(options.author)}">
            <p class="small muted">${options.author ? '概要の作者名が入っています。ここで変えても概要は変わりません。' : '概要に作者名がありません。ここに入れると、この書き出しにだけ載ります。'}</p>
            <fieldset><legend>載せるもの</legend>
              ${box('image', '絵', options.image, !entry.image, entry.image ? '' : '（絵がありません）')}
              ${imageItems.length > 1 ? `<label class="sheet-image-pick">使う絵<select id="sheet-image">${imageItems.map((item, i) => `<option value="${esc(item.image)}" ${(options.imagePath || entry.image) === item.image ? 'selected' : ''}>${esc(item.caption || `絵${i + 1}`)}</option>`).join('')}</select></label>` : ''}
              ${box('desc', '説明', options.desc, !String(entry.desc || '').trim())}
              ${tags.length ? `<div class="sheet-group"><span class="small muted">基本情報・タグ</span>${tags.map(key => `<label><input type="checkbox" data-sheet-tag value="${esc(key)}" ${options.tags.includes(key) ? 'checked' : ''}>${esc(key)}${(entry.tagPositions?.[key] ?? 'below') === 'hidden' ? '<span class="small muted">（カードで非表示）</span>' : ''}</label>`).join('')}</div>` : ''}
              ${box('stats', 'ステータス', options.stats, !CharacterStats.itemsOf(StatusModel.resolve(entry, getState().world)).length)}
              ${sections.length ? `<div class="sheet-group"><span class="small muted">文章</span>${sections.map((s, i) => `<label><input type="checkbox" data-sheet-section value="${i}" ${options.sections.includes(i) ? 'checked' : ''}>${esc(s.title || '（見出しなし）')}</label>`).join('')}</div>` : ''}
              ${box('fields', '設定項目（未定は空欄と番号）', options.fields, !(entry.fields || []).length)}
              ${box('credit', '「OuiPで作成」を入れる', options.credit)}
            </fieldset>
          </div><div class="sheet-preview"><p class="small muted" id="sheet-status" role="status">仕上がりを作成しています…</p><div class="busy-bar" id="sheet-busy" hidden><span></span></div><div id="sheet-pages"></div></div></div>
          <div class="modal-actions row"><button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">画像を書き出す</button></div></form>`;
        $('veil').hidden = false;
        viewer.querySelector('[name="sheet-size"]:checked')?.focus();
        preview();
      } catch (error) { reportError(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    }
    // 選択を変えるたびに作り直す。古い結果が後から届いても、最新の選択の分だけを表示する。
    function preview() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!current || !$('sheet-form')) return;
        const mine = ++serial, options = read();
        $('sheet-status').textContent = '仕上がりを作成しています…';
        if ($('sheet-busy')) $('sheet-busy').hidden = false;
        previewing = previewing.catch(() => {}).then(async () => {
          try {
            const result = await need('previewSheet')(current.id, options);
            if (mine !== serial || !$('sheet-pages')) return;
            const over = result.sizes.filter(size => size > X_LIMIT).length;
            $('sheet-pages').innerHTML = result.pages.map((src, i) => `<figure><img src="${esc(src)}" alt="${i + 1}枚目の仕上がり"><figcaption>${result.pages.length > 1 ? `${i + 1}/${result.pages.length}` : '1枚'} ・ ${Math.ceil(result.sizes[i] / 1024)}KB</figcaption></figure>`).join('');
            $('sheet-status').textContent = `${result.pages.length}枚になります。入りきらない分は、文字を小さくせず次の画像へ続けます。` + (over ? ` Xには5MBまでの画像しか載せられません（${over}枚が超えています）。` : '') + (result.overflow ? ' ステータスなど1つの塊がページに入りきらず、端が切れています。' : '');
            if ($('sheet-busy')) $('sheet-busy').hidden = true;
          } catch (error) {
            if (mine !== serial || !$('sheet-status')) return;
            $('sheet-status').textContent = '仕上がりを作れませんでした: ' + String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            if ($('sheet-busy')) $('sheet-busy').hidden = true;
          }
        });
      }, 350);
    }
    document.addEventListener('click', ev => {
      const button = ev.target.closest?.('[data-sheet-export]'); if (!button) return;
      open(button.dataset.sheetExport);
    });
    for (const type of ['change', 'input']) document.addEventListener(type, ev => { if (ev.target.closest?.('#sheet-form')) preview(); });
    document.addEventListener('submit', async ev => {
      if (ev.target.id !== 'sheet-form') return;
      ev.preventDefault(); const form = ev.target; if (form.dataset.submitting || !current) return;
      const controls = [...$('viewer').querySelectorAll('button,input')].map(el => [el, el.disabled]);
      form.dataset.submitting = '1'; controls.forEach(([el]) => { el.disabled = true; });
      $('sheet-status').textContent = '画像を作成しています…';
      if ($('sheet-busy')) $('sheet-busy').hidden = false;
      try {
        clearTimeout(timer); serial++; await previewing.catch(() => {});
        const result = await need('exportSheet')(current.id, read());
        if (!result) { $('sheet-status').textContent = '書き出しをやめました。選んだ内容は残っています。'; return; }
        $('veil').hidden = true; $('viewer').classList.remove('sheet-export-viewer'); current = null;
        toast(`${result.files.length}枚を書き出しました（${result.files.join('、')}）` + (result.overX ? `。うち${result.overX}枚は5MBを超えるので、Xには載せられません` : ''));
      } catch (error) {
        reportError(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') + '。選んだ内容は残っています。', form);
        $('sheet-status').textContent = '書き出せませんでした。';
      } finally {
        if ($('sheet-busy')) $('sheet-busy').hidden = true;
        delete form.dataset.submitting; controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
      }
    });
    return { open, read };
  }
  return { createSheetExportUI };
});
