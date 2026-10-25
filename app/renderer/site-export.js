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
      $('viewer').innerHTML=`<div class="vh"><h3 id="vt">閲覧用ファイル（HTML）を書き出す</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div><form id="site-export-form"><div class="site-export-body"><label class="l" for="site-title">閲覧用ファイルの名前</label><input type="text" id="site-title" maxlength="1000" required value="${esc(world.title||'無題の世界')}"><p>選んだ内容だけを、画像込みの閲覧専用HTMLにまとめます。ネットへの公開・自動更新はしません。</p><p class="small muted">選んだ項目の説明・タグ（カードで非表示のタグも含む）・詳しい設定・ステータスをまとめて載せます。本文や画像に書かれた秘密・個人情報は自動では除かれません。履歴・ボード・未選択項目は含みません。</p><label class="site-template" for="site-template">見た目<select id="site-template"><option value="standard">標準（暗い配色）</option><option value="light">明るい配色</option><option value="paper">紙（明朝体）</option></select></label><p class="small muted">図（関係図・地図）は、書き出し元の見た目のまま載せます。</p><label class="site-intro"><input id="site-intro" type="checkbox">概要の紹介文・メイン画像を載せる</label><label class="site-intro site-select-all"><input id="site-select-all" type="checkbox">すべて選択（下の項目をまとめて選ぶ）</label>
      ${['人物','用語','場所','出来事'].map(k=>group('entryIds',k==='人物'?'キャラ':k==='出来事'?'年表の出来事':k,state.entries.filter(e=>e.kind===k))).join('')}
      ${group('organizationIds','組織',world.organizations||[],'所属や親子のリンクは、選んだ組織とキャラの間だけに付きます。')}
      ${group('graphIds','関係図',world.graphs||[],'旧図は選んだキャラ・組織だけを掲載。ノードで作る図は、図内の文字と矢印をすべて載せます。')}
      ${group('mapIds','地図',world.maps||[],'背景画像と選んだ場所のピンを掲載します。画像自体に書かれた地名などは残ります。')}
      <p class="small muted">最大500項目・30図。画像を多く含む場合は、書き出し前にサイズを確認します。書き出したファイルを渡した相手は、内容のコピーや再共有ができます。</p><div class="export-progress" id="site-export-progress" hidden><div class="export-progress-track"><span></span></div><span class="small muted" id="site-export-progress-label" role="status"></span></div></div><div class="modal-actions row"><span class="small muted" id="site-selection-count" role="status">掲載内容を選んでください</span><button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">HTMLを書き出す</button></div></form>`;
      $('veil').hidden=false;$('site-title').focus();update();
    }
    function update() {
      const form=$('site-export-form');if(!form)return;
      const items=[...form.querySelectorAll('[data-site-item]')];
      const count=items.filter(input=>input.checked).length,intro=$('site-intro').checked;
      $('site-selection-count').textContent=`選択 ${count}件${intro?' ＋ 概要':''}`;
      form.querySelector('[type="submit"]').disabled=!count&&!intro;
      // すべて選択できる項目があるときだけ有効。全部選べばオン、一部なら中間、何も選ばなければオフ。
      const all=form.querySelector('#site-select-all');
      if(all){all.disabled=items.length===0;all.checked=items.length>0&&count===items.length;all.indeterminate=count>0&&count<items.length;}
    }
    document.addEventListener('click',ev=>{
      const b=ev.target.closest('button');if(!b)return;
      if(b.id==='site-export-btn')open();
      const group=b.closest('.site-selection');
      if(group&&('siteSelect'in b.dataset||'siteClear'in b.dataset)) {group.querySelectorAll('[data-site-item]').forEach(input=>input.checked='siteSelect'in b.dataset);update();}
    });
    document.addEventListener('change',ev=>{
      const form=ev.target.closest('#site-export-form');if(!form)return;
      if(ev.target.id==='site-select-all')form.querySelectorAll('[data-site-item]').forEach(input=>input.checked=ev.target.checked);
      update();
    });
    document.addEventListener('submit',async ev=>{
      if(ev.target.id!=='site-export-form')return;
      ev.preventDefault();const form=ev.target;if(form.dataset.submitting)return;
      const selected=key=>[...form.querySelectorAll(`[data-site-item="${key}"]:checked`)].map(input=>input.value);
      const selection={title:$('site-title').value,includeIntro:$('site-intro').checked,template:$('site-template').value,...Object.fromEntries(['entryIds','organizationIds','graphIds','mapIds'].map(key=>[key,selected(key)]))};
      const controls=[...$('viewer').querySelectorAll('button,input')].map(el=>({el,disabled:el.disabled}));
      const progress=$('site-export-progress'), bar=progress?.querySelector('.export-progress-track span'), progressLabel=$('site-export-progress-label');
      const setProgress=(percent,text)=>{if(progress)progress.hidden=false;if(bar?.style)bar.style.width=`${Math.max(0,Math.min(100,percent))}%`;if(progressLabel)progressLabel.textContent=text;};
      let unsubscribe=null;
      form.dataset.submitting='1';controls.forEach(({el})=>el.disabled=true);$('site-selection-count').textContent='HTMLを作成しています…';
      setProgress(0,'書き出しの準備をしています…');
      if(typeof api.onExportProgress==='function')unsubscribe=api.onExportProgress(p=>{
        if(!p)return;
        if(p.phase==='images')setProgress(p.total?80*p.done/p.total:10,`画像を変換しています（${p.done}/${p.total}）`);
        else if(p.phase==='html')setProgress(p.done?100:90,'HTMLを組み立てています…');
      });
      try {
        if(typeof api.exportSite!=='function')throw Error('編集を確定して開発版を閉じ、開き直すと書き出しが使えます。');
        await waitForSaves();
        const result=await api.exportSite(selection);
        if(result?.saved) {$('veil').hidden=true;const skipped=result.skipped||[];toast('閲覧用ファイル（HTML）を書き出しました'+(result.kept?`。WebPの画像${result.kept}枚は小さくできず、元の大きさのまま入れました`:'')+(skipped.length?`。読めなかった絵${skipped.length}枚（${skipped.map(s=>s.label).join('、')}）を除きました`:''));}
        else $('site-selection-count').textContent='書き出しを取り消しました。選択は残っています。';
      } catch(error) {reportError(String(error.message||error),form);$('site-selection-count').textContent='選択を残しました。内容を確認して再試行できます。';}
      finally {unsubscribe?.();if(progress)progress.hidden=true;delete form.dataset.submitting;controls.forEach(({el,disabled})=>el.disabled=disabled);}
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
