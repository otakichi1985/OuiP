"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UpdatesUI = api.createUpdatesUI({ document, api: root.ouip, $, esc, toast });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createUpdatesUI({ document, api, $, esc, toast }) {
    let updateState = null;
    let updateBusy = false;
    const updateMessage = info => ({ available: `v${info.version} に更新できます。`, ready: "検証が完了しました。編集を確定してから再起動してください。", current: "最新の正式版です。", unpublished: "配布リリースはまだ公開されていません。", unsupported: "開発版・ソース起動では更新を適用しません。配布版で利用できます。" }[info.kind] || "GitHubの正式リリースを確認します。");
    function updateNotice(info) {
      updateState = info;
      const card = $("update-notice"), available = info.kind === "available" || info.kind === "ready";
      const button = $("update-btn");
      button.classList.toggle("update-available", available);
      (button.querySelector(".label") || button).textContent = available ? "アプリの更新あり" : "アプリの更新";
      button.setAttribute("aria-label", available ? `更新：v${info.version} が利用できます` : "アプリの更新");
      if (!available && info.kind !== "error") { card.hidden = true; return; }
      // Release text stays plain text; never render remote Markdown/HTML.
      const lines = String(info.notes || "").split(/\r?\n/).filter(line => /^[-*] /.test(line)).slice(0, 3).map(line => line.slice(2).slice(0, 150));
      card.classList.toggle("update-notice-error", !available);
      card.innerHTML = available
        ? `<div class="update-notice-copy"><h2>新しいOuiPがあります</h2><p class="update-versions">v${esc(info.current)} <span aria-label="から">→</span> <strong>v${esc(info.version)}</strong></p>${lines.length ? `<ul>${lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul>` : `<p>更新内容を確認してからダウンロードできます。</p>`}<p class="small muted">${info.kind === "ready" ? "ダウンロード済み。編集を確定してから再起動できます。" : "ダウンロード・再起動は、選んだときだけ行います。"}</p></div><div class="update-notice-actions"><button type="button" class="b primary" data-update-open>更新内容を開く</button><button type="button" class="b quiet" data-update-dismiss>通知を閉じる</button></div>`
        : `<div class="update-notice-copy"><h2>更新を確認できませんでした</h2><p class="small muted">作業はそのまま続けられます。通信を確認して、再度お試しください。</p></div><div class="update-notice-actions"><button type="button" class="b" data-update-retry>再確認</button><button type="button" class="b quiet" data-update-dismiss>閉じる</button></div>`;
      card.hidden = false;
    }
    async function startupUpdateNotice(client = api) {
      try { updateNotice(await client.startupUpdate()); }
      catch (error) { updateNotice({ kind: "error", error: String(error.message || error) }); }
    }
    function updatePanel(info, message = "") {
      updateState = info;
      $("viewer").innerHTML = `<div class="vh"><h3 id="vt">アプリの更新</h3><button class="b quiet sm" data-vclose>閉じる</button></div><p>現在のバージョン：${esc(info.current)}</p><p id="update-status">${esc(message || (!info.supported ? updateMessage({kind:"unsupported"}) : updateMessage(info)))}</p>${info.notes ? `<pre class="release-notes">${esc(info.notes)}</pre>` : ""}<div class="row modal-actions">${info.supported && info.kind !== "ready" ? `<button class="b sm" data-update-check>更新を確認</button>` : ""}${info.kind === "available" ? `<button class="b primary" data-update-download>v${esc(info.version)} をダウンロード</button>` : ""}${info.kind === "ready" ? `<button class="b primary" data-update-apply>更新して再起動</button>` : ""}${info.backup && info.supported ? `<button class="b quiet sm" data-update-rollback>v${esc(info.backup)} に戻す</button>` : ""}</div><p class="small muted">更新前にデータを別途バックアップし、アプリ本体だけを入れ替えます。旧版は1世代残します。データの保存先は変わりません。</p>`;
      $("veil").hidden = false;
    }
    document.addEventListener("click", async (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (b.id !== "update-btn" && !Object.keys(d).some(k => k.startsWith("update"))) return;
      if ("updateDismiss" in d) {
        $("update-notice").hidden = true;
        $("update-btn").focus();
        return;
      }
      if (updateBusy) return;
      updateBusy = true;
      b.disabled = true;
      try {
        if (b.id === "update-btn" || "updateOpen" in d) {
          const info = await api.updateInfo();
          updatePanel(info);
          $("update-notice").hidden = true;
          $("viewer").querySelector("button").focus();
        } else if ("updateRetry" in d) {
          updateNotice(await api.checkUpdate());
        }
        else if ("updateCheck" in d) {
          $("update-status").textContent = "確認中…";
          const info = await api.checkUpdate();
          updateNotice(info);
          $("update-notice").hidden = true;
          updatePanel(info);
        } else if ("updateDownload" in d) {
          $("update-status").textContent = "ダウンロード・検証中…（通信は最大3分、ZIP展開は最大4分）";
          const downloaded = await api.downloadUpdate();
          updatePanel({ ...updateState, ...downloaded, kind: "ready" }, "検証が完了しました。編集を確定してから再起動してください。");
        } else if ("updateApply" in d || "updateRollback" in d) {
          if (document.querySelector("#drawer:not([hidden]) #ef, #veil:not([hidden]) #memo-ed")) throw Error("編集中の内容を確定するか、編集画面を閉じてください。");
          if (!d.confirmed) { d.confirmed = "1"; b.textContent = "データを保存して再起動する"; b.disabled = false; return; }
          $("update-status").textContent = "データをバックアップして終了します…";
          await api.applyUpdate("updateRollback" in d);
        }
      } catch (e) {
        const message = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        if ("updateRetry" in d) updateNotice({ kind: "error", error: message });
        else if ($("update-status")) $("update-status").textContent = message;
        else toast(message.includes("No handler registered") ? "更新機能を使うにはアプリを開き直してください" : message);
      } finally { updateBusy = false; if (b.isConnected) b.disabled = false; }
    });
    void startupUpdateNotice();
    return { notice: updateNotice, startup: startupUpdateNotice, panel: updatePanel };
  }
  return { createUpdatesUI };
});
