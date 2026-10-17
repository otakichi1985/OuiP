"use strict";
// 掲載選択はこのフォームにだけ保持。本体が再検証して許可した値だけを出力する。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteExportUI = api.createSiteExportUI({
    document, $, esc, api: root.ouip, toast,
    reportError: (message, form) => UIAccess.reportError(message, form),
    getState: () => S,
    isEditing: () => !!(ndrag || freeGraphDrag),
    waitForSaves: () => timelineController.waitForSave(),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createSiteExportUI({ document, $, esc, api, toast, reportError, getState, isEditing, waitForSaves }) {
    function open() {
      if(document.querySelector('#drawer:not([hidden]) form, #veil:not([hidden]) form, #veil:not([hidden]) #memo-ed, [data-ui-keep][data-dirty]') || isEditing()) {
        reportError('編集中の内容を確定するか取り消してから、閲覧用ファイルを書き出してください。');return;
      }
      const state=getState();
      const world=state.world;
      const group=(key,label,items,description='')=>items.length?`<fieldset class="site-selection"><legend>${esc(label)} <span class="muted">${items.length}件</span></legend>${description?`<p class="small muted">${esc(description)}</p>`:''}<div class="row"><button class="b quiet sm" type="button" data-site-select="${key}">すべて選択</button><button class="b quiet sm" type="button" data-site-clear="${key}">選択解除</button></div><div class="site-options">${items.map(e=>`<label><input type="checkbox" data-site-item="${key}" value="${esc(e.id)}"><span>${esc(e.name)}</span></label>`).join('')}</div></fieldset>`:'';
      $('viewer').classList.remove('image-editor');$('viewer').classList.add('site-export-viewer');
      $('viewer').innerHTML=`<div class="vh"><h3 id="vt">閲覧用ファイル（HTML）を書き出す</h3><button class="b quiet sm" type="button" data-vclose>取消</button></div><form id="site-export-form"><div class="site-export-body"><label class="l" for="site-title">共有サイトの名前</label><input type="text" id="site-title" maxlength="1000" required value="${esc(world.title||'無題の世界')}"><p>選んだ内容だけを、画像込みの閲覧専用HTMLにまとめます。ネットへの公開・自動更新はしません。</p><p class="small muted">選んだ項目の説明・タグ（カードで非表示のタグも含む）・詳しい設定・ステータスをまとめて載せます。本文や画像に書かれた秘密・個人情報は自動では除かれません。履歴・ボード・未選択項目は含みません。</p><label class="site-intro"><input id="site-intro" type="checkbox">概要の紹介文・メイン画像を載せる</label>
      ${['人物','用語','場所','出来事'].map(k=>group('entryIds',k==='人物'?'キャラ':k==='出来事'?'年表の出来事':k,state.entries.filter(e=>e.kind===k))).join('')}
      ${group('organizationIds','組織',world.organizations||[],'所属や親子のリンクは、選んだ組織とキャラの間だけに付きます。')}
      ${group('graphIds','関係図',world.graphs||[],'旧図は選んだキャラ・組織だけを掲載。自由ノード図は、図内の文字と矢印をすべて載せます。')}
      ${group('mapIds','地図',world.maps||[],'背景画像と選んだ場所のピンを掲載します。画像自体に書かれた地名などは残ります。')}
      <p class="small muted">最大500項目・30図、画像合計40MB、HTML全体64MB。書き出したファイルを渡した相手は、内容のコピーや再共有ができます。</p></div><div class="modal-actions row"><span class="small muted" id="site-selection-count" role="status">掲載内容を選んでください</span><button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">HTMLを書き出す</button></div></form>`;
      $('veil').hidden=false;$('site-title').focus();update();
    }
    function update() {
      const form=$('site-export-form');if(!form)return;
      const count=form.querySelectorAll('[data-site-item]:checked').length,intro=$('site-intro').checked;
      $('site-selection-count').textContent=`選択 ${count}件${intro?' ＋ 概要':''}`;
      form.querySelector('[type="submit"]').disabled=!count&&!intro;
    }
    document.addEventListener('click',ev=>{
      const b=ev.target.closest('button');if(!b)return;
      if(b.id==='site-export-btn')open();
      const group=b.closest('.site-selection');
      if(group&&('siteSelect'in b.dataset||'siteClear'in b.dataset)) {group.querySelectorAll('[data-site-item]').forEach(input=>input.checked='siteSelect'in b.dataset);update();}
    });
    document.addEventListener('change',ev=>{if(ev.target.closest('#site-export-form'))update();});
    document.addEventListener('submit',async ev=>{
      if(ev.target.id!=='site-export-form')return;
      ev.preventDefault();const form=ev.target;if(form.dataset.submitting)return;
      const selected=key=>[...form.querySelectorAll(`[data-site-item="${key}"]:checked`)].map(input=>input.value);
      const selection={title:$('site-title').value,includeIntro:$('site-intro').checked,...Object.fromEntries(['entryIds','organizationIds','graphIds','mapIds'].map(key=>[key,selected(key)]))};
      const controls=[...$('viewer').querySelectorAll('button,input')].map(el=>({el,disabled:el.disabled}));
      form.dataset.submitting='1';controls.forEach(({el})=>el.disabled=true);$('site-selection-count').textContent='HTMLを作成しています…';
      try {
        if(typeof api.exportSite!=='function')throw Error('編集を確定して開発版を閉じ、開き直すと書き出しが使えます。');
        await waitForSaves();
        const result=await api.exportSite(selection);
        if(result?.saved) {$('veil').hidden=true;toast('閲覧用ファイル（HTML）を書き出しました');}
        else $('site-selection-count').textContent='書き出しを取り消しました。選択は残っています。';
      } catch(error) {reportError(String(error.message||error),form);$('site-selection-count').textContent='選択を残しました。内容を確認して再試行できます。';}
      finally {delete form.dataset.submitting;controls.forEach(({el,disabled})=>el.disabled=disabled);}
    });
    // 決定中のEscape・背景クリックで処理や選択を取り残さない。
    for(const type of ['keydown','click'])document.addEventListener(type,ev=>{
      if(!$('site-export-form')?.dataset.submitting)return;
      if(type==='keydown'&&ev.key!=='Escape')return;
      if(type==='click'&&ev.target.id!=='veil'&&!ev.target.closest('[data-vclose]'))return;
      ev.preventDefault();ev.stopImmediatePropagation();
    },true);
    return { open, update };
  }
  return { createSiteExportUI };
});
