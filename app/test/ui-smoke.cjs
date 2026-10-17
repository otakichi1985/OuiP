// 開発用の実Electron確認。通常データ・起動中のウィンドウには触れない。
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { once } = require('node:events');
async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // 自分がspawnしたPIDの子だけを対象にする。既存開発版は名前で停止しない。
  await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, timeout:8000}, () => resolve()));
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([once(child, 'close'), new Promise((_, reject) => setTimeout(() => reject(Error('owned Electron did not stop: ' + child.pid)), 3000))]);
  }
}
const { Store } = require("../lib/store");
function testPNG() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), end = Buffer.alloc(4);
    size.writeUInt32BE(data.length); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, end]);
  };
  const width=120,height=80,header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;pixels[i]=108;pixels[i+1]=196;pixels[i+2]=180;pixels[i+3]=255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", require("node:zlib").deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

// Serialized into the owned renderer for optional screenshots only.
async function screenshotView(action, name) {
  const $ = id => document.getElementById(id);
  const assert = (ok, message) => { if (!ok) throw Error('capture ' + name + ': ' + message); };
  const graphView = name === 'graph' || name === 'graph-node' || name === 'light-graph';
  const visible = el => {
    if (!el || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
  };
  if (action === 'save') {
    assert(!window.__ouipCaptureSession, 'capture already active');
    window.__ouipCaptureSession = {
      page, bookTab, kind, q, cur, statsEditor, penMode, imageEdit, imageDrag, freeGraphConnect,
      diagrams: {...selectedDiagram},
      queries: structuredClone(tabQueries), filters: structuredClone(sel),
      facetStates: new Map(viewState.opens),
      boardOpen: !$('wspanel').hidden, boardMode: BoardShareUI.state.mode, bsel, linking, lsel,
      nodes: ['drawer', 'viewer'].map(id => ({ id, children: [...$(id).childNodes], className: $(id).className, hidden: $(id).hidden, scrollTop: $(id).scrollTop })),
      veilHidden: $('veil').hidden, noticeHidden: $('update-notice').hidden, scrollX, scrollY
    };
    return;
  }
  if (action === 'restore') {
    const saved = window.__ouipCaptureSession;
    if (!saved) return;
    $('veil').hidden = true; imageEdit = null; imageDrag = null;
    // Restore original DOM nodes, retaining draft values/listeners and the final editor shot.
    ({ page, bookTab, kind, q, cur, statsEditor, penMode, bsel, linking, lsel } = saved);
    for (const [target, source] of [[tabQueries, saved.queries], [sel, saved.filters]]) {
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, source);
    }
    Object.assign(selectedDiagram, saved.diagrams); freeGraphConnect = saved.freeGraphConnect;
    $('facets').replaceChildren();
    viewState.opens.clear(); saved.facetStates.forEach((value, key) => viewState.opens.set(key, value));
    $('q').value = q; render();
    BoardShareUI.close(); toggleBoard(saved.boardOpen);
    if (saved.boardMode === 'presentation') BoardShareUI.setPresentation(true);
    else if (saved.boardMode === 'expanded') BoardShareUI.setExpanded(true);
    for (const node of saved.nodes) {
      $(node.id).replaceChildren(...node.children);
      $(node.id).className = node.className; $(node.id).hidden = node.hidden;
      $(node.id).scrollTop = node.scrollTop;
    }
    imageEdit = saved.imageEdit; imageDrag = saved.imageDrag;
    $('veil').hidden = saved.veilHidden; $('update-notice').hidden = saved.noticeHidden;
    scrollTo(saved.scrollX, saved.scrollY); delete window.__ouipCaptureSession;
    return;
  }
  if (action === 'prepare') {
    await writes.idle(); await timelineController.waitForSave();
    OuipTheme.set(name.startsWith('light') ? 'light' : 'dark'); OuipTheme.setAccent(name === 'appearance' ? 'indigo' : 'celadon'); OuipTheme.setBase(name === 'appearance' ? 'kinari' : 'sumikon'); paintThemeChoice(); $('theme-menu').open = false;
    // Clear test-owned transient UI, never stored entries/graphs/board data.
    $('veil').hidden = true; $('viewer').replaceChildren();
    $('viewer').classList.remove('image-editor'); $('viewer').scrollTop = 0;
    imageEdit = null; imageDrag = null; statsEditor = null; cur = null;
    $('drawer').hidden = true; $('drawer').replaceChildren();
    $('drawer').classList.remove('editor-expanded'); $('drawer').scrollTop = 0;
    BoardShareUI.close(); toggleBoard(false);
    bsel = null; linking = null; lsel = null; bdrag = null;
    ndrag = null; pan = null; penStart = null; penMode = false; freeGraphDrag = null; freeGraphConnect = null; timelineController.clearDrag();
    clearTimeout(toast.h); $('toast').hidden = true; $('update-notice').hidden = true;
    page = name === 'header' || name === 'image' || name === 'appearance' ? 'world' : 'book';
    const tab = name === 'timeline' ? '出来事' : name === 'map' ? 'maps' : graphView || name === 'organization' ? 'graphs' : '人物';
    assert(document.documentElement.dataset.theme === (name.startsWith('light') ? 'light' : 'dark'), 'capture theme not applied');
    selectBookTab(tab); q = ''; tabQueries[tab] = ''; sel[tab] = {}; $('q').value = '';
    if (graphView) {
      const graph = S.world.graphs.find(g => g.format === 'free' && g.nodes.length >= 2 && g.edges.length);
      assert(graph, 'missing populated free diagram'); selectedDiagram.graphs = graph.id;
    }
    if (name === 'map') {
      const map = S.world.maps.find(m => m.image) || S.world.maps[0];
      assert(map, 'missing map'); selectedDiagram.maps = map.id;
    }
    if (name === 'organization') {
      const graph = S.world.graphs.find(g => g.format !== 'free' && g.groupDisplay === 'frames' && g.organizationIds?.length);
      assert(graph, 'missing legacy organization frame'); selectedDiagram.graphs = graph.id;
    }
    if (name === 'empty') { q = '一致しない撮影用の言葉'; tabQueries[tab] = q; $('q').value = q; }
    render(); scrollTo(0, 0);
    if (name === 'tags' || name === 'tags-closed') {
      const group = $('facets').querySelector('details');
      assert(group, 'missing tag filters'); group.open = name === 'tags';
    }
    if (name === 'organization') {
      const graph = activeDiagram('graphs');
      Object.assign(camera('graphs:' + graph.id), organizationCameraFit(graph));
      applyCamera(document.querySelector('#bookbody svg[data-camera]'));
      document.querySelector('[data-organization-node]').focus({preventScroll:true});
    }
    if (name === 'graph-node') {
      const node = document.querySelector('[data-free-node]'); assert(node, 'missing free node');
      node.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
      assert($('free-node-form'), 'node editor did not open');
    }
    if (name === 'image') { assert(S.world.image, 'missing overview image'); await editImage(S.world.image, async () => {}); }
    if (name === 'appearance') $('theme-menu').open = true;
    await document.fonts.ready;
    for (const img of [...document.images].filter(visible)) {
      if (!img.complete || !img.naturalWidth) await img.decode();
      assert(img.complete && img.naturalWidth > 0, 'image not decoded: ' + img.src);
    }
    // Main harness shows inactive/disables throttling before requesting frames.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 220)); // existing 180ms entrance animation
  }
  assert($('drawer').hidden && cur === null && statsEditor === null, 'drawer/editor remains open');
  assert($('wspanel').hidden && !BoardShareUI.state.readOnly && !BoardShareUI.state.busy && !bsel && !linking && !lsel, 'board state remains active');
  assert(!document.querySelector('#viewer #graph-arrange-form'), 'stale alignment modal');
  const image = name === 'image', modal = image || name === 'graph-node';
  assert($('veil').hidden === !modal && Boolean(imageEdit) === image, 'unexpected modal/image state');
  assert(page === (name === 'header' || name === 'appearance' || image ? 'world' : 'book'), 'wrong page: ' + page);
  assert(document.querySelector('[data-page][aria-current="page"]')?.dataset.page === page, 'selected page mismatch');
  let marker;
  if (name === 'timeline' || name === 'map' || name === 'empty' || name === 'light' || graphView || name === 'organization' || name === 'tags' || name === 'tags-closed') {
    const tab = name === 'timeline' ? '出来事' : name === 'map' ? 'maps' : name.startsWith('tags') || name === 'empty' || name === 'light' ? '人物' : 'graphs';
    assert(bookTab === tab && visible($('p-book')) && !visible($('p-world')), 'wrong book tab: ' + bookTab);
    const selected = $('booktabs').querySelector('[aria-selected="true"]');
    assert(selected && (selected.dataset.kind || selected.dataset.bookTab) === tab, 'selected tab mismatch');
    marker = name.startsWith('tags') || name === 'light' ? $('facets') : name === 'empty' ? document.querySelector('#bookbody .empty-state') : name === 'map' ? document.querySelector('#bookbody svg[data-camera^="maps:"]') : name === 'timeline' ? document.querySelector('#bookbody .timeline-layout') : name === 'graph-node' ? $('free-node-form') : document.querySelector(name === 'organization' ? '#bookbody .organization-graph svg[data-camera]' : '#bookbody svg.free-graph[data-camera^="graphs:"]');
    if (name === 'organization') {
      const frames = [...document.querySelectorAll('[data-organization-frame] text')];
      const nodes = [...document.querySelectorAll('[data-node]')];
      assert(frames.length && nodes.length, 'legacy heading/node fixture absent');
      for (const label of frames) {
        const l = label.getBoundingClientRect();
        for (const node of nodes) {
          const n = node.getBoundingClientRect();
          assert(l.right <= n.left || n.right <= l.left || l.bottom + 2 <= n.top || n.bottom <= l.top, 'organization heading overlaps node');
        }
      }
    }
    if (graphView) assert(document.querySelector('#bookbody [data-free-node]'), 'free diagram nodes not rendered');
    if(name==='graph-node') {
      const form=$('free-node-form'),submit=form.querySelector('[type=submit]'),r=submit.getBoundingClientRect();
      assert(r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,'free node decision outside viewport');
      assert($('viewer').scrollWidth<=$('viewer').clientWidth+1,'free node modal horizontally overflows');
    }
  } else {
    assert(visible($('p-world')) && !visible($('p-book')), 'overview not rendered');
    if (image) {
      assert($('viewer').classList.contains('image-editor') && $('image-editor-form') && imageEdit.image.naturalWidth > 0, 'image editor not rendered');
      marker = $('image-canvas');
    } else if (name === 'appearance') {
      assert($('theme-menu').open && document.querySelector('[data-accent-choice="indigo"]').getAttribute('aria-pressed') === 'true', 'appearance menu not open with indigo');
      marker = $('theme-menu').querySelector('.menu-pop');
    } else marker = $('world-image').querySelector('img');
  }
  assert(visible(marker), 'requested view marker not rendered');
  const r = marker.getBoundingClientRect();
  assert(r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight, 'view marker outside viewport');
  const x = (Math.max(0, r.left) + Math.min(r.right, innerWidth)) / 2;
  const y = (Math.max(0, r.top) + Math.min(r.bottom, innerHeight)) / 2;
  const front = document.elementFromPoint(x, y);
  assert(front && (front === marker || marker.contains(front) || front.contains(marker)), 'view marker occluded: ' + JSON.stringify({point:[x,y],marker:[r.x,r.y,r.width,r.height],front:front?.outerHTML?.slice(0,220)}));
  return { requested: name, page, bookTab, modal: image ? 'image-editor' : name === 'graph-node' ? 'free-node-form' : 'none', marker: marker.id || marker.tagName, viewport: [innerWidth, innerHeight], visibility: document.visibilityState };
}

// Runs in the generated main harness, after (and outside) all smoke stages.
async function captureViews(w, execute, rendererSource, artifactBase) {
  const fs = require('node:fs/promises');
  const { createHash } = require('node:crypto');
  const names = ['tags', 'tags-closed', 'empty', 'light', 'light-graph', 'appearance', 'timeline', 'map', 'graph', 'graph-node', 'organization', 'header', 'image'];
  const hashes = new Map();
  const bounded = async (label, fn) => {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(label + ' timed out')), 6500);
      })]);
    } finally { clearTimeout(timer); }
  };
  const view = (action, name) => execute('(' + rendererSource + ')(' + JSON.stringify(action) + ',' + JSON.stringify(name) + ')');
  const focused = w.isFocused();
  const backgroundThrottling = w.webContents.getBackgroundThrottling();
  try {
    // Windows' windowsHide and occlusion can leave capturePage with an old compositor frame.
    // Never focus()/show()/restore(): showInactive plus non-focusable is test-window-only.
    w.webContents.setBackgroundThrottling(false);
    if (!w.isVisible() || w.isMinimized()) w.showInactive();
    console.log('CAPTURE WINDOW: ' + JSON.stringify({ visible: w.isVisible(), focused: w.isFocused(), previouslyFocused: focused, focusable: w.isFocusable() }));
    await bounded('capture save', () => view('save'));
    for (const name of names) {
      const output = artifactBase + '-' + name + '.png';
      try {
        // Remove only this run's named optional output so an old file cannot masquerade as success.
        await fs.rm(output, { force: true });
        const info = await bounded(name + ' prepare/paint', () => view('prepare', name));
        if (name === 'tags') {
          await execute(`document.querySelector('#facets summary').focus()`);
          for (const keyCode of ['Enter', 'Space']) {
            const before = await execute(`document.querySelector('#facets details').open`);
            w.webContents.sendInputEvent({type:'keyDown',keyCode});
            w.webContents.sendInputEvent({type:'char',keyCode:keyCode === 'Enter' ? '\r' : ' '});
            w.webContents.sendInputEvent({type:'keyUp',keyCode});
            await new Promise(r => setTimeout(r, 80));
            const after = await execute(`document.querySelector('#facets details').open`);
            if (after === before) throw Error('native tag disclosure key failed: ' + keyCode);
          }
          console.log('PASS: tag disclosure native Enter/Space keyboard toggle');
        }
        console.log('CAPTURE VIEW: ' + JSON.stringify(info));
        // Discard a priming capture: acquire compositor/capturer activity before the evidence frame.
        await bounded(name + ' prime compositor', () => w.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true }));
        let accepted = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          await bounded(name + ' repaint', async () => {
            await execute('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
            await new Promise(r => setTimeout(r, 80));
          });
          const before = await bounded(name + ' pre-capture assertion', () => view('assert', name));
          const img = await bounded(name + ' capturePage', () => w.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true }));
          const after = await bounded(name + ' post-capture assertion', () => view('assert', name));
          if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('rendered view changed during capture');
          if (img.isEmpty()) throw Error('empty capture');
          const png = img.toPNG(), size = img.getSize();
          const hash = createHash('sha256').update(img.toBitmap()).digest('hex');
          const duplicate = hashes.get(hash);
          if (duplicate) {
            console.warn('CAPTURE RETRY: ' + name + ' duplicates ' + duplicate + '; attempt=' + attempt + '; sha256=' + hash);
            continue;
          }
          if (!size.width || !size.height || png.length < 8) throw Error('invalid screenshot dimensions/PNG');
          await fs.writeFile(output, png); hashes.set(hash, name); accepted = true;
          console.log('CAPTURE: ' + JSON.stringify({ ...after, output, size, bytes: png.length, bitmapSHA256: hash, attempt }));
          break;
        }
        if (!accepted) throw Error('screenshot identical to another requested view after 3 paints');
      } catch (e) {
        console.error('CAPTURE FAILED: ' + name + ': ' + e.stack);
        try { const debug = await w.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true }); await fs.writeFile(artifactBase + '-' + name + '-failed.png', debug.toPNG()); }
        catch (debugError) { console.error('CAPTURE DEBUG FAILED: ' + debugError.message); }
      }
    }
    if (hashes.size !== names.length) console.error('CAPTURE FAILED: distinct outputs=' + hashes.size + '/' + names.length);
    else console.log('CAPTURE SUMMARY: distinct outputs=' + hashes.size + '/' + names.length);
    const savedSize = w.getContentSize(), savedZoom = w.webContents.getZoomFactor();
    try {
      for (const [width,height,zoom] of [[2560,1300,1],[1280,860,1.5],[720,520,1.5]]) {
        w.setContentSize(width,height); w.webContents.setZoomFactor(zoom);
        await execute(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await execute(`(() => {
          const c=$('image-canvas'),stage=c.closest('.image-stage'),apply=$('image-apply');
          resizeImageFrame();
          const r=c.getBoundingClientRect(),s=stage.getBoundingClientRect(),a=apply.getBoundingClientRect();
          if(a.top<0||a.bottom>innerHeight||a.right>innerWidth||r.height<10||r.width<10||r.top<s.top||r.bottom>s.bottom+1||$('viewer').scrollWidth>$('viewer').clientWidth+1)throw Error('image frame/actions overflow '+JSON.stringify({viewport:[innerWidth,innerHeight],apply:[a.x,a.y,a.width,a.height],frame:[r.x,r.y,r.width,r.height],stage:[s.x,s.y,s.width,s.height]}));
          c.focus(); window.__imageKeyX=imageEdit.x;
        })()`);
        w.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'}); w.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
        await new Promise(r=>setTimeout(r,100));
        await execute(`if(imageEdit.x!==window.__imageKeyX+10)throw Error('native image arrow movement failed')`);
        await w.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true});
        const frame=await w.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true});
        await fs.writeFile(artifactBase+'-image-'+width+'x'+height+'-zoom'+Math.round(zoom*100)+'.png',frame.toPNG());
        console.log('IMAGE LAYOUT PASS: '+JSON.stringify({width,height,zoom,nativeArrow:true}));
      }
    } finally { w.webContents.setZoomFactor(savedZoom); w.setContentSize(...savedSize); }
  } catch (e) {
    console.error('CAPTURE FAILED: harness: ' + e.stack);
  } finally {
    try { await bounded('capture restore', () => view('restore')); }
    catch (e) { console.error('CAPTURE FAILED: restore: ' + e.stack); }
    w.webContents.setBackgroundThrottling(backgroundThrottling);
  }
}

// 旧人物/組織連動図の生成・一括整列・pen・人物relf編集は廃止。
// 図固有の自由ノードの実フォーム/IPCを検証。scenarioFileへ単独serialize可能。
async function freeGraphScenario() {
  const $ = id => document.getElementById(id);
  const check = (ok, message) => { if (!ok) throw Error('free graph: ' + message); };
  const click = query => { const el = document.querySelector(query); check(el, 'missing ' + query); if(typeof el.click==='function')el.click();else el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); };
  const until = async (test, label) => {
    const deadline = Date.now() + 3000;
    while (!test()) {
      const error = document.querySelector('#viewer .operation-error');
      if (error) throw Error(label + ': ' + error.textContent);
      check(Date.now() < deadline, 'timeout ' + label);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  const submit = async id => { const form = $(id); check(form, id); form.requestSubmit(); await until(() => $('veil').hidden && !form.dataset.submitting, id); };
  const graph = async id => (await ouip.load()).world.graphs.find(g => g.id === id);
  const select = id => { $('diagram-select').value = id; $('diagram-select').dispatchEvent(new Event('change', {bubbles:true})); };
  const appearance = (text, color, writing) => { $('free-text').value = text; $('free-color').value = color; $('free-writing').value = writing; };
  const activate = id => document.querySelector(`[data-free-node="${id}"]`).dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
  click('[data-book-tab="graphs"]');
  const legacySource = (await ouip.load()).world.graphs.find(g => g.format !== 'free');
  check(legacySource?.members.length, 'initial legacy diagram exists');
  const organizationWorld = await ouip.updateWorld({organization:{name:'旧図ドラッグ検証組織'}});
  const organizationId = organizationWorld.organizations.find(o=>o.name==='旧図ドラッグ検証組織').id;
  const legacyPerson = S.entries.find(e=>e.id===legacySource.members[0]);
  await ouip.saveEntry({...legacyPerson,organizationIds:[...new Set([...(legacyPerson.organizationIds || []),organizationId])]});
  const legacy = await ouip.saveDiagram('graphs',{id:legacySource.id,organizationIds:[...(legacySource.organizationIds || []),organizationId],groupDisplay:'frames',positions:{[organizationId]:[100,80]},relations:[...legacySource.relations,{a:legacySource.members[0],b:organizationId,label:'所属',style:'friend'}]});
  await refresh(); select(legacy.id);
  const checkHeadings = () => {
    const labels = [...document.querySelectorAll('[data-organization-frame] text')];
    check(labels.length, 'legacy frame headings exist');
    for (const label of labels) {
      const l=label.getBoundingClientRect();
      for (const node of document.querySelectorAll('[data-node]')) {
        const n=node.getBoundingClientRect();
        check(l.right<=n.left || n.right<=l.left || l.bottom+2<=n.top || n.bottom<=l.top,'legacy heading clear of nodes, including during drag');
      }
    }
  };
  checkHeadings();
  check($('bookbody').textContent.includes('位置はドラッグで変更できます') && !document.querySelector('[data-pen],[data-free-add-node],[data-graph-arrange]'), 'legacy view allows positions but not content editing');
  const oldNodes = [...document.querySelectorAll('[data-node][data-which="rel"]')];
  check(oldNodes.length, 'legacy nodes exist for drag regression');
  for (const [index, oldNode] of oldNodes.entries()) {
    const before = await graph(legacy.id), nodeId = oldNode.dataset.node;
    const transform = oldNode.getAttribute('transform'), capture = oldNode.setPointerCapture;
    const rect = oldNode.getBoundingClientRect(), pointer = {clientX:rect.x+10, clientY:rect.y+10, pointerId:61+index, button:0, bubbles:true};
    const end = {...pointer, clientX:pointer.clientX+60, clientY:pointer.clientY+30};
    // 合成pointerのcaptureだけ模擬し、取消・実IPC保存・再描画を確認。
    oldNode.setPointerCapture = () => {};
    try {
      oldNode.dispatchEvent(new PointerEvent('pointerdown', pointer));
      document.dispatchEvent(new PointerEvent('pointermove', end));
      check(oldNode.getAttribute('transform') !== transform, 'legacy node follows drag');
      checkHeadings();
      document.dispatchEvent(new PointerEvent('pointercancel', end));
      check(oldNode.getAttribute('transform') === transform, 'legacy cancellation restores position');
      checkHeadings();
      check(JSON.stringify(await graph(legacy.id)) === JSON.stringify(before), 'legacy cancellation does not write');
      oldNode.dispatchEvent(new PointerEvent('pointerdown', pointer));
      document.dispatchEvent(new PointerEvent('pointermove', end));
      document.dispatchEvent(new PointerEvent('pointerup', end));
      await writes.idle();
      const after = await graph(legacy.id);
      check(JSON.stringify(after.positions[nodeId]) !== JSON.stringify(before.positions[nodeId]), 'legacy drag persists position');
      const expected = {...before, positions:{...before.positions, [nodeId]:after.positions[nodeId]}};
      const canonical = value => JSON.stringify(value, (_key,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
      check(canonical(after) === canonical(expected), 'legacy drag changes only the selected position: ' + JSON.stringify({before,after}));
    } finally {
      document.dispatchEvent(new PointerEvent('pointercancel', pointer));
      oldNode.setPointerCapture = capture;
    }
  }
  const movedLegacy = await graph(legacy.id);
  await refresh();
  checkHeadings();
  for (const [nodeId, point] of Object.entries(movedLegacy.positions)) {
    const node = document.querySelector(`[data-node="${nodeId}"][data-which="rel"]`);
    if (node) check(node.getAttribute('transform') === `translate(${point[0]},${point[1]})`, 'legacy position survives refresh');
  }
  const original = JSON.stringify(movedLegacy);
  click('[data-free-clone]');
  await until(() => activeDiagram('graphs')?.format === 'free', 'clone');
  const cloneId = $('diagram-select').value, clone = await graph(cloneId);
  check(clone.id !== legacy.id && clone.nodes.length === new Set([...(legacy.members || []), ...(legacy.organizationIds || [])]).size && clone.edges.length === legacy.relations.length, 'clone retains nodes and edges in a new diagram');
  check(clone.nodes.every(n => !S.entries.some(e => e.id === n.id)), 'clone node IDs independent of character IDs');
  if (clone.nodes.length) {
    activate(clone.nodes[0].id); appearance('複製だけを編集', '#aabbcc', 'vertical'); await submit('free-node-form');
  }
  check(JSON.stringify(await graph(legacy.id)) === original, 'editing clone does not mutate legacy source');
  const cloneSnapshot=JSON.stringify(await graph(cloneId));
  click('[data-new-diagram="graphs"]'); $('free-diagram-name').value = '自由ノード試験図'; await submit('free-diagram-form');
  const id = $('diagram-select').value;
  check((await graph(id)).format === 'free' && !(await graph(id)).nodes.length, 'new diagram starts empty, not from characters');
  check((await graph(id)).grid.visible && (await graph(id)).grid.snap && (await graph(id)).grid.size === 30, 'grid defaults visible/snap/30');
  {
    check(document.querySelectorAll('header .nav button > svg.icon').length === 3 && ['site-export-btn','save-btn','hist-btn','update-btn'].every(id => $(id).querySelector(':scope > svg.icon')), 'landmark icons sit beside the header labels');
    {
      const menu = $('theme-menu'), pick = choice => { menu.open = true; document.querySelector(`[data-theme-choice="${choice}"]`).click(); };
      const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      pick('light');
      check(document.documentElement.dataset.theme === 'light' && token('--bg') === '#f5f6f8' && document.querySelector('[data-theme-choice="light"]').getAttribute('aria-pressed') === 'true' && !menu.open, 'appearance menu switches to light, marks the choice and closes');
      check(localStorage.getItem('ouip.theme') === 'light' && OuipTheme.read() === 'light', 'light choice is remembered on this device');
      pick('dark');
      check(document.documentElement.dataset.theme === 'dark' && token('--bg') === '#0f1115' && document.querySelector('[data-theme-choice="dark"]').getAttribute('aria-pressed') === 'true', 'appearance menu switches back to dark');
      menu.open = true; document.querySelector('[data-accent-choice="indigo"]').click();
      check(!document.documentElement.hasAttribute('aria-pressed') && menu.open && token('--accent') === '#7fb2ff' && document.querySelector('[data-accent-choice="indigo"]').getAttribute('aria-pressed') === 'true' && localStorage.getItem('ouip.accent') === 'indigo', 'accent swatch applies the dark value, stays open and is remembered');
      pick('light'); check(token('--accent') === '#1f5bd0' && document.querySelector('[data-accent-choice="indigo"] .swatch').style.getPropertyValue('--sw') === '#1f5bd0', 'light uses its own accent value and the swatches follow');
      menu.open = true; const custom = document.querySelector('[data-accent-custom]'); custom.value = '#ff0000'; custom.dispatchEvent(new Event('input', {bubbles:true}));
      check(token('--accent') === OuipTheme.accentFor('#ff0000', 'light').accent && document.querySelector('.accent-custom').dataset.selected === 'true' && OuipTheme.contrast(token('--accent'), '#ffffff') >= 4.5, 'custom accent is adjusted to stay readable');
      menu.open = true; document.querySelector('[data-base-choice="kinari"]').click();
      check(menu.open && token('--bg') === OuipTheme.baseOf('kinari').light.bg && document.documentElement.dataset.base === 'kinari' && document.querySelector('[data-base-choice="kinari"]').getAttribute('aria-pressed') === 'true' && localStorage.getItem('ouip.base') === 'kinari', 'base color applies the light value, stays open and is remembered');
      pick('dark'); check(token('--bg') === OuipTheme.baseOf('kinari').dark.bg && OuipTheme.contrast(token('--accent'), token('--surface')) >= 4.5, 'dark uses the base dark value and the accent stays readable on it');
      menu.open = true; document.querySelector('[data-base-choice="sumikon"]').click();
      check(!document.documentElement.style.getPropertyValue('--bg') && token('--bg') === '#0f1115', 'default base falls back to the stylesheet');
      document.querySelector('[data-accent-choice="celadon"]').click(); pick('dark');
      check(!document.documentElement.style.getPropertyValue('--accent') && token('--accent') === '#5fd0bb', 'default accent falls back to the stylesheet');
      menu.open = false;
    }
    check([...document.querySelectorAll('#booktabs [role="tab"]')].every(tab => tab.querySelector(':scope > svg.icon') && tab.textContent.trim()), 'every settings tab has an icon and a text label');
    check($('booktabs').scrollWidth <= $('booktabs').clientWidth + 1, 'settings tabs with icons fit without sideways scrolling');
    const bar = document.querySelector('.diagram-toolbar');
    check(bar.querySelector('#diagram-select') && bar.querySelector('[data-new-diagram="graphs"]') && bar.querySelector('details.menu [data-delete-diagram]') && !bar.querySelector('[data-free-add-node],[data-camera-reset],[data-graph-grid]'), 'outside the canvas only diagram choice, new diagram and the diagram menu remain');
    const pop = bar.querySelector('details.menu .menu-pop');
    check(pop.lastElementChild.matches('[data-delete-diagram]') && pop.lastElementChild.previousElementSibling.matches('hr'), 'delete is last in the menu, separated from benign actions');
    const vis = document.querySelector('.canvas-stage > .vis').getBoundingClientRect();
    const edit = document.querySelector('.canvas-stage > .canvas-edit'), view = document.querySelector('.canvas-stage > .canvas-view');
    const inside = r => r.left >= vis.left && r.right <= vis.right + 1 && r.top >= vis.top && r.bottom <= vis.bottom + 1;
    check(edit?.querySelector('[data-free-add-node]') && edit.querySelector('[data-free-connect]') && inside(edit.getBoundingClientRect()) && edit.getBoundingClientRect().top - vis.top < 20 && edit.getBoundingClientRect().left - vis.left < 20, 'edit tools overlay the canvas top-left');
    check(view?.querySelector('[data-camera-reset]') && view.querySelector('details.menu [data-graph-grid]') && inside(view.getBoundingClientRect()) && vis.right - view.getBoundingClientRect().right < 20 && vis.bottom - view.getBoundingClientRect().bottom < 20, 'view tools overlay the canvas bottom-right');
    check(document.querySelector('.canvas-hint'), 'hint shows while the diagram is empty');
    const menu = bar.querySelector('details.menu'); menu.open = true;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    check(!menu.open, 'diagram menu closes when pressing outside');
    const display = view.querySelector('details.menu'); display.open = true;
    const grid = display.querySelector('[data-graph-grid]'); grid.checked = false; grid.dispatchEvent(new Event('change', { bubbles: true }));
    await writes.idle(); check(!(await graph(id)).grid.visible, 'grid hidden saved');
    await refresh();
    check(document.querySelector('.canvas-view details.menu')?.open && !document.querySelector('.canvas-view [data-graph-grid]').checked, 'display settings stay open while adjusting the grid');
    const again = document.querySelector('.canvas-view [data-graph-grid]'); again.checked = true; again.dispatchEvent(new Event('change', { bubbles: true }));
    await writes.idle(); check((await graph(id)).grid.visible, 'grid shown saved');
    await refresh(); document.querySelector('.canvas-view details.menu').open = false;
  }
  for (const [text,color,writing,x,y] of [['独立ノード甲','#c48060','horizontal',180,180],['独立ノード乙','#6080c4','vertical',660,300]]) {
    click('[data-free-add-node]'); appearance(text,color,writing); $('free-x').value=x; $('free-y').value=y; await submit('free-node-form');
  }
  let saved = await graph(id); const [a,b] = saved.nodes.map(n => n.id);
  check(saved.nodes.length === 2 && saved.nodes.every(n => !S.entries.some(e => e.id === n.id)), 'two manually added nodes independent of character IDs');
  check(saved.nodes[0].color === '#c48060' && saved.nodes[0].writing === 'horizontal' && saved.nodes[1].writing === 'vertical', 'node appearance saved');
  const nodeSelector = n => `[data-free-node="${n}"]`;
  const edgeSelector = e => `[data-free-edge="${e}"]`;
  const assertRendered = (selector, text, color, writing) => {
    const el = document.querySelector(selector); check(el && el.textContent.includes(text), 'saved text rendered');
    check(el.style.getPropertyValue(selector.includes('edge') ? '--edge-color' : '--node-color') === color, 'saved color rendered');
    check([...el.querySelectorAll('text')].every(t => (t.style.writingMode === 'vertical-rl') === (writing === 'vertical')), 'writing direction rendered');
  };
  assertRendered(nodeSelector(a), '独立ノード甲', '#c48060', 'horizontal');
  assertRendered(nodeSelector(b), '独立ノード乙', '#6080c4', 'vertical');
  activate(a); check($('free-color').value === '#c48060' && $('free-writing').value === 'horizontal', 'node appearance reopens');
  appearance('取消した文字','#ffffff','vertical'); click('#free-node-form [data-vclose]');
  check(JSON.stringify(await graph(id)) === JSON.stringify(saved), 'node cancel does not write');
  activate(a); appearance('編集した甲','#c46080','vertical'); await submit('free-node-form');
  activate(a); check($('free-text').value === '編集した甲' && $('free-writing').value === 'vertical' && $('free-color').value === '#c46080', 'edited node reopens'); click('#free-node-form [data-vclose]');
  check(!document.querySelector('.canvas-hint'), 'hint disappears once the diagram has nodes');
  click('[data-free-add-edge]'); $('free-a').value=a; $('free-b').value=b;
  appearance('手動の接続','#80c460','vertical'); $('free-direction').value='both'; await submit('free-edge-form');
  const edge = (await graph(id)).edges[0];
  check(edge.a === a && edge.b === b && edge.direction === 'both' && edge.writing === 'vertical' && edge.color === '#80c460', 'edge endpoints/appearance/direction saved');
  assertRendered(edgeSelector(edge.id), '手動の接続', '#80c460', 'vertical');
  check(document.querySelector(edgeSelector(edge.id)+' .free-edge-line').hasAttribute('marker-start'), 'both-direction arrowheads rendered');
  click(edgeSelector(edge.id));
  check($('free-a').value === a && $('free-b').value === b && $('free-direction').value === 'both' && $('free-writing').value === 'vertical' && $('free-color').value === '#80c460', 'edge form reopens saved appearance');
  appearance('取消する線','#ffffff','horizontal'); $('free-direction').value='none'; click('#free-edge-form [data-vclose]');
  check(JSON.stringify((await graph(id)).edges[0]) === JSON.stringify(edge), 'edge cancel does not write');
  for (const direction of ['none','forward']) {
    click(edgeSelector(edge.id)); appearance('編集した接続','#cc8844','horizontal'); $('free-direction').value=direction; await submit('free-edge-form');
    const line = document.querySelector(edgeSelector(edge.id)+' .free-edge-line');
    check((await graph(id)).edges[0].direction === direction && line.hasAttribute('marker-end') === (direction === 'forward') && !line.hasAttribute('marker-start'), 'edge direction saved/rendered: '+direction);
  }
  check(document.querySelector(edgeSelector(edge.id)+' .free-edge-leader, '+edgeSelector(edge.id)+' .free-edge-reference'),'label linked to its own line by a leader or reference');
  click('[data-free-add-edge]');$('free-a').value=a;$('free-b').value=a;appearance('失敗後も残る入力','#88aa99','horizontal');
  const retryForm=$('free-edge-form');retryForm.requestSubmit();
  for(let i=0;i<100&&!retryForm.querySelector('.operation-error');i++)await new Promise(r=>setTimeout(r,20));
  check(retryForm.querySelector('.operation-error')&&!retryForm.querySelector('[type=submit]').disabled&&$('free-text').value==='失敗後も残る入力','invalid edge preserves input and enables retry');
  check((await graph(id)).edges.length===1,'invalid edge does not write');$('free-b').value=b;
  retryForm.requestSubmit();retryForm.requestSubmit();
  $('free-text').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(!$('veil').hidden,'Escape cannot close a submitting graph form');
  await until(()=>$('veil').hidden&&!retryForm.dataset.submitting,'edge retry');
  const retryEdge=(await graph(id)).edges.find(e=>e.text==='失敗後も残る入力');
  check(retryEdge&&(await graph(id)).edges.length===2,'retry saves exactly one edge after double submit');
  click(`[data-free-edit-edge="${retryEdge.id}"]`);click('[data-free-delete-edge]');click('[data-free-delete-edge]');await until(()=>$('veil').hidden,'delete retry edge');
  click('[data-free-connect]');activate(a);activate(b);
  check($('free-edge-form')&&$('free-a').value===a&&$('free-b').value===b,'two selected nodes prefill directed edge endpoints');click('#free-edge-form [data-vclose]');
  for (const [selector,value] of [['[data-graph-grid-size]','50'],['[data-graph-grid]',false],['[data-graph-snap]',false]]) {
    const control = document.querySelector(selector); check(control, selector);
    if (typeof value === 'boolean') control.checked=value; else control.value=value;
    control.dispatchEvent(new Event('change',{bubbles:true})); await writes.idle();
  }
  saved=await graph(id);
  check(!saved.grid.visible && !saved.grid.snap && saved.grid.size === 50 && !document.querySelector('[data-graph-grid-background]'), 'grid/snap explicit off saved/rendered');
  const drag = async (dx,dy,pointerId) => {
    const svg=document.querySelector('svg.free-graph'); svg.scrollIntoView({block:'center'});
    // 合成pointerだけcaptureを模擬。captureの所有者はノードではなくSVG。
    const capture=svg.setPointerCapture; svg.setPointerCapture=()=>{};
    try {
      const rect=document.querySelector(nodeSelector(a)+' rect'), r=rect.getBoundingClientRect();
      const p={clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId,bubbles:true,button:0};
      const before=JSON.stringify((await graph(id)).nodes);
      rect.dispatchEvent(new PointerEvent('pointerdown',p));
      svg.dispatchEvent(new PointerEvent('pointermove',{...p,clientX:p.clientX+1}));
      check(freeGraphDrag && !freeGraphDrag.moved, 'sub-threshold movement leaves node in place');
      check(JSON.stringify((await graph(id)).nodes) === before, 'tiny movement does not write');
      const end={...p,clientX:p.clientX+dx,clientY:p.clientY+dy};
      for(let i=2;i<=5;i++) svg.dispatchEvent(new PointerEvent('pointermove',{...p,clientX:p.clientX+dx*i/5,clientY:p.clientY+dy*i/5}));
      svg.dispatchEvent(new PointerEvent('pointerup',end));
    } finally {
      if (freeGraphDrag?.pointer===pointerId) svg.dispatchEvent(new PointerEvent('pointercancel',{pointerId,bubbles:true}));
      svg.setPointerCapture=capture;
    }
  };
  await drag(43,21,72);
  // 移動の保存中に矢印を編集。古いnodesで上書きしないことを確認。
  click(edgeSelector(edge.id)); $('free-text').value='移動直後の接続'; const pendingForm=$('free-edge-form'); pendingForm.requestSubmit();
  await writes.idle(); const afterDrag=(await graph(id)).nodes.find(n=>n.id===a);
  await until(() => $('veil').hidden && !pendingForm.dataset.submitting, 'edge after drag');
  check(afterDrag.x !== saved.nodes[0].x || afterDrag.y !== saved.nodes[0].y, 'grid off cumulative drag persisted');
  check(JSON.stringify((await graph(id)).nodes.find(n=>n.id===a)) === JSON.stringify(afterDrag), 'edge save preserves pending node position');
  assertRendered(edgeSelector(edge.id),'移動直後の接続','#cc8844','horizontal');
  const toggleSnap = async enabled => { const c=document.querySelector('[data-graph-snap]'); c.checked=enabled; c.dispatchEvent(new Event('change',{bubbles:true})); await writes.idle(); check((await graph(id)).grid.snap===enabled,'snap setting persists'); };
  await toggleSnap(true); await drag(37,23,73); click('#save-btn'); await writes.idle();
  const snapped=(await graph(id)).nodes.find(n=>n.id===a);
  check(snapped.x%50===0 && snapped.y%50===0, 'drag snaps and immediate history save waits for node write');
  await toggleSnap(false);
  const dragSvg=document.querySelector('svg.free-graph'), zoomBefore=dragSvg.getAttribute('viewBox');
  // 図の上では通常のホイールで拡大縮小し、ページはスクロールしない。
  const wheel=new WheelEvent('wheel',{deltaY:-100,clientX:300,clientY:300,bubbles:true,cancelable:true}); dragSvg.dispatchEvent(wheel);
  check(wheel.defaultPrevented && dragSvg.getAttribute('viewBox')!==zoomBefore,'free graph wheel zoom');
  const pinch=dragSvg.getAttribute('viewBox');
  dragSvg.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,clientX:300,clientY:300,bubbles:true,cancelable:true}));
  check(dragSvg.getAttribute('viewBox')!==pinch,'Ctrl/pinch free graph wheel zoom still works');
  // 同じ座標へ追加しても文字の箱を重ねない。
  click('[data-free-add-node]'); appearance('重なり回避','#8899aa','horizontal'); $('free-x').value=snapped.x; $('free-y').value=snapped.y; await submit('free-node-form');
  const third=(await graph(id)).nodes.find(n=>n.id!==a && n.id!==b);
  check(third.x!==snapped.x || third.y!==snapped.y, 'overlapping input was moved to a vacant position in storage');
  const boxes=[...document.querySelectorAll('[data-free-node] > rect')].map(r=>({x:+r.getAttribute('x'),y:+r.getAttribute('y'),w:+r.getAttribute('width'),h:+r.getAttribute('height')}));
  check(boxes.length===3 && boxes.every((r,i)=>boxes.slice(i+1).every(s=>r.x+r.w<=s.x || s.x+s.w<=r.x || r.y+r.h<=s.y || s.y+s.h<=r.y)), 'stored/rendered node boxes do not overlap');
  click('[data-free-add-edge]'); $('free-a').value=third.id; $('free-b').value=b; appearance('削除対象の接続','#8899aa','horizontal'); await submit('free-edge-form');
  activate(third.id); click('[data-free-delete-node]'); check((await graph(id)).nodes.length===3, 'node deletion requires confirmation'); click('[data-free-delete-node]');
  await until(()=>$('veil').hidden,'delete node');
  const afterDelete=await graph(id);
  check(afterDelete.nodes.length===2 && afterDelete.edges.length===1 && afterDelete.edges.every(e=>e.a!==third.id && e.b!==third.id),'node deletion removes incident edges, preserving unrelated edge');
  click(edgeSelector(edge.id)); click('[data-free-delete-edge]'); check((await graph(id)).edges.length===1,'edge deletion requires confirmation'); click('[data-free-delete-edge]');
  await until(()=>$('veil').hidden,'delete edge'); check(!(await graph(id)).edges.length && !document.querySelector('[data-free-edge]'),'edge deleted and redrawn');
  // 撮影/以後の独立性stage用に接続を一つ残す。
  click('[data-free-add-edge]'); $('free-a').value=a; $('free-b').value=b; appearance('図固有の接続','#cc8844','horizontal'); await submit('free-edge-form');
  const beforeRename=await graph(id);
  click('[data-edit-diagram="graphs"]'); $('free-diagram-name').value='取消する図名'; click('#free-diagram-form [data-vclose]');
  check(JSON.stringify(await graph(id))===JSON.stringify(beforeRename),'diagram name cancel does not write');
  click('[data-edit-diagram="graphs"]'); $('free-diagram-name').value='自由ノード試験図・改名'; await submit('free-diagram-form');
  click('#save-btn'); await writes.idle();
  await until(() => $('dirty').querySelector('.save-done > svg.icon') && $('dirty').textContent.includes('保存しました'), 'saved mark beside the save button');
  select(legacy.id); select(id); await refresh();
  check((await graph(id)).name==='自由ノード試験図・改名' && JSON.stringify((await graph(id)).nodes)===JSON.stringify(beforeRename.nodes),'diagram rename/reselect/refresh preserves coordinates');
  check(!document.querySelector('[data-pen],[data-all-members],[data-add-diagram-member]') && $('q').hidden && $('facets').hidden,'free diagram has no retired character-linked controls');
  assertRendered(nodeSelector(a),'編集した甲','#c46080','vertical');
  check(!document.querySelector('[data-graph-grid]').checked && !document.querySelector('[data-graph-snap]').checked && document.querySelector('[data-graph-grid-size]').value==='50','grid settings reopen after switching diagrams');
  const reopenedEdge=(await graph(id)).edges[0]; click(edgeSelector(reopenedEdge.id));
  check($('free-writing').value==='horizontal' && $('free-color').value==='#cc8844' && $('free-direction').value==='forward','horizontal edge appearance survives diagram reopen'); click('#free-edge-form [data-vclose]');
  check(JSON.stringify(await graph(legacy.id))===original,'legacy remains unchanged through free CRUD');
  check(JSON.stringify(await graph(cloneId))===cloneSnapshot, 'free CRUD leaves the separate clone unchanged');
  console.log('smoke: free graph CRUD/appearance/grid/drag passed');
  return id;
}

async function scenario() {
  console.log('smoke: start');
  const $ = (id) => document.getElementById(id);
  const click = (query) => { const b = document.querySelector(query); if (!b) throw Error("missing: " + query); b.click(); };
  const wait = () => new Promise((r) => setTimeout(r, 350));
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const state = await ouip.load();
  console.log('smoke: loaded');
  check($("world-image").querySelector("img"), "world image");
  await Promise.race([$("world-image").querySelector("img").decode(), new Promise((r)=>setTimeout(r,1200))]);
  console.log('smoke: world decoded');
  // 表示側で再トリミングせず、保存画像の比率を維持する。
  const worldImage = $('world-image').querySelector('img'), originalSource = worldImage.src;
  const originalBodyWidth = document.body.style.width;
  for (const bodyWidth of ['', '680px']) {
    document.body.style.width = bodyWidth;
    for (const [width, height] of [[40, 400], [400, 40]]) {
      const sample = document.createElement('canvas'); sample.width = width; sample.height = height;
      sample.getContext('2d').fillRect(0, 0, width, height);
      worldImage.src = sample.toDataURL(); await worldImage.decode();
      const frame = worldImage.getBoundingClientRect(), box = $('world-image').getBoundingClientRect();
      check(frame.width <= box.width + 1, 'overview image stays within width');
      check(Math.abs(frame.width/frame.height-width/height)<.01,'overview preserves saved aspect ratio');
    }
  }
  document.body.style.width = originalBodyWidth;
  worldImage.src = originalSource;
  scrollTo(0,0);
  click('[data-worldimage-clear]'); await wait();
  console.log('smoke: world cleared');
  check(!(await ouip.load()).world.image, "world image clear");
  click('[data-worldimage]'); await wait();
  console.log('smoke: world selected');
  check($('image-ratio').value === '3' && Math.abs($('image-canvas').width/$('image-canvas').height-3)<.02, 'overview picker defaults to header frame');
  check(!(await ouip.load()).world.image, 'overview picker does not apply before decision');
  click('[data-vclose]'); await wait();
  check(!(await ouip.load()).world.image, 'overview picker cancellation keeps previous image');
  click('[data-worldimage]'); await wait();
  $('image-ratio').value='0.75'; $('image-ratio').dispatchEvent(new Event('change',{bubbles:true}));
  $('image-editor-form').requestSubmit();
  for(let i=0;i<20 && !$('veil').hidden;i++) await wait();
  const pickedWorld=(await ouip.load()).world.image;
  check(pickedWorld && pickedWorld!==state.world.image,'overview picker applies adjusted image');
  click('[data-adjust-world]'); await wait();
  check($('image-ratio').value==='original' && Math.abs($('image-canvas').width/$('image-canvas').height-.75)<.01,'overview reopens chosen ratio instead of header default');
  click('[data-vclose]'); await wait();
  {
    // 概要: 件数と未定を1画面目に出す。広い画面は右の列に固定し未定は列の中でスクロール、狭い画面は最初の5件と「すべて表示」。
    const realEntries = S.entries;
    S.entries = [...realEntries, ...Array.from({length: 14}, (_, i) => ({id:'c-open'+i, kind:'人物', name:'未定確認'+i, fields:[{key:'本名', open:true, no:900+i}]}))];
    renderWorld(); window.scrollTo(0, 0);
    const counts = $('counts').getBoundingClientRect(), opens = $('opens').getBoundingClientRect(), firstOpen = $('opens').querySelector('li').getBoundingClientRect();
    check(counts.top >= 0 && counts.bottom <= innerHeight && firstOpen.bottom <= innerHeight, 'overview shows counts and open items on the first screen');
    if (innerWidth >= 1000) {
      check(counts.left > $('w-title').getBoundingClientRect().right && opens.bottom <= innerHeight + 1 && $('opens').scrollHeight > $('opens').clientHeight && $('opens-more').getClientRects().length === 0, 'wide overview keeps counts and open items in a fixed right column that scrolls inside');
    } else {
      const shown = [...$('opens').querySelectorAll('li')].filter(li => li.getClientRects().length).length;
      check(shown === 5 && $('opens-more').getClientRects().length > 0 && $('opens-more').textContent.includes('すべて表示'), 'narrow overview shows first five open items and a show-all button');
      click('#opens-more'); check([...$('opens').querySelectorAll('li')].filter(li => li.getClientRects().length).length > 5, 'show-all reveals every open item');
      click('#opens-more');
    }
    S.entries = realEntries; renderWorld();
  }
  click('[data-page="book"]');
  console.log('smoke: book');
  const facets = () => $('facets').querySelector('details');
  // 狭い画面では、一覧を先に見せるため絞り込みを閉じて始める（開閉はその後も覚える）。
  if (innerWidth < 1000) { check(facets() && !facets().open, 'narrow window starts with filters folded'); click('#facets summary'); }
  check(facets()?.open && facets().querySelector('summary').textContent === 'タグで絞り込み', 'tag filter has expanded native disclosure');
  click('#facets [data-fc="未定"][data-fv="なし"]');
  const filteredIds = () => [...document.querySelectorAll('#bookbody [data-drag]')].map(el => el.dataset.drag).join('/');
  const idsBeforeFold = filteredIds(), expandedHeight = $('facets').getBoundingClientRect().height;
  click('#facets summary');
  // refreshを直後に発生させ、非同期toggleの前でも開閉を失わない。
  await refresh();
  check(!facets().open && $('facets').getBoundingClientRect().height < expandedHeight && filteredIds() === idsBeforeFold, 'fold hides filters without changing results across immediate refresh');
  check(facets().querySelector('summary').textContent.includes('選択中 1'), 'closed filter indicates active selection');
  check(!document.querySelector('#facets [data-fv="なし"]').checkVisibility(), 'closed filter buttons are not visible');
  click('[data-kind="用語"]');
  check(facets().open === (innerWidth >= 1000), 'term disclosure independent from character (wide opens, narrow starts folded)');
  if (!facets().open) click('#facets summary');
  click('#facets summary'); click('[data-kind="人物"]');
  check(!facets().open, 'character fold survives tab switch');
  click('#facets summary');
  check(document.querySelector('#facets [data-fv="なし"]').getAttribute('aria-pressed') === 'true', 'reopen preserves selected tag');
  click('#facets [data-fc=""]');
  check(!facets().querySelector('.facet-selection') && sel.人物.未定.size === 0, 'filter clear removes selected count and conditions');
  click('[data-kind="用語"]'); check(!facets().open, 'term fold survives tab switch');
  click('#facets summary'); click('[data-kind="人物"]');
  $('q').value = '一致しないタグ折りたたみ試験'; $('q').dispatchEvent(new Event('input', {bubbles:true}));
  check(document.querySelector('#bookbody .empty') && facets().open, 'zero results keep disclosure and filters available');
  { const empty = document.querySelector('#bookbody .empty-state'); check(empty?.querySelector('.empty-mark > svg.icon') && empty.querySelector('.empty-title')?.textContent.includes('条件に合う') && empty.querySelector('.empty-actions [data-clear-search]'), 'zero results use the shared empty state with mark, title and the clear action'); }
  click('[data-clear-search]');
  {
    // 一覧をスクロールしても、種類のタブ・検索・大きさ・追加と（広い画面では）絞り込みが見えたまま残る。
    const filler = Array.from({length: 24}, (_, i) => ({id:'c-scroll'+i, kind:'人物', name:'スクロール確認'+i, tags:{}}));
    const realEntries = S.entries; S.entries = [...realEntries, ...filler]; renderBook();
    const heights = size => { click(`[data-card-size="${size}"]`); return [...new Set([...document.querySelectorAll('#bookbody .en')].map(el => Math.round(el.getBoundingClientRect().height)))]; };
    for (const size of ['small', 'large', 'medium']) { const h = heights(size); check(h.length === 1, `cards share one height (${size}): ${h}`); }
    check(document.querySelector('[data-card-size="medium"]').getAttribute('aria-pressed') === 'true' && document.querySelector('#bookbody .entries').dataset.cardSize === 'medium', 'card size choice shown');
    window.scrollTo(0, 900); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const topBottom = document.querySelector('.top').getBoundingClientRect().bottom, tabs = $('booktabs').getBoundingClientRect(), search = $('q').getBoundingClientRect(), add = $('addentry').getBoundingClientRect();
    check(scrollY > 300 && tabs.top >= topBottom - 1 && tabs.bottom < innerHeight && search.top > 0 && search.bottom < innerHeight && add.top > 0, 'toolbar stays visible while the list scrolls');
    if (innerWidth >= 1000) { const f = $('facets').getBoundingClientRect(); check(f.top > 0 && f.top < innerHeight / 2 && f.left < $('bookbody').getBoundingClientRect().left, 'filter column stays on the left while scrolling'); }
    window.scrollTo(0, 0); S.entries = realEntries; renderBook();
  }
  click('#addentry');
  check([...document.querySelectorAll('#booktabs [role="tab"]')].slice(0,3).map(b => b.textContent.replace(/\d/g,'')).join('/') === 'キャラ/組織/関係図', 'character/organization/graph navigation grouped');
  check(document.querySelector('[data-addtag]').textContent.includes('タグ追加'), 'tag action label');
  check([...document.querySelectorAll("[data-tk]")].map((i) => i.value).join("/") === "年齢/身長/性別/所属/身分", "default tags");
  click('[data-tagpreset="体重"]');
  check(document.querySelector('[data-tagpreset="体重"]').disabled, "preset disabled");
  const gender = [...document.querySelectorAll("[data-trow]")].find((r) => r.querySelector("[data-tk]").value === "性別");
  gender.querySelector('[data-tagvalue="女性"]').click();
  check(gender.querySelector("[data-tv]").value === "女性", "value picker");
  document.querySelector('[data-trow] [data-rmtag]').click();
  check(!document.querySelector('[data-tagpreset="年齢"]').disabled, "removed tag available");
  click('[data-addsection]');
  document.querySelector('[data-section-title]').value = "生い立ち";
  document.querySelector('[data-section-text]').value = "一行目\n二行目";
  $('f-name').value = "新しい人物";
  $('f-reading').value = 'あたらしいじんぶつ';
  click('[data-image-control="image"] [data-pick-character="image"]'); await wait();
  const originalCharacterImage = $('f-image').value;
  click('[data-image-control="image"] [data-adjust-image]'); await wait();
  check(!$('image-apply').disabled, 'image adjustment applies without crop mode');
  click('[data-image-zoom="in"]');
  const applyRect = $('image-apply').getBoundingClientRect();
  check(applyRect.width > 0 && applyRect.top >= 0 && applyRect.bottom <= innerHeight, 'image apply reachable at current viewport');
  $('image-editor-form').requestSubmit();
  for (let i=0;i<20 && !$('veil').hidden;i++) await wait();
  check($('veil').hidden && $('f-image').value !== originalCharacterImage && $('f-name').value === '新しい人物' && $('f-reading').value === 'あたらしいじんぶつ', 'character adjusted image changes draft only and preserves input');
  const tagGroup = $('f-tags').closest('details'), draftTag = gender.querySelector('[data-tv]');
  tagGroup.querySelector('summary').click();
  check(!tagGroup.open && gender.querySelector('[data-tv]') === draftTag && draftTag.value === '女性' && $('f-name').value === '新しい人物', 'folding preserves exact unsaved tag DOM and input');
  tagGroup.querySelector('summary').click();
  click('[data-editor-expand]');
  check($('drawer').classList.contains('editor-expanded') && $('f-name').value === '新しい人物','expand preserves input');
  click('[data-editor-expand]');
  $('ef').requestSubmit(); await wait();
  const person = (await ouip.load()).entries.find((e) => e.name === "新しい人物");
  check(person.reading === 'あたらしいじんぶつ' && document.querySelector(`[data-drag="${person.id}"] .name-reading`).textContent === person.reading,'reading saved/displayed');
  check(person.sections[0].text === "一行目\n二行目" && person.tags.体重 && !('年齢' in person.tags), "saved sections/tags");
  check(document.querySelector('[data-detail-group="section-0"]').textContent.includes('生い立ち'), "detail section");
  const folded = document.querySelector('[data-detail-group="section-0"]');
  folded.open = false; await wait();
  check(!folded.open, 'detail section collapses');
  click('[data-edit]');
  $('f-desc').value = '拡大後も保持';
  const body = $('drawer').querySelector('.drawer-body'); body.scrollTop = body.scrollHeight;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.width > 0; };
  check(visible(document.querySelector('[data-editor-expand]')) && visible($('ef').querySelector('[type="submit"]')), 'editor expand/decision remain visible at bottom');
  click('[data-editor-expand]');
  check($('drawer').getBoundingClientRect().width >= document.documentElement.clientWidth - 1 && $('f-desc').value === '拡大後も保持', 'existing character edit expands full width without losing input: ' + $('drawer').getBoundingClientRect().width + '/' + document.documentElement.clientWidth);
  const weightRow = [...document.querySelectorAll('[data-trow]')].find(r => r.querySelector('[data-tk]').value === '体重');
  weightRow.querySelector('[data-tv]').value = '50'; weightRow.querySelector('[data-tag-unit]').value = 'kg'; weightRow.querySelector('[data-tag-position]').value = 'above';
  $('ef').requestSubmit(); await wait();
  check((await ouip.load()).entries.find(e => e.id === person.id).tagPositions.体重 === 'above', 'tag placement persists');
  const weightText = () => document.querySelector(`[data-drag="${person.id}"] .card-tags-above`).textContent;
  check(weightText().includes('体重') && weightText().includes('50kg') && !weightText().includes('kgkg'), 'numeric weight/card label/position uses kg once');
  click('[data-edit]');
  const reopenedWeight = [...document.querySelectorAll('[data-trow]')].find(r => r.querySelector('[data-tk]').value === '体重');
  check(reopenedWeight.querySelector('[data-tv]').value === '50' && reopenedWeight.querySelector('[data-tag-unit]').value === 'kg', 'numeric weight and kg reopen separately');
  reopenedWeight.querySelector('[data-tag-unit]').value = 'lb'; $('ef').requestSubmit(); await wait();
  check(weightText().includes('50lb') && !weightText().includes('50kg'), 'selecting lb changes suffix without converting numeric value');
  click('[data-edit]');
  const poundRow = [...document.querySelectorAll('[data-trow]')].find(r => r.querySelector('[data-tk]').value === '体重');
  check(poundRow.querySelector('[data-tv]').value === '50' && poundRow.querySelector('[data-tag-unit]').value === 'lb', 'lb unit saved and reopens');
  $('ef').requestSubmit(); await wait();
  const weighted = (await ouip.load()).entries.find(e => e.id === person.id);
  check(weighted.tags.体重[0] === '50' && weighted.tagUnits.体重 === 'lb', 'numeric value and selected unit saved through IPC');
  const legacyWeight = await ouip.saveEntry({kind:'人物',name:'旧単位つき体重',tags:{体重:['50kg']},tagUnits:{体重:'kg'}}); await refresh();
  const legacyWeightText = document.querySelector(`[data-drag="${legacyWeight.id}"]`).textContent;
  check(legacyWeightText.includes('50kg') && !legacyWeightText.includes('50kgkg'), 'legacy suffix is not duplicated on card');
  await wait(); check(!document.querySelector('[data-detail-group="section-0"]').open, 'detail collapsed state survives edit/save');
  click('[data-editor-expand]');
  click('[data-close]');
  // 数値変更・任意表記併記・未定への戻しを実フォーム/IPC/再表示で確認。
  click('[data-kind="出来事"]'); click('#addentry');
  $('f-name').value = '年表の確認'; $('f-year').value = '123'; $('f-ylabel').value = '転機';
  $('ef').requestSubmit(); await wait();
  const timelineEntry = (await ouip.load()).entries.find(e => e.name === '年表の確認');
  check(timelineEntry.year.n === 123, 'timeline number saved');
  check(document.querySelector('.tl .year-number').textContent.includes('123年') && document.querySelector('.tl .year-label').textContent === '転機', 'timeline number and label visible');
  click('[data-edit]'); $('f-year').value = '456'; $('ef').requestSubmit(); await wait();
  check((await ouip.load()).entries.find(e => e.id === timelineEntry.id).year.n === 456 && document.querySelector('.tl .year-number').textContent.includes('456年'), 'timeline number change reflected');
  click('[data-edit]'); $('f-year').value = ''; $('ef').requestSubmit(); await wait();
  check((await ouip.load()).entries.find(e => e.id === timelineEntry.id).year.n === null && document.querySelector('.tl .year-number').textContent === '年 未定', 'timeline cleared to unknown');
  click('[data-edit]'); $('f-desc').value = '未定のまま説明を編集'; $('ef').requestSubmit(); await wait();
  check((await ouip.load()).entries.find(e => e.id === timelineEntry.id).year.n === null, 'timeline unknown survives edit');
  click('[data-edit]'); $('f-year').value = '0'; $('ef').requestSubmit(); await wait();
  check((await ouip.load()).entries.find(e => e.id === timelineEntry.id).year.n === 0 && document.querySelector('.tl .year-number').textContent.includes('0年'), 'timeline zero year');
  click('[data-close]'); click('[data-kind="人物"]');
  check($('wspanel').hidden && document.querySelector('.en').draggable === false, "no board auto open");
  const event = new Event('dragstart', { bubbles: true, cancelable: true });
  event.dataTransfer = { setData() {}, effectAllowed: "" };
  document.querySelector('.en').dispatchEvent(event);
  check($('wspanel').hidden && event.defaultPrevented, "drag must not open board");
  click('[data-book-tab="graphs"]');
  check($('bookview').hidden && !$('booktabs').querySelector('[data-view="相関図"]'), 'graph is independent tab');
  console.log('smoke: first graph');
  // 旧図の人物アイコン表示は閲覧互換として維持（新自由ノードへは継承しない）。
  check(document.querySelector('.nd image').getAttribute('href').includes(state.entries.find((e) => e.icon).icon), "legacy read-only graph icon");
  click('[data-kind="用語"]');
  const termImage=document.querySelector('.en img');
  await wait();
  // 既に描画済みの同じURLへ再度decode()するとElectronでは待機し続ける場合がある。
  if(!termImage.complete || !termImage.naturalWidth) await Promise.race([termImage.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('term image decode timed out: '+termImage.src)),3000))]);
  check(termImage.complete && termImage.naturalWidth>0,'term image rendered');
  click('[data-entry]'); click('[data-edit]');
  check($('f-image') && !$('f-icon'), "term image edit");
  click('[data-clear-character="image"]');
  click('[data-pick-character="image"]'); await wait();
  check($('f-image').value === state.world.image, "term picker handler");
  click('#drawer [data-entry]'); click('[data-close]');
  click('[data-book-tab="maps"]');
  check(bookTab === 'maps' && !document.querySelector('#bookview button') && $('facets').hidden && $('q').hidden, 'map is its own tab without the small view switch');
  if (innerWidth >= 1000) { const mapBox = document.querySelector('#bookbody .vis svg').getBoundingClientRect(); check(mapBox.bottom <= innerHeight + 1 && mapBox.top > 0, 'map fits in the window so the whole map is visible without page scroll'); }
  console.log('smoke: first map');
  const background = document.querySelector('.map-background');
  click('[data-place]'); await wait();
  check(background === document.querySelector('.map-background'), "pin placement recreated background");
  const pin = document.querySelector('[data-node][data-which="geo"]');
  // 合成PointerEventにはOSのポインターがないので、captureだけ模擬する。
  pin.setPointerCapture = () => {};
  const rect = pin.getBoundingClientRect();
  const point = {clientX:rect.left+10,clientY:rect.top+10,pointerId:1,bubbles:true};
  pin.dispatchEvent(new PointerEvent('pointerdown', point));
  pin.dispatchEvent(new PointerEvent('pointermove', {...point, clientX:point.clientX+40, clientY:point.clientY+30}));
  pin.dispatchEvent(new PointerEvent('pointerup', {...point, clientX:point.clientX+40, clientY:point.clientY+30}));
  await wait();
  check(background === document.querySelector('.map-background') && pin === document.querySelector('[data-node][data-which="geo"]'), "drag recreated map");
  const loaded = await ouip.load();
  const moved = loaded.world.maps[0].positions[loaded.entries.find((e) => e.kind === '場所').id];
  check(moved[0] !== 440 || moved[1] !== 325, "pin move not saved");
  // 地図を名前から追加し、独立した配置で切り替える。
  click('[data-new-diagram="maps"]'); $('diagram-name').value = '北方大陸'; $('diagram-form').requestSubmit(); await wait();
  console.log('smoke: map created');
  check(document.querySelectorAll('[data-node][data-which="geo"]').length === 0, 'new map independent');
  check(document.querySelector('.canvas-edit > [data-mapimg].primary') && document.querySelector('.canvas-hint.canvas-hint-corner')?.textContent.includes('背景の画像'), 'map without background offers choosing one on the canvas');
  click('[data-mapimg]'); await wait();
  check((await ouip.load()).world.maps.find(m=>m.name==='北方大陸').image, 'map background');
  check(document.querySelector('.canvas-edit details.menu [data-adjust-map]') && document.querySelector('.canvas-edit details.menu [data-clear-map-image]') && !document.querySelector('.canvas-edit > [data-mapimg]') && document.querySelector('.canvas-view [data-camera-reset]'), 'map background tools gather in one canvas menu');
  click('[data-adjust-map]'); await wait();
  console.log('smoke: image editor');
  $('image-ratio').value='1.6'; $('image-ratio').dispatchEvent(new Event('change',{bubbles:true}));
  click('[data-image-fill]');
  check(imageEdit.base*imageEdit.scale===Math.max(640/imageEdit.image.naturalWidth,400/imageEdit.image.naturalHeight),'image fill');
  click('[data-image-zoom="in"]'); click('[data-image-fit]');
  click('[data-image-trim]');
  const cropCanvas=$('image-canvas'),cropRect=cropCanvas.getBoundingClientRect();cropCanvas.setPointerCapture=()=>{};
  cropCanvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:cropRect.left+30,clientY:cropRect.top+30,pointerId:4,bubbles:true}));
  cropCanvas.dispatchEvent(new PointerEvent('pointermove',{clientX:cropRect.left+130,clientY:cropRect.top+130,pointerId:4,bubbles:true}));
  cropCanvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:4,bubbles:true}));
  check($('image-ratio').value==='custom' && !imageEdit.selectTrim && !$('image-apply').disabled,'crop selection becomes finish frame');
  $('image-editor-form').requestSubmit(); await wait(); await wait();
  for (let i=0;i<20 && !$('veil').hidden;i++) await wait();
  const cropped = (await ouip.load()).world.maps.find(m=>m.name==='北方大陸').image;
  console.log('smoke: image cropped');
  check(cropped !== state.world.image, 'cropped image saved separately');
  const selector = $('diagram-select'); selector.value = loaded.world.maps[0].id; selector.dispatchEvent(new Event('change',{bubbles:true}));
  check(document.querySelectorAll('[data-node][data-which="geo"]').length === 1, 'switch map restores pins');
  {
    // 競合: ピンを動かした直後に背景を解除しても、古い位置でピンを戻さない。
    const mapId = loaded.world.maps[0].id, placeId = loaded.entries.find((e) => e.kind === '場所').id;
    const original = (await ouip.load()).world.maps.find(m => m.id === mapId);
    check(original.image && document.querySelector('[data-clear-map-image]'), 'race fixture map has background');
    const racePin = document.querySelector('[data-node][data-which="geo"]'); racePin.setPointerCapture = () => {};
    const r = racePin.getBoundingClientRect(), from = {clientX:r.left+10,clientY:r.top+10,pointerId:7,bubbles:true}, to = {...from, clientX:from.clientX+50, clientY:from.clientY+20};
    racePin.dispatchEvent(new PointerEvent('pointerdown', from));
    racePin.dispatchEvent(new PointerEvent('pointermove', to));
    racePin.dispatchEvent(new PointerEvent('pointerup', to));
    click('[data-clear-map-image]');
    await writes.idle();
    const raced = (await ouip.load()).world.maps.find(m => m.id === mapId);
    check(raced.image === null && JSON.stringify(raced.positions[placeId]) !== JSON.stringify(original.positions[placeId]), 'pin drag survives immediate background clear: ' + JSON.stringify({before: original.positions[placeId], after: raced.positions[placeId], image: raced.image}));
    await ouip.saveDiagram('maps', { id: mapId, image: original.image }); await refresh();
    check(document.querySelectorAll('[data-node][data-which="geo"]').length === 1, 'race fixture restored');
    // run()経由の書き込みは保存の列に並び、先に入った保存が終わるまで書かない。
    let release; const blocker = writes.write(() => new Promise(resolve => { release = resolve; }));
    click('[data-clear-map-image]'); await wait();
    check((await ouip.load()).world.maps.find(m => m.id === mapId).image === original.image, 'run write waits for earlier queued save');
    release(); await blocker; await writes.idle();
    check((await ouip.load()).world.maps.find(m => m.id === mapId).image === null, 'run write runs after earlier save');
    await ouip.saveDiagram('maps', { id: mapId, image: original.image }); await refresh();
  }
  const svg = document.querySelector('svg[data-camera]'), before = svg.getAttribute('viewBox');
  const plainWheel = new WheelEvent('wheel',{deltaY:-200,clientX:300,clientY:300,bubbles:true,cancelable:true});
  svg.dispatchEvent(plainWheel);
  check(svg.getAttribute('viewBox') !== before && plainWheel.defaultPrevented, 'map wheel zoom');
  const outside = new WheelEvent('wheel',{deltaY:-200,bubbles:true,cancelable:true}); $('bookbody').dispatchEvent(outside);
  check(!outside.defaultPrevented, 'wheel outside canvas remains page scroll');
  await freeGraphScenario();
  const place = await ouip.saveEntry({kind:'場所',name:'タブ移動確認'}); await refresh();
  openEntry(place.id); click('#drawer [data-place]'); await wait();
  check(bookTab === 'maps' && document.querySelector('[data-book-tab="maps"]').getAttribute('aria-selected') === 'true' && document.querySelector('svg[aria-label="地図"]'), 'place from detail selects map tab consistently');
  click('[data-close]'); click('[data-book-tab="graphs"]');
  click('#ws-toggle');
  const board = $('board'), initial=board.style.transform;
  document.querySelector('.boardwrap').dispatchEvent(new WheelEvent('wheel',{deltaY:-200,clientX:1000,clientY:300,bubbles:true,cancelable:true}));
  check(board.style.transform !== initial,'board zoom');
  const wrap=document.querySelector('.boardwrap');wrap.setPointerCapture=()=>{};
  const beforePan=board.style.transform;
  wrap.dispatchEvent(new PointerEvent('pointerdown',{clientX:1000,clientY:400,pointerId:3,bubbles:true}));
  wrap.dispatchEvent(new PointerEvent('pointermove',{clientX:1040,clientY:450,pointerId:3,bubbles:true}));
  wrap.dispatchEvent(new PointerEvent('pointerup',{clientX:1040,clientY:450,pointerId:3,bubbles:true}));
  check(board.style.transform!==beforePan,'board pan');
  // 拡大表示は、ウィンドウいっぱいで編集できる作業用。Escで戻る。
  click('[data-bs-action="expand"]');
  check(BoardShareUI.state.mode==='expanded' && !BoardShareUI.state.readOnly && $('wspanel').classList.contains('bs-expanded') && $('memo-new').getClientRects().length>0,'expanded stays editable');
  const itemsBefore=(await ouip.load()).board.items.length;
  $('memo-new').value='拡大表示のメモ'; $('memo-new').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await writes.idle(); await wait();
  check((await ouip.load()).board.items.length===itemsBefore+1,'expanded can add memo');
  for (let i=0;i<3 && BoardShareUI.state.mode;i++) document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(BoardShareUI.state.mode===null && !$('wspanel').classList.contains('bs-expanded'),'Escape leaves expanded');
  await ouip.saveBoard({items:[{id:'b-share',type:'entry',ref:person.id,x:20,y:20}],links:[]});
  await run(()=>Promise.resolve());
  check(board.querySelector('.bs-reading').textContent===person.reading,'board reading');
  click('[data-bs-action="present"]');
  const presentPanel=$('wspanel');
  check(BoardShareUI.state.readOnly && presentPanel.classList.contains('bs-present') && !presentPanel.classList.contains('bs-expanded') && getComputedStyle(presentPanel.querySelector('.wsh')).display==='none' && getComputedStyle(presentPanel.querySelector('.bs-present-controls')).display!=='none','presentation shows board only');
  click('[data-bs-action="fit"]'); check(board.style.transform.includes('scale('),'presentation fit');
  const snapshot=JSON.stringify((await ouip.load()).board);
  board.querySelector('.bi').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
  board.querySelector('.bi').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
  check(JSON.stringify((await ouip.load()).board)===snapshot && !$('memo-ed'),'presentation blocks editing');
  await BoardShareUI.exportPNG();
  check($('bs-status').textContent.includes('PNG に'),'PNG export IPC');
  click('[data-bs-action="present-end"]');
  check(!BoardShareUI.state.readOnly && BoardShareUI.state.mode===null && !presentPanel.classList.contains('bs-present'),'presentation exits');
  window.confirm=()=>true;
  await BoardShareUI.exportShare();
  const beforeImport=JSON.stringify(await ouip.load());
  await BoardShareUI.importShare();
  for (let i=0;i<20 && !$('viewer').querySelector('.bs-preview img')?.naturalWidth;i++) await wait();
  check(!$('veil').hidden && $('viewer').querySelector('.bs-preview img')?.naturalWidth > 0 && JSON.stringify(await ouip.load())===beforeImport,'incoming board preview renders without writing');
  click('[data-bs-incoming-pick]');
  const memoChoice=document.querySelector('[data-bs-entry][value="memo"]'), skipChoice=document.querySelector('[data-bs-entry][value="skip"]');
  check(memoChoice?.checked && $('viewer').textContent.includes('同じ名前'),'duplicate card defaults to memo');
  skipChoice.checked=true; skipChoice.dispatchEvent(new Event('change',{bubbles:true}));
  check($('bs-incoming-form').querySelector('[type="submit"]').disabled,'nothing selected cannot be added');
  memoChoice.checked=true; memoChoice.dispatchEvent(new Event('change',{bubbles:true}));
  click('[data-bs-incoming-back]'); check($('viewer').querySelector('.bs-preview img'),'back returns to preview');
  click('[data-bs-incoming-pick]'); check(document.querySelector('[data-bs-entry][value="memo"]').checked,'choice survives back');
  $('bs-incoming-form').requestSubmit(); for (let i=0;i<20 && !$('veil').hidden;i++) await wait(); await writes.idle();
  const shared=await ouip.load();
  check(shared.board.items.length===2 && shared.entries.filter(e=>e.name===person.name).length===1 && shared.board.items.some(i=>i.type==='memo' && i.text.startsWith(person.name)),'duplicate imported as memo without a second character');
  check($('veil').hidden && !$('wspanel').hidden && $('bs-status').textContent.includes('追加しました'),'import adds to board and reports');
  click('#update-btn');await wait();
  check($('update-status').textContent.includes('配布版'),'development updater disabled');
  click('[data-vclose]');
  check($('update-notice').hidden,'development has no startup notice');
  UpdatesUI.notice({ current:'0.2.1', supported:true, kind:'available', version:'0.2.2', notes:'- 更新して再起動する処理を改善\n- <script>unsafe</script>' });
  check(!$('update-notice').hidden && $('update-notice').textContent.includes('v0.2.2'),'notice version');
  check(!$('update-notice').querySelector('script'),'notice plain text');
  const noticeRect=$('update-notice').getBoundingClientRect();
  check(noticeRect.width>0 && $('update-notice').scrollWidth <= noticeRect.width+1,'notice layout');
  click('[data-update-dismiss]');
  check($('update-notice').hidden && $('update-btn').textContent==='アプリの更新あり','dismiss keeps update entry');
  UpdatesUI.notice({kind:'error'});
  check(!$('update-notice').hidden && $('update-notice').textContent.includes('再確認'),'offline notice');
  click('[data-update-retry]');await wait();
  check($('update-notice').hidden,'retry unsupported hides notice');
  click('#site-export-btn');
  check($('site-export-form') && !$('veil').hidden,'site export opens');
  check($('site-selection-count').textContent === '選択 0件' && $('site-export-form').querySelector('[type="submit"]').disabled,'site export starts empty');
  click('#site-export-form [data-vclose]');
  check($('veil').hidden,'site export closes');
  // 設定シート: 載せるものを選び、仕上がりを見てから画像で書き出す。保存データは変えない。
  click('[data-kind="人物"]'); openEntry(person.id); click('[data-sheet-export]');
  const sheetImage=()=>$('sheet-pages')?.querySelector('img');
  for (let i=0;i<80 && !sheetImage()?.naturalWidth;i++) await wait();
  check(!$('veil').hidden && sheetImage()?.naturalWidth===1080 && sheetImage().naturalHeight===1350,'sheet preview is exact portrait size');
  const squareSize=document.querySelector('[name="sheet-size"][value="square"]'); squareSize.checked=true; squareSize.dispatchEvent(new Event('change',{bubbles:true}));
  for (let i=0;i<80 && sheetImage()?.naturalHeight!==1080;i++) await wait();
  check(sheetImage()?.naturalWidth===1080 && sheetImage().naturalHeight===1080,'sheet preview follows chosen size');
  const beforeSheet=JSON.stringify(await ouip.load());
  $('sheet-form').requestSubmit(); for (let i=0;i<80 && !$('veil').hidden;i++) await wait();
  check($('veil').hidden && $('toast').textContent.includes('枚を書き出しました') && JSON.stringify(await ouip.load())===beforeSheet,'sheet export saves images without changing data');
  click('[data-close]');
  // 最小ウィンドウ・長文・フォーム末尾でも主要操作は表示領域内。
  click('[data-kind="人物"]'); click(`[data-entry="${person.id}"]`); click('[data-edit]');
  click('[data-editor-expand]');
  $('f-desc').value = '長い説明\n'.repeat(80);
  const editBody = $('drawer').querySelector('.drawer-body'); editBody.scrollTop = editBody.scrollHeight;
  check(visible(document.querySelector('[data-editor-expand]')) && visible($('ef').querySelector('[type="submit"]')), 'editor actions visible at configured window size');
  check($('drawer').scrollWidth <= $('drawer').clientWidth + 1, 'expanded editor no horizontal overflow');
  click('#drawer .editor-toolbar [data-entry]'); click('[data-close]');
  click('[data-book-tab="graphs"]'); click('[data-edit-diagram="graphs"]');
  const graphForm = $('free-diagram-form'), graphBody = graphForm.querySelector('.free-object-body');
  const spacing = document.createElement('div'); spacing.style.height = '1200px'; graphBody.append(spacing);
  graphBody.scrollTop = 0;
  check(visible(graphForm.querySelector('[type="submit"]')) && visible(graphForm.querySelector('[data-vclose]')), 'long free diagram dialog actions visible without scrolling');
  graphBody.scrollTop = graphBody.scrollHeight;
  check(visible(graphForm.querySelector('[type="submit"]')) && visible(graphForm.querySelector('[data-vclose]')), 'long free diagram dialog actions visible at bottom');
  click('#viewer [data-vclose]');
  await featureScenario(person.id);
  click('[data-kind="人物"]'); openEntry(person.id); click('[data-edit]');
  $('drawer').classList.add('editor-expanded');
  $('drawer').querySelector('.drawer-body').scrollTop = 700;
}

// 新機能は独立した段階で失敗を収集し、失敗時もactual mainの撮影/終了経路を通す。
async function featureScenario(personId) {
  const $ = id => document.getElementById(id);
  const click = q => { const el = document.querySelector(q); if (!el) throw Error('missing: ' + q); el.click(); };
  const wait = () => new Promise(r => setTimeout(r, 350));
  const set = (q, value) => { const el = document.querySelector(q); if (!el) throw Error('missing: ' + q); el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
  let failures = 0, orgs = [], graphId;
  const check = (ok, label) => { if (!ok) { failures++; console.error('FEATURE FAILED: ' + label); } else console.log('FEATURE OK: ' + label); };
  const stage = async (label, fn) => {
    console.log('features: ' + label);
    try { await fn(); } catch (e) { failures++; console.error('FEATURE FAILED: ' + label + ': ' + e.stack); }
    $('veil').hidden = true;
    if ($('ef')) { $('drawer').hidden = true; cur = null; }
  };
  await stage('image finish frame / persistence / keyboard / retry', async () => {
    $('drawer').hidden = true; cur = null; page = 'world'; render(); scrollTo(0,0);
    const sample = document.createElement('canvas'); sample.width = 900; sample.height = 600;
    const ctx = sample.getContext('2d');
    ctx.fillStyle = '#222733'; ctx.fillRect(0,0,900,600);
    ctx.fillStyle = '#6cc4b4'; ctx.fillRect(40,40,360,520);
    ctx.fillStyle = '#f0b866'; ctx.fillRect(500,40,360,520);
    ctx.fillStyle = '#12151c'; ctx.font = 'bold 80px sans-serif'; ctx.fillText('L',180,330); ctx.fillText('R',640,330);
    const blob = await new Promise(resolve => sample.toBlob(resolve,'image/png'));
    const source = await ouip.importEditedImage(new Uint8Array(await blob.arrayBuffer()));
    await run(() => ouip.updateWorld({image:source}));
    await editImage(source, async image => { await run(() => ouip.updateWorld({image})); });
    check(!document.querySelector('[data-image-crop]'),'redundant crop switch removed');
    set('#image-ratio','0.75'); click('[data-image-zoom="in"]'); click('[data-image-move="left"]');
    const before = {scale:imageEdit.scale,focusX:($('image-canvas').width/2-imageEdit.x)/(imageEdit.base*imageEdit.scale)};
    set('#image-ratio','3');
    check(imageEdit.scale===before.scale && Math.abs(($('image-canvas').width/2-imageEdit.x)/(imageEdit.base*imageEdit.scale)-before.focusX)<1e-6,'changing frame preserves zoom and subject position');
    set('#image-ratio','0.75');
    const canvas = $('image-canvas'), x = imageEdit.x;
    canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    check(imageEdit.x===x+10,'image keyboard movement');
    const wheel = new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}); canvas.dispatchEvent(wheel);
    check(!wheel.defaultPrevented && imageEdit.scale===before.scale,'ordinary image wheel is not zoom');
    canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true}));
    check(imageEdit.scale>before.scale,'Ctrl image wheel zoom');
    const applyRect=$('image-apply').getBoundingClientRect(), frame=canvas.getBoundingClientRect();
    check(applyRect.bottom<=innerHeight && frame.width>10 && frame.height>10 && Math.abs(frame.width/frame.height-.75)<.01,'finish frame and apply fit viewport');
    $('image-editor-form').requestSubmit();
    for(let i=0;i<20 && !$('veil').hidden;i++) await wait();
    const portrait=(await ouip.load()).world.image;
    check(portrait!==source && $('veil').hidden,'portrait image applied');
    await editImage(portrait,async image => { await run(() => ouip.updateWorld({image})); });
    check(Math.abs($('image-canvas').width/$('image-canvas').height-.75)<.01,'reopening restores saved portrait frame instead of default landscape');
    click('[data-vclose]'); await wait();
    const shown=$('world-image').querySelector('img'); if(!shown.complete || !shown.naturalWidth) await shown.decode();
    const shownRect=shown.getBoundingClientRect();
    check(Math.abs(shownRect.width/shownRect.height-.75)<.01,'overview displays saved portrait ratio');
    // Character edits stay in the form draft until its own decision.
    page='book'; selectBookTab('人物'); render(); openEntry(personId); click('[data-edit]');
    $('f-name').value='新しい人物'; $('f-desc').value='画像調整中の入力';
    await editImage(source,async image => { const control=document.querySelector('[data-image-control="image"]'); control.outerHTML=imageControl('image',image); });
    set('#image-ratio','0.75'); click('[data-image-fill]');
    $('image-editor-form').requestSubmit(); for(let i=0;i<20 && !$('veil').hidden;i++) await wait();
    check($('f-desc').value==='画像調整中の入力','image apply preserves adjacent form input');
    $('ef').requestSubmit(); await wait();
    const entry=(await ouip.load()).entries.find(e=>e.id===personId);
    await refresh();
    const pic=document.querySelector(`[data-entry="${personId}"] .face img`); if(!pic.complete || !pic.naturalWidth) await pic.decode();
    const picRect=pic.getBoundingClientRect(), face=pic.closest('.face').getBoundingClientRect();
    // 一覧のカードは絵の比率に関係なく正方形の枠にそろえ、絵は切らず歪めずに全体を収める。
    check(Math.abs(face.width-face.height)<1 && Math.abs(pic.naturalWidth/pic.naturalHeight-.75)<.01 && getComputedStyle(pic).objectFit==='contain','card frame is square and keeps the saved portrait ratio inside');
    await editImage(entry.image,async()=>{}); check(Math.abs($('image-canvas').width/$('image-canvas').height-.75)<.01,'character adjustment reopens saved ratio'); click('[data-vclose]');
    let attempts=0;
    await editImage(source,async()=>{if(++attempts===1)throw Error('試験用の適用失敗');});
    click('[data-image-zoom="in"]'); const retryScale=imageEdit.scale;
    $('image-editor-form').requestSubmit(); await wait();
    check(!$('veil').hidden && !$('image-apply').disabled && imageEdit.scale===retryScale && !!document.querySelector('#viewer .operation-error'),'apply failure preserves frame and offers retry');
    $('image-editor-form').requestSubmit(); for(let i=0;i<20 && !$('veil').hidden;i++)await wait();
    check($('veil').hidden && attempts===2,'failed image apply can retry');
    await editImage(source,async()=>{},1); check($('image-ratio').disabled && $('image-ratio').value==='1' && !document.querySelector('[data-image-trim]'),'icon frame explicitly fixed square'); click('[data-vclose]');
    $('drawer').hidden=true; cur=null; page='world'; render();
    await editImage(source,async image=>{await run(()=>ouip.updateWorld({image}));}); set('#image-ratio','3'); click('[data-image-fill]');
    $('image-editor-form').requestSubmit(); for(let i=0;i<20 && !$('veil').hidden;i++) await wait();
    const header=(await ouip.load()).world.image; await refresh();
    const headerImage=$('world-image').querySelector('img'); if(!headerImage.complete || !headerImage.naturalWidth) await headerImage.decode();
    const headerRect=headerImage.getBoundingClientRect();
    check(Math.abs(headerRect.width/headerRect.height-3)<.02,'overview keeps applied header aspect ratio after reload');
    await editImage(header,async()=>{}); check(Math.abs($('image-canvas').width/$('image-canvas').height-3)<.02,'header frame reopens at applied ratio'); click('[data-vclose]');
    page='book'; selectBookTab('人物'); render(); scrollTo(0,0); await wait();
  });
  await stage('organization creation / multiple memberships', async () => {
    click('[data-book-tab="organizations"]');
    for (const name of ['試験組織A', '試験組織B']) {
      click('[data-new-organization]'); $('organization-name').value = name;
      check($('organization-form') && $('organization-form').querySelector('[type="submit"]').getBoundingClientRect().bottom <= innerHeight + 1, 'organization decision reachable: ' + name);
      $('organization-form').requestSubmit(); await wait();
    }
    orgs = (await ouip.load()).world.organizations.filter(o => o.name.startsWith('試験組織'));
    check(orgs.length === 2, 'organizations created through form/IPC');
    click('[data-kind="人物"]'); openEntry(personId); click('[data-edit]');
    for (const o of orgs) document.querySelector(`[data-organization-membership][value="${o.id}"]`).checked = true;
    $('ef').requestSubmit(); await wait();
    check((await ouip.load()).entries.find(e => e.id === personId).organizationIds.length === 2, 'multiple memberships saved');
    click('[data-edit]');
    check(document.querySelectorAll('[data-organization-membership]:checked').length === 2, 'multiple memberships reopen');
  });
  await stage('free graph independent of organization rename/delete / diagram CRUD', async () => {
    // 旧組織図の選択・囲み・penは廃止。組織は自由図へ連動しない。
    $('drawer').hidden=true; cur=null; click('[data-book-tab="graphs"]');
    graphId=S.world.graphs.find(g=>g.format==='free' && g.name==='自由ノード試験図・改名')?.id;
    if(!graphId) throw Error('free graph scenario did not leave its diagram');
    const freeGraphs=async()=>JSON.stringify((await ouip.load()).world.graphs.filter(g=>g.format==='free'));
    const before=await freeGraphs();
    click('[data-book-tab="organizations"]'); click(`[data-edit-organization="${orgs[0].id}"]`);
    set('#organization-name','自由図と独立した改名'); $('organization-form').requestSubmit(); await wait();
    check((await ouip.load()).world.organizations.find(o=>o.id===orgs[0].id).name==='自由図と独立した改名' && await freeGraphs()===before,'organization rename leaves all free diagrams unchanged');
    click(`[data-delete-organization="${orgs[1].id}"]`); $('organization-delete-form').requestSubmit(); await wait();
    const after=await ouip.load();
    check(!after.world.organizations.some(o=>o.id===orgs[1].id) && !after.entries.find(e=>e.id===personId).organizationIds.includes(orgs[1].id),'organization deletion clears membership, not character');
    check(await freeGraphs()===before,'organization deletion leaves all free diagrams unchanged');
    click('[data-book-tab="graphs"]');
    click('[data-new-diagram="graphs"]'); $('free-diagram-name').value='削除試験図'; $('free-diagram-form').requestSubmit(); await wait();
    const disposable=$('diagram-select').value;
    if(disposable===graphId || !S.world.graphs.some(g=>g.id===disposable && g.name==='削除試験図')) throw Error('disposable diagram was not created');
    click('[data-delete-diagram="graphs"]'); check((await ouip.load()).world.graphs.some(g=>g.id===disposable),'diagram deletion requires confirmation');
    click('[data-delete-diagram="graphs"]'); await wait();
    check(!(await ouip.load()).world.graphs.some(g=>g.id===disposable) && await freeGraphs()===before,'diagram deleted without changing other diagrams');
    $('diagram-select').value=graphId; $('diagram-select').dispatchEvent(new Event('change',{bubbles:true}));
  });
  await stage('retired relation UI absent / refresh preserves drafts / stats save', async () => {
    openEntry(personId); click('[data-edit]');
    set('#f-name', '人物未確定名'); set('#f-desc', '説明未確定文');
    set('[data-cs-add-name]', '体力'); click('[data-cs-action="add"]');
    set('[data-cs-row="0"] [data-cs-field="mode"]', 'number');
    set('[data-cs-row="0"] [data-cs-field="min"]', '-10'); set('[data-cs-row="0"] [data-cs-field="max"]', '90'); set('[data-cs-row="0"] [data-cs-field="unit"]', '点');
    set('[data-cs-row="0"] [data-cs-field="numberValue"]', '37');
    const draft = JSON.stringify(statsEditor.getDraft());
    const graphsBefore=JSON.stringify((await ouip.load()).world.graphs.filter(g=>g.format==='free'));
    check(!$('relf') && !$('editing-relations') && !document.querySelector('[data-editing-add-relation]'), 'character edit has no retired relation form');
    await refresh();
    check($('f-name').value === '人物未確定名' && $('f-desc').value === '説明未確定文' && JSON.stringify(statsEditor.getDraft()) === draft, 'background refresh preserves name/description/status draft');
    check((await ouip.load()).entries.find(e=>e.id===personId).name !== '人物未確定名', 'background refresh does not save character draft');
    const peer=S.entries.find(e=>e.kind==='人物' && e.id!==personId);
    if(!peer) throw Error('missing peer for background rename');
    await ouip.saveEntry({id:peer.id,kind:'人物',name:'候補改名人物'});
    await ouip.updateWorld({organization:{id:orgs[0].id,name:'候補改名組織'}}); await refresh();
    check(!$('relf') && !$('editing-relations'), 'refresh does not resurrect retired relation UI');
    check($('f-name').value === '人物未確定名' && $('f-desc').value === '説明未確定文' && JSON.stringify(statsEditor.getDraft()) === draft, 'background rename preserves edit drafts');
    check(JSON.stringify((await ouip.load()).world.graphs.filter(g=>g.format==='free'))===graphsBefore,'character/organization rename does not rewrite free diagrams');
    // 同じフォームを保存して、数値とroughの正本・グラフ再表示まで確認。
    for (const name of ['気質','知力']) { set('[data-cs-add-name]', name); click('[data-cs-action="add"]'); }
    set('[data-cs-row="1"] [data-cs-field="mode"]', 'rough');
    set('[data-cs-row="1"] [data-cs-field="levels"]', '低\n中\n高');
    set('[data-cs-row="1"] [data-cs-field="roughValue"]', '2');
    set('[data-cs-row="2"] [data-cs-field="mode"]', 'number');
    set('[data-cs-row="2"] [data-cs-field="numberValue"]', '62');
    set('[data-cs-setting="card"]', 'radar'); set('[data-cs-setting="detail"]', 'bars');
    $('ef').requestSubmit(); await wait();
    const saved = (await ouip.load()).entries.find(e => e.id === personId);
    check(saved.stats.items[0].mode === 'number' && saved.stats.items[0].value === 37 && saved.stats.items[0].min === -10 && saved.stats.items[0].max === 90 && saved.stats.items[0].unit === '点' && saved.stats.items[2].value === 62 && saved.stats.items[1].mode === 'rough' && saved.stats.items[1].value === 2 && saved.stats.items[1].levels.join('/') === '低/中/高', 'number and rough status values saved');
    check(saved.stats.card === 'radar' && saved.stats.detail === 'bars', 'card/detail graph settings saved');
    click('[data-kind="人物"]'); openEntry(personId);
    check(document.querySelector(`[data-drag="${personId}"] .cs-card .cs-radar`) && $('drawer').querySelector('.cs-detail .cs-track') && $('drawer').querySelector('.cs-detail').textContent.includes('高'), 'radar card and bars detail redisplayed');
    click('[data-edit]');
    check(document.querySelector('[data-cs-row="0"] [data-cs-field="numberValue"]').value === '37' && document.querySelector('[data-cs-row="1"] [data-cs-field="roughValue"]').value === '2' && document.querySelector('[data-cs-setting="card"]').value === 'radar', 'status values/graph controls reopen');
  });
  await stage('tag / prose / field up-down order persists', async () => {
    openEntry(personId); click('[data-edit]');
    // 上下両方向を通し、元とは異なる最終順を保存。
    for (const [container, row, field] of [['#f-tags','[data-trow]','[data-tk]'],['#f-sections','[data-section]','[data-section-title]'],['#f-fields','[data-frow]','[data-fk]']]) {
      const add = container === '#f-tags' ? '[data-addtag]' : container === '#f-sections' ? '[data-addsection]' : '[data-addfield]';
      while (document.querySelectorAll(container + ' ' + row).length < 3) {
        click(add); const list = [...document.querySelectorAll(container + ' ' + row)]; list.at(-1).querySelector(field).value = '順序試験' + list.length;
      }
      await new Promise(r => setTimeout(r,0));
      const first = document.querySelector(container + ' ' + row); const name = first.querySelector(field).value;
      first.querySelector('[data-editor-order="down"]').click();
      check([...document.querySelectorAll(container + ' ' + row)][1].querySelector(field).value === name, container + ' down action');
      first.querySelector('[data-editor-order="up"]').click();
      check(document.querySelector(container + ' ' + row).querySelector(field).value === name, container + ' up action');
      first.querySelector('[data-editor-order="down"]').click();
    }
    const orders = () => [ [...document.querySelectorAll('[data-tk]')].map(e => e.value), [...document.querySelectorAll('[data-section-title]')].map(e => e.value), [...document.querySelectorAll('[data-fk]')].map(e => e.value) ];
    const expected = orders(); $('ef').requestSubmit(); await wait();
    const saved = (await ouip.load()).entries.find(e => e.id === personId);
    check(JSON.stringify([Object.keys(saved.tags),saved.sections.map(s => s.title),saved.fields.map(f => f.key)]) === JSON.stringify(expected), 'tag/prose/field DOM order saved');
    click('[data-edit]'); check(JSON.stringify(orders()) === JSON.stringify(expected), 'tag/prose/field order reopens');
  });
  await stage('timeline side-top / whole year reorder save and reopen', async () => {
    $('drawer').hidden = true; cur = null; click('[data-kind="出来事"]');
    for (const year of [101,202]) {
      click('#addentry'); $('f-name').value = '年単位試験' + year; $('f-year').value = String(year); $('f-ylabel').value = '年号見出し' + year; $('ef').requestSubmit(); await wait(); click('[data-close]');
    }
    for (const position of ['top','side','top']) {
      set('[data-timeline-position]',position); await timelineController.waitForSave();
      check((await ouip.load()).world.timeline.yearPosition === position && document.querySelector('.timeline-layout').classList.contains('timeline-' + position), 'year display position saved/rendered: ' + position);
      if (position === 'side') {
        const head = document.querySelector('[data-timeline-year="year:101"] .year-head');
        const label = head.querySelector('.year-label'), number = head.querySelector('.year-number');
        check(label?.textContent === '年号見出し101' && number?.textContent.includes('101年') && Boolean(label.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_FOLLOWING), 'side timeline DOM orders year-label before year-number');
      }
    }
    const storedCalendar = (await ouip.load()).world.calendar;
    $('erasf').closest('details').open = true;
    $('cal').value = '未確定の年表暦'; $('cal').dispatchEvent(new Event('input', {bubbles:true}));
    set('[data-timeline-position]', 'side'); await timelineController.waitForSave();
    check($('cal').value === '未確定の年表暦' && $('erasf').dataset.dirty === '1' && $('erasf').closest('details').open, 'timeline refresh preserves calendar draft and open state');
    check((await ouip.load()).world.calendar === storedCalendar, 'timeline controls do not save calendar draft');
    delete $('erasf').dataset.dirty; renderBook();
    set('[data-timeline-position]', 'top'); await timelineController.waitForSave();
    const order = () => [...document.querySelectorAll('.tl [data-timeline-year]')].map(e => e.dataset.timelineYear);
    const initial = order(); const first = document.querySelector('[data-timeline-down]'); first.click(); await timelineController.waitForSave();
    check(document.querySelector('[data-timeline-down]').textContent === '▽' && document.querySelector('.timeline-flow') && document.querySelector('[data-timeline-year]').draggable && !document.querySelector('[data-timeline-handle]'), 'timeline direct drag/quiet arrows/flow');
    const expected = order(); check(expected[0] === initial[1] && expected[1] === initial[0], 'whole year down action');
    const up = [...document.querySelectorAll('[data-timeline-up]')].find(b => b.dataset.timelineUp === initial[0]); up.click(); await timelineController.waitForSave();
    check(JSON.stringify(order()) === JSON.stringify(initial), 'whole year up action');
    set('[data-timeline-sort]', 'desc'); await timelineController.waitForSave();
    check(order()[0] === 'year:202' && (await ouip.load()).world.timeline.sortMode === 'desc', 'timeline descending persists');
    set('[data-timeline-sort]', 'asc'); await timelineController.waitForSave();
    const groups = [...document.querySelectorAll('.tl [data-timeline-year]')], transfer = new DataTransfer();
    const firstGroup = groups[0], targetGroup = groups[1], dropRect = targetGroup.getBoundingClientRect();
    firstGroup.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91}));
    firstGroup.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    targetGroup.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:dropRect.bottom-1}));
    await timelineController.waitForSave();
    check(JSON.stringify(order()) === JSON.stringify(expected) && transfer.getData('text/x-ouip-timeline-year') === initial[0], 'direct year group DND keeps isolated payload and persists');
    set('[data-timeline-sort]', 'asc'); await timelineController.waitForSave();
    document.querySelector('[data-timeline-down]').click(); click('#save-btn'); await timelineController.waitForSave(); await wait();
    check(JSON.stringify((await ouip.load()).world.timeline.order) === JSON.stringify(expected), 'year order saved including immediate history save');
    click('[data-kind="人物"]'); click('[data-kind="出来事"]'); await refresh();
    check(JSON.stringify(order()) === JSON.stringify(expected) && document.querySelector('[data-timeline-position]').value === 'top', 'year layout/order reopens');
  });
  window.__ouipFeatureFailures = failures;
  console.log('FEATURE SUMMARY: failures=' + failures);
}

(async () => {
  const tmp = await fs.mkdtemp(path.join(process.env.OUIP_TEST_TEMP_ROOT || os.tmpdir(), "ouip-smoke-"));
  let child;
  try {
    await fs.mkdir(path.join(tmp, 'profile'));
    const s = new Store(path.join(tmp, "data")); await s.init();
    const src = path.join(tmp, "test.png");
    await fs.writeFile(src, testPNG());
    const image = await s.importImage(src);
    await s.updateWorld({ image, map: { image } });
    await s.saveEntry({ kind: "人物", name: "灯", image, icon: image });
    await s.saveEntry({ kind: "用語", name: "紋章", image });
    await s.saveEntry({ kind: "場所", name: "灯台" });
    const main = path.resolve(__dirname, "../main.js");
    const harness = path.join(tmp, "main.cjs");
    const scenarioFile = path.join(tmp,'scenario.js');
    await fs.writeFile(scenarioFile, `${freeGraphScenario.toString()}\n${featureScenario.toString()}\n(${scenario.toString()})().catch(e=>{console.error('SMOKE FAILED: '+e.stack);window.__ouipFeatureFailures=(window.__ouipFeatureFailures||0)+1;})`);
    console.log('HARNESS: actual main=' + main + '; TEMP=' + tmp);
    await fs.writeFile(harness, `const {app,dialog}=require('electron');if(process.env.OUIP_UI_SMALL){let sized=false;app.on('browser-window-created',(_e,w)=>{if(!sized){sized=true;w.setSize(720,520);}});}dialog.showOpenDialog=async(w,o)=>({canceled:false,filePaths:[o.title==='共有ボードを読み込む'?${JSON.stringify(path.join(tmp,'shared.ouip-board'))}:${JSON.stringify(src)}]});dialog.showSaveDialog=async(w,o)=>({canceled:false,filePath:o.title==='共有ボードを書き出す'?${JSON.stringify(path.join(tmp,'shared.ouip-board'))}:${JSON.stringify(path.join(tmp,'board.png'))}});const original=app.setPath.bind(app);app.setPath=(n,v)=>original(n,n==='userData'?${JSON.stringify(path.join(tmp,"profile"))}:v);require(${JSON.stringify(main)});`);
    let errors = "";
    const harnessText = await fs.readFile(harness,'utf8');
    const artifactBase = process.env.OUIP_UI_ARTIFACT ? path.resolve(process.env.OUIP_UI_ARTIFACT).replace(/\.png$/i,'') : null;
    const captures = artifactBase ? `if(code==='OUIP_SMOKE_SCENARIO')await (${captureViews.toString()})(w,execute,${JSON.stringify(screenshotView.toString())},${JSON.stringify(artifactBase)});` : '';
    // 実利用の開発版が前面でも、試験所有windowの画像decode/描画を止めない。
    const captureWindow = 'w.setFocusable(false);w.webContents.setBackgroundThrottling(false);w.showInactive();';
    await fs.writeFile(harness, harnessText.replace('require(' + JSON.stringify(main) + ');', `app.on('browser-window-created',(_e,w)=>{${captureWindow}const execute=w.webContents.executeJavaScript.bind(w.webContents);w.webContents.executeJavaScript=async(code,...args)=>{const result=await execute(code==='OUIP_SMOKE_SCENARIO'?require('node:fs').readFileSync(${JSON.stringify(scenarioFile)},'utf8'):code,...args);${captures}return result;};});require(${JSON.stringify(main)});`));
    // 生成したハーネスも起動前に構文確認。失敗時にElectronのエラーダイアログを残さない。
    await new Promise((resolve,reject) => execFile(process.execPath,['--check',harness],{windowsHide:true,timeout:5000},(error,_stdout,stderr)=>error?reject(Error(stderr)):resolve()));
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[name];
    const diagnosticFlags = process.env.OUIP_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
    console.log('HARNESS: diagnostic flags=' + JSON.stringify(diagnosticFlags));
    child = spawn(require("electron"), [harness, ...diagnosticFlags, "--dev", `--data=${s.dir}`, `--shot=${path.join(tmp,"shot.png")}`, '--do=OUIP_SMOKE_SCENARIO'], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
    console.log('HARNESS: owned Electron PID=' + child.pid);
    child.stderr.on("data", (b) => { errors += b; process.stderr.write(b); });
    child.stdout.on("data", (b) => { errors += b; process.stdout.write(b); });
    await new Promise((resolve, reject) => {
      const timeout = Math.min(90000, Math.max(55000, Number(process.env.OUIP_UI_TIMEOUT_MS) || 55000));
      const timer = setTimeout(() => reject(Error("timeout: " + errors)), timeout);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once("close", (code) => { clearTimeout(timer); console.log('HARNESS: actual main screenshot exit=' + code); code === 0 ? resolve() : reject(Error(errors)); });
    });
    await fs.access(path.join(tmp,"shot.png"));
    if (process.env.OUIP_UI_ARTIFACT) await fs.copyFile(path.join(tmp,"shot.png"), path.resolve(process.env.OUIP_UI_ARTIFACT));
    if (/FEATURE FAILED:|SMOKE FAILED:|CAPTURE FAILED:|Uncaught|Error occurred in handler/.test(errors) || !errors.includes('FEATURE SUMMARY: failures=0') || (artifactBase && !errors.includes('CAPTURE SUMMARY: distinct outputs=13/13'))) throw Error('UI regression/capture failed (valid screenshots retained); see FEATURE/SMOKE/CAPTURE failures above');
    console.log("PASS: 実Electron actual main撮影/exit=0、既存地図/画像/ボード回帰、旧図の人物・組織ドラッグ/取消/座標のみ保存/再読込・複製元保持、自由図/ノード/矢印CRUD・縦横文字/色/方向・grid/位置保存/重なり回避・組織と独立、人物の旧relf不在/draft保持、kg/lb、数値rough・カード詳細グラフ、タグ文章項目順、年の横上/ラベル順/年単位順。OSダイアログ/pointer capture/DNDは模擬");
  } finally {
    await stopOwnedChild(child);
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    console.log('CLEANUP: owned Electron closed PID=' + child?.pid + '; TEMP removed=' + tmp);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });