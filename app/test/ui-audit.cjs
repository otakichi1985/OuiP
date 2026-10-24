// 現行UI原則の回帰。実main/preloadと隔離Storeを使用し、失敗応答だけを注入する。
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { Store } = require('../lib/store');

async function rendererAudit() {
  const $ = id => document.getElementById(id);
  const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));
  const check = (ok, label) => { if (!ok) throw Error(label); console.log('AUDIT PASS: ' + label); };
  const click = selector => { const el = document.querySelector(selector); if (!el) throw Error('missing ' + selector); el.click(); };
  const key = (el, value, shiftKey = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  click('[data-page="book"]');
  const firstTab = $('booktabs').querySelector('[role="tab"]'); firstTab.focus();
  key(firstTab, 'ArrowRight'); await wait();
  check(bookTab === 'organizations' && document.activeElement.dataset.bookTab === 'organizations', 'arrow tab activates organization and keeps focus after repaint');
  check($('booktabs').querySelectorAll('[tabindex="0"]').length === 1 && $('book-panel').getAttribute('aria-labelledby') === document.activeElement.id, 'one tab stop and named tab panel');
  key(document.activeElement, 'End'); await wait();
  check(bookTab === '出来事', 'End selects timeline');
  key(document.activeElement, 'Home'); await wait();
  check(bookTab === '人物', 'Home returns to characters');
  click('[data-book-tab="maps"]');
  check(bookTab === 'maps' && $('q').hidden && $('facets').hidden, 'map is its own tab without the retired nested view switch');
  click('[data-kind="人物"]');
  $('q').value = '存在しない検索'; $('q').dispatchEvent(new Event('input', { bubbles: true }));
  check($('bookbody').textContent.includes('条件に合うキャラはありません') && $('bookbody').querySelector('[data-clear-search]'), 'filtered empty has a recovery action');
  click('#bookbody [data-clear-search]');
  check(q === '' && $('bookbody').querySelector('.en') && document.activeElement === $('q'), 'reset clears conditions and returns to search');
  click('[data-book-tab="organizations"]');
  $('q').value = '存在しない検索'; $('q').dispatchEvent(new Event('input', { bubbles: true }));
  check($('bookbody').textContent.includes('条件に合う組織'), 'organization zero result is not first-use empty');
  click('[data-clear-search]');
  click('[data-kind="用語"]');
  check($('bookbody').querySelector('[data-empty-add]'), 'first-use empty offers add');
  click('[data-empty-add]'); await wait();
  check($('f-name') && document.activeElement === $('f-name'), 'empty action opens real editor');
  click('[data-close]'); await wait();
  click('[data-kind="人物"]');
  $('addentry').focus(); click('#addentry'); await wait();
  $('f-name').value = '監査失敗'; $('f-desc').value = '失敗と再試行でも保持する本文';
  $('ef').requestSubmit(); $('ef').requestSubmit();
  await wait(650);
  check($('f-name').value === '監査失敗' && $('f-desc').value.includes('再試行'), 'failed save keeps editor draft');
  check($('ef').querySelector('.operation-error[role="alert"]')?.textContent.includes('監査用の保存失敗'), 'failed save has persistent local alert');
  check(!$('ef').querySelector('[type="submit"]').disabled && !$('ef').hasAttribute('aria-busy'), 'failed save restores retry controls');
  await wait(2500);
  check($('ef').querySelector('.operation-error[role="alert"]')?.textContent.includes('監査用の保存失敗'), 'error remains beyond toast lifetime');
  $('ef').requestSubmit(); $('ef').requestSubmit();
  check($('ef').getAttribute('aria-busy') === 'true' && $('f-name').disabled, 'pending save prevents double submission and draft edits');
  await wait(700);
  check(!$('ef') && S.entries.filter(e => e.name === '監査失敗').length === 1, 'retry saves exactly one entry');
  click('[data-close]'); await wait();
  check(document.activeElement === $('addentry'), 'drawer close restores add origin');
  $('hist-btn').focus(); click('#hist-btn'); await wait(300);
  check(!$('veil').hidden && document.querySelector('main').inert && $('drawer').inert, 'modal makes background inert');
  const focusable = () => [...$('viewer').querySelectorAll('button,input,select,textarea,[tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  const items = focusable(); items.at(-1).focus(); key(document.activeElement, 'Tab');
  check(document.activeElement === items[0], 'Tab wraps within dialog');
  items[0].focus(); key(document.activeElement, 'Tab', true);
  check(document.activeElement === items.at(-1), 'Shift+Tab wraps within dialog');
  document.querySelector('[data-page="book"]').focus();
  check($('viewer').contains(document.activeElement), 'programmatic background focus cannot escape modal');
  click('[data-vclose]'); await wait();
  check(!document.querySelector('main').inert && document.activeElement === $('hist-btn'), 'modal close restores origin and background');
  click('#addentry'); $('f-name').value = '監査表示失敗'; $('f-desc').value = '再読込失敗でも重複させない'; $('ef').requestSubmit(); await wait(600);
  const persistedId = cur;
  check(persistedId && $('ef').querySelector('.operation-error')?.textContent.includes('設定は反映しました'), 'refresh failure distinguishes confirmed save from display failure');
  $('ef').requestSubmit(); await wait(600);
  check(S.entries.filter(e => e.name === '監査表示失敗').length === 1 && S.entries.find(e => e.name === '監査表示失敗').id === persistedId, 'retry after refresh failure updates same entry without duplicate');
  click('[data-close]'); await wait();
  click('#addentry'); $('f-name').value = '削除確認用'; $('ef').requestSubmit(); await wait(600);
  click('[data-edit]'); click('[data-delentry]');
  const confirm = document.querySelector('[data-delentry]'), bounds = confirm.getBoundingClientRect();
  check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'long destructive confirmation remains inside drawer');
  click('[data-entry="' + cur + '"]'); click('[data-close]'); await wait();
  UIAccess.reportError('監査用の持続エラー。条件を確認して再試行してください。'); await wait(2600);
  check(!$('app-error').hidden, 'global error persists with dismiss action'); click('#app-error-close');
  check($('app-error').hidden, 'global error can be dismissed');
  console.log('AUDIT INTERACTION SUMMARY: PASS');
}

async function mainAudit(w, execute, scenarioSource, output) {
  const fs = require('node:fs/promises');
  w.setFocusable(false); w.showInactive(); w.webContents.setBackgroundThrottling(false);
  await execute('(' + scenarioSource + ')()');
  const key = async (value, modifiers = []) => { w.webContents.sendInputEvent({ type: 'keyDown', keyCode: value, modifiers }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: value, modifiers }); await new Promise(r => setTimeout(r, 100)); };
  await execute(`document.querySelector('[data-kind="人物"]').focus()`);
  await key('Right');
  const native = await execute(`bookTab === 'organizations' && document.activeElement.dataset.bookTab === 'organizations'`);
  if (!native) throw Error('native Electron arrow key navigation');
  console.log('AUDIT PASS: native Electron arrow key navigation');
  await execute(`$('hist-btn').focus();$('hist-btn').click();`);
  await new Promise(r => setTimeout(r, 250));
  await execute(`window.__auditDialogItems=[...$('viewer').querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);window.__auditDialogItems.at(-1).focus();`);
  await key('Tab');
  if (!await execute(`document.activeElement === window.__auditDialogItems[0]`)) throw Error('native modal Tab wrap');
  await key('Tab', ['shift']);
  if (!await execute(`document.activeElement === window.__auditDialogItems.at(-1)`)) throw Error('native modal Shift+Tab wrap');
  await key('Escape');
  if (!await execute(`$('veil').hidden && document.activeElement === $('hist-btn') && !document.querySelector('main').inert`)) throw Error('native modal Escape/focus return');
  console.log('AUDIT PASS: native Electron Tab/Shift+Tab/Escape and modal focus return');
  const views = [[720,520,1], [1280,860,1], [1920,1000,1], [2560,1300,1], [1280,860,1.5]];
  const hashes = new Set();
  for (const [width,height,zoom] of views) {
    w.setContentSize(width,height); w.webContents.setZoomFactor(zoom);
    await execute(`page='book';selectBookTab('人物');q='';$('q').value='';render();scrollTo(0,0);`);
    await new Promise(r => setTimeout(r, 250));
    const metrics = await execute(`(() => {
      const check=(v,m)=>{if(!v)throw Error(m)};
      check(document.documentElement.scrollWidth<=innerWidth+1,'page horizontal overflow');
      check(getComputedStyle($('w-title')).fontFamily.includes('Mincho'),'overview display typography preserved');
      const srgb=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4};
      const lum=c=>{const a=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(srgb);return a[0]*.2126+a[1]*.7152+a[2]*.0722};
      const ratio=(a,b)=>{a=lum(a);b=lum(b);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      const input=getComputedStyle($('q')), normal=getComputedStyle(document.body), muted=getComputedStyle(document.querySelector('.facets .fl'));
      const ratios={text:ratio(normal.color,normal.backgroundColor),muted:ratio(muted.color,normal.backgroundColor),input:ratio(input.borderTopColor,input.backgroundColor)};
      check(ratios.text>=4.5&&ratios.muted>=4.5&&ratios.input>=3,'semantic contrast');
      return {viewport:[innerWidth,innerHeight],zoom:devicePixelRatio,ratios,cards:document.querySelectorAll('.en').length};
    })()`);
    // Acquire compositor frames after each resize; compare hashes to reject stale captures.
    await w.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true});
    await execute('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const image = await w.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true});
    const hash = require('node:crypto').createHash('sha256').update(image.toBitmap()).digest('hex');
    if (image.isEmpty() || hashes.has(hash)) throw Error('empty or stale audit screenshot'); hashes.add(hash);
    const name = output + '-' + width + 'x' + height + (zoom===1?'':'-zoom150') + '.png';
    await fs.writeFile(name,image.toPNG()); console.log('AUDIT VIEW: '+JSON.stringify({...metrics,output:name,hash}));
    await execute(`openForm(S.entries.find(e=>e.name==='監査失敗').id);`);
    await new Promise(r => setTimeout(r, 220));
    await execute(`(() => {
      const r=document.querySelector('#ef [type="submit"]').getBoundingClientRect();if(r.bottom>innerHeight||r.left<0||r.right>innerWidth)throw Error('editor action outside viewport');
      const fields=document.querySelector('.editor-fields');
      if(fields.scrollWidth>fields.clientWidth+1)throw Error('editor horizontal overflow: '+JSON.stringify([...fields.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>fields.getBoundingClientRect().right+1).slice(0,8).map(el=>[el.tagName,el.id,el.className,el.getBoundingClientRect().width])));
    })()`);
    if (width===720 || zoom>1) {
      await w.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true});
      await execute('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const editor=await w.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true});
      await fs.writeFile(name.replace('.png','-editor.png'),editor.toPNG());
    }
    await execute(`$('drawer').hidden=true;cur=null;`);
  }
  console.log('AUDIT SUMMARY: PASS; widths=5; native keyboard=PASS');
}

(async () => {
  const tmp = await fs.mkdtemp(path.resolve(__dirname,'../../dist/ui-audit-tmp-'));
  let child;
  try {
    await fs.mkdir(path.join(tmp,'profile'));
    const store = new Store(path.join(tmp,'data')); await store.init();
    await store.updateWorld({title:'星渡りの港 — 設定帳',note:'まだ決めていないことも、この世界の一部。'});
    for (let i=0;i<18;i++) await store.saveEntry({kind:'人物',name:i===0?'途切れない非常に長いキャラ名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789':'港の人物 '+(i+1),desc:'灯台と渡り舟をめぐる物語の設定。決まったことと、これから考えることを整理する。',tags:{役割:[i%2?'船乗り':'灯台守']},fields:[{key:'旅の目的',open:true}]});
    await store.updateWorld({organization:{name:'灯台守の組合',desc:'北の港の灯台を管理する。'}});
    const output=path.resolve(__dirname,'../../dist/ui-audit');
    const main=path.resolve(__dirname,'../main.js'), harness=path.join(tmp,'main.cjs');
    const source=`const {app,ipcMain}=require('electron');const originalPath=app.setPath.bind(app);app.setPath=(n,v)=>originalPath(n,n==='userData'?${JSON.stringify(path.join(tmp,'profile'))}:v);const handle=ipcMain.handle.bind(ipcMain);let attempts=0,displayAttempts=0,failLoad=false;ipcMain.handle=(channel,fn)=>handle(channel,async(...args)=>{if(channel==='load'&&failLoad){failLoad=false;throw Error('監査用の再読込失敗');}if(channel==='saveEntry'&&args[1].name==='監査表示失敗'){const saved=await fn(...args);if(++displayAttempts===1)failLoad=true;return saved;}if(channel==='saveEntry'&&args[1].name==='監査失敗'){attempts++;await new Promise(r=>setTimeout(r,250));if(attempts===1)throw Error('監査用の保存失敗');}return fn(...args);});app.on('browser-window-created',(_e,w)=>{const execute=w.webContents.executeJavaScript.bind(w.webContents);w.webContents.executeJavaScript=async(code,...args)=>{if(code!=='OUIP_AUDIT')return execute(code,...args);try{await (${mainAudit.toString()})(w,execute,${JSON.stringify(rendererAudit.toString())},${JSON.stringify(output)});}catch(e){console.error('AUDIT FAILED: '+e.stack);app.exit(1);}};});require(${JSON.stringify(main)});`;
    await fs.writeFile(harness,source);
    // Bound syntax and child runtime, including failures inside the main/renderer promise.
    await new Promise((resolve,reject)=>execFile(process.execPath,['--check',harness],{windowsHide:true,timeout:5000},e=>e?reject(e):resolve()));
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[name];
    console.log('AUDIT RUNTIME: '+require('electron')+'; inherited Electron switches='+JSON.stringify(Object.entries(process.env).filter(([name])=>name.toUpperCase().startsWith('ELECTRON_'))));
    const diagnosticFlags = process.env.OUIP_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
    console.log('AUDIT DIAGNOSTIC FLAGS: '+JSON.stringify(diagnosticFlags));
    child=spawn(require('electron'),[harness,...diagnosticFlags,'--dev','--data='+store.dir,'--shot='+path.join(tmp,'final.png'),'--do=OUIP_AUDIT'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env});
    console.log('AUDIT OWNED PID: '+child.pid+'; TEMP='+tmp);
    let log=''; child.stdout.on('data',b=>{log+=b;process.stdout.write(b)}); child.stderr.on('data',b=>{log+=b;process.stderr.write(b)});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('audit timeout')),90000);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('audit exit '+code))})});
    if(!log.includes('AUDIT SUMMARY: PASS')||log.includes('AUDIT FAILED:'))throw Error('audit summary missing or failed');
  } finally {
    if(child&&child.exitCode===null) await new Promise(resolve=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:8000},()=>resolve()));
    // tmp is the exact directory returned by mkdtemp above, never a user data path.
    await fs.rm(tmp,{recursive:true,force:true,maxRetries:20,retryDelay:200});
    console.log('AUDIT CLEANUP: PID='+child?.pid+'; TEMP removed='+tmp);
  }
})().catch(e=>{console.error(e);process.exitCode=1});
