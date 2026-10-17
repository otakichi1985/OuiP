/* Fixed viewing code. No network, storage or application API. */
'use strict';
(() => {
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('ja');
  const catalogs = new Map();
  const panels = [...document.querySelectorAll('[data-panel]')], tabLinks = [...document.querySelectorAll('[data-tab-link]')];
  const navSearch = document.querySelector('[data-nav-search]');
  let current = null;
  function showPanel(panel) {
    if (!panel || panel === current) return;
    current = panel;
    panels.forEach(p => { p.hidden = p !== panel; });
    tabLinks.forEach(a => a.setAttribute('aria-current', a.hash === '#' + panel.id ? 'page' : 'false'));
    const catalog = catalogs.get(panel);
    if (navSearch) { navSearch.disabled = !catalog; navSearch.value = catalog ? catalog.search.value : ''; navSearch.placeholder = catalog ? '名前・読み・本文' : '分類を選ぶと検索できます'; }
  }
  if (panels.length) document.documentElement.classList.add('tabbed');
  for (const section of document.querySelectorAll('[data-catalog]')) {
    const search = section.querySelector('[data-search]');
    const checkboxes = [...section.querySelectorAll('[data-filter-key], [data-unset-filter]')];
    const rangeInputs = [...section.querySelectorAll('[data-range-key]')];
    const rangeKeys = [...new Set(rangeInputs.map(input => input.dataset.rangeKey))];
    const rangeOf = key => { const box = rangeInputs.filter(input => input.dataset.rangeKey === key); return FacetRange.parse(box.find(i => 'rangeMin' in i.dataset).value, box.find(i => 'rangeMax' in i.dataset).value); };
    const records = [...section.querySelectorAll('[data-record]')].map(node => {
      const tags = new Map();
      for (const tag of node.querySelectorAll('[data-tag-key]')) {
        if (!tags.has(tag.dataset.tagKey)) tags.set(tag.dataset.tagKey, new Set());
        tags.get(tag.dataset.tagKey).add(tag.dataset.tagValue);
      }
      return {node, tags, search: normalize(node.textContent), unset: node.dataset.unset === 'true'};
    });
    function matches(record, selected, ignoreKey) {
      if (!normalize(search.value).trim().split(/\s+/u).every(word => record.search.includes(word))) return false;
      if (!rangeKeys.every(key => key === ignoreKey || FacetRange.matches([...(record.tags.get(key) || [])], rangeOf(key)))) return false;
      const groups = new Map();
      for (const checkbox of selected) {
        const key = checkbox.hasAttribute('data-unset-filter') ? null : checkbox.dataset.filterKey;
        if (key === ignoreKey) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(checkbox.value);
      }
      return [...groups].every(([key, values]) => key === null ? record.unset : values.some(value => record.tags.get(key)?.has(value)));
    }
    function update() {
      const selected = checkboxes.filter(checkbox => checkbox.checked);
      let visible = 0;
      for (const record of records) {
        record.node.hidden = !matches(record, selected, undefined);
        if (!record.node.hidden) visible++;
      }
      for (const checkbox of checkboxes) {
        const key = checkbox.hasAttribute('data-unset-filter') ? null : checkbox.dataset.filterKey;
        const count = records.filter(record => matches(record, selected, key) &&
          (key === null ? record.unset : record.tags.get(key)?.has(checkbox.value))).length;
        checkbox.disabled = !count && !checkbox.checked;
        checkbox.parentElement.querySelector('[data-facet-count]').textContent = `(${count})`;
      }
      for (const key of rangeKeys) {
        const range = rangeOf(key), count = records.filter(record => matches(record, selected, key) && [...(record.tags.get(key) || [])].some(v => FacetRange.number(v) !== null) && FacetRange.matches([...(record.tags.get(key) || [])], range)).length;
        rangeInputs.find(input => input.dataset.rangeKey === key).closest('fieldset').querySelector('[data-range-count]').textContent = `${count}件`;
      }
      const activeRanges = rangeKeys.filter(key => FacetRange.active(rangeOf(key))).length;
      section.querySelector('[data-selected]').textContent = `選択 ${selected.length + activeRanges}`;
      section.querySelector('[data-result]').textContent = `${visible} / ${records.length}件`;
      section.querySelector('[data-empty]').hidden = visible !== 0;
      for (const button of section.querySelectorAll('[data-clear]')) button.disabled = !search.value && !selected.length && !activeRanges;
      for (const group of section.querySelectorAll('[data-year-group]')) group.hidden = ![...group.querySelectorAll('[data-record]')].some(node => !node.hidden);
      for (const group of section.querySelectorAll('[data-era-group]')) group.hidden = ![...group.querySelectorAll('[data-year-group]')].some(node => !node.hidden);
    }
    function clear() {
      search.value = '';
      checkboxes.forEach(checkbox => { checkbox.checked = false; });
      rangeInputs.forEach(input => { input.value = ''; });
      if (navSearch && current === section) navSearch.value = '';
      update();
    }
    search.addEventListener('input', update);
    checkboxes.forEach(checkbox => checkbox.addEventListener('change', update));
    rangeInputs.forEach(input => input.addEventListener('change', update));
    section.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => { clear(); search.focus(); }));
    catalogs.set(section, {clear, search});
    update();
  }
  // 詳細はカードの中で開かず、ダイアログで全文を出す。カードの大きさを崩さない。
  const dialog = document.createElement('dialog');
  dialog.className = 'entry-dialog'; dialog.setAttribute('aria-labelledby', 'entry-dialog-title');
  document.body.append(dialog);
  let opener = null;
  // from: 図から開いたときのリンク。閉じるとそこへ戻る。
  function showEntry(card, from = null) {
    const bar = document.createElement('div'); bar.className = 'entry-dialog-bar';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = from ? '閉じて図に戻る' : '閉じる';
    close.addEventListener('click', () => dialog.close()); bar.append(close);
    const parts = [bar];
    const picture = card.querySelector('img.entry-image');
    if (picture) { const full = picture.cloneNode(); full.className = 'entry-dialog-image'; full.loading = 'eager'; parts.push(full); }
    if (card.matches('.organization-card')) {
      const org = card.cloneNode(true); org.removeAttribute('id'); org.querySelector('h3').id = 'entry-dialog-title';
      parts.push(org);
    } else {
      const head = card.querySelector('.card-head').cloneNode(true);
      head.querySelector('h3').id = 'entry-dialog-title';
      for (const empty of head.querySelectorAll('.reading:empty, .description:empty, .unset-slot:empty')) empty.remove();
      parts.push(head);
      const body = card.querySelector('.entry-body')?.cloneNode(true);
      if (body) { body.querySelector('.back-link')?.remove(); parts.push(body); }
    }
    dialog.replaceChildren(...parts);
    opener = from || card.querySelector('.entry-detail > summary');
    if (!dialog.open) dialog.showModal();
    close.focus();
  }
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
    // 詳細の中のリンクで別の分類へ移るときは、ダイアログを閉じてから移る。
    else if (event.target.closest('a[href^="#"]')) { opener = null; dialog.close(); }
  });
  // 図の中のリンクは分類のタブを移らず、その場で詳細を出す。閉じれば図の同じ位置に戻る。
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-diagram] a');
    const href = link?.getAttribute('href') || '';
    if (!href.startsWith('#')) return;
    let card;
    try { card = document.getElementById(decodeURIComponent(href.slice(1))); } catch (_) { return; }
    if (!card?.matches('[data-record], .organization-card')) return;
    event.preventDefault(); event.stopPropagation();
    showEntry(card, link);
  }, true);
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({preventScroll: true}); opener = null; });
  document.addEventListener('click', event => {
    const summary = event.target.closest('.entry-detail > summary');
    if (!summary) return;
    event.preventDefault(); showEntry(summary.closest('[data-record]'));
  });
  // カードの大きさ（小・中・大）。保存はしない。
  const sizes = [...document.querySelectorAll('[data-card-size]')];
  sizes.forEach(button => button.addEventListener('click', () => {
    document.documentElement.dataset.cardSize = button.dataset.cardSize;
    sizes.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  }));

  // Hash links work without JS. With JS, reveal filtered cross-link targets.
  function revealHash(focus) {
    let key;
    try { key = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
    const target = document.getElementById(key);
    if (!target) return;
    const panel = target.closest('[data-panel]');
    if (panel) showPanel(panel);
    if (target === panel) { window.scrollTo(0, 0); return; }
    const section = target.closest('[data-catalog]');
    if (target.matches('[data-record]')) {
      if (target.hidden) catalogs.get(section)?.clear();
      if (target.querySelector('[data-entry-detail]')) showEntry(target);
    }
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    }
    if (focus && target.matches('[data-record], .organization-card')) {
      target.setAttribute('tabindex', '-1');
      target.focus({preventScroll: true});
    }
    target.scrollIntoView({block: 'start'});
  }
  window.addEventListener('hashchange', () => revealHash(true));
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link && link.hash === location.hash) revealHash(true);
  });
  if (location.hash) revealHash(false);
  if (!current && panels.length) showPanel(panels[0]);
  // 上の検索は、開いている分類の検索欄へそのまま渡す。
  navSearch?.addEventListener('input', () => {
    const catalog = current && catalogs.get(current); if (!catalog) return;
    catalog.search.value = navSearch.value; catalog.search.dispatchEvent(new Event('input'));
  });
  // 狭い画面では、一覧を先に見せるため絞り込みを閉じて始める。
  if (window.matchMedia && !window.matchMedia('(min-width: 1000px)').matches) document.querySelectorAll('.tag-filter').forEach(d => { d.open = false; });
  // 固定のナビの高さを測り、絞り込みの列の固定位置に使う（折り返しで高さが変わるため）。
  const nav = document.querySelector('.site-nav');
  if (nav && typeof ResizeObserver === 'function') new ResizeObserver(() => document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px')).observe(nav);

  for (const figure of document.querySelectorAll('[data-diagram]')) {
    const canvas = figure.querySelector('.diagram-canvas');
    const viewport = figure.querySelector('.diagram-viewport');
    const output = figure.querySelector('[data-zoom-value]');
    let scale = 1;
    const buttons = [...figure.querySelectorAll('[data-zoom]')];
    function zoom(action) {
      scale = action === 'reset' ? 1 : Math.max(1, Math.min(4, scale + (action === 'in' ? 0.25 : -0.25)));
      canvas.style.width = `${scale * 100}%`;
      output.textContent = `${Math.round(scale * 100)}%`;
      buttons.find(button => button.dataset.zoom === 'out').disabled = scale === 1;
      buttons.find(button => button.dataset.zoom === 'in').disabled = scale === 4;
      if (action === 'reset') { viewport.scrollLeft = 0; viewport.scrollTop = 0; }
    }
    buttons.forEach(button => button.addEventListener('click', () => zoom(button.dataset.zoom)));
    viewport.addEventListener('keydown', event => {
      if (event.target !== viewport || event.altKey || event.metaKey) return;
      if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        zoom(event.key === '0' ? 'reset' : event.key === '-' ? 'out' : 'in');
      }
    });
    zoom('reset');
  }
  document.querySelectorAll('[data-tools]').forEach(node => { node.hidden = false; });
})();
