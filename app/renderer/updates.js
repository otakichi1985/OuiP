"use strict";
let updateState = null;
function updatePanel(info, message = "") {
  updateState = info;
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">アプリの更新</h3><button class="b quiet sm" data-vclose>閉じる</button></div><p>現在のバージョン：${esc(info.current)}</p><p id="update-status">${esc(message || (!info.supported ? "開発版・ソース起動では更新を適用しません。配布版で利用できます。" : "GitHubの正式リリースを確認します。"))}</p>${info.notes ? `<pre class="release-notes">${esc(info.notes)}</pre>` : ""}<div class="row">${info.supported ? `<button class="b sm" data-update-check>更新を確認</button>` : ""}${info.kind === "available" ? `<button class="b primary" data-update-download>v${esc(info.version)} をダウンロード</button>` : ""}${info.kind === "ready" ? `<button class="b primary" data-update-apply>更新して再起動</button>` : ""}${info.backup && info.supported ? `<button class="b quiet sm" data-update-rollback>v${esc(info.backup)} に戻す</button>` : ""}</div><p class="small muted">更新前にデータを別途バックアップし、アプリ本体だけを入れ替えます。旧版は1世代残します。データの保存先は変わりません。</p>`;
  $("veil").hidden = false;
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (b.id !== "update-btn" && !Object.keys(d).some(k => k.startsWith("update"))) return;
  b.disabled = true;
  try {
    if (b.id === "update-btn") updatePanel(await api.updateInfo());
    else if ("updateCheck" in d) {
      $("update-status").textContent = "確認中…";
      const info = await api.checkUpdate();
      updatePanel(info, { available: `v${info.version} に更新できます。`, current: "最新の正式版です。", unpublished: "配布リリースはまだ公開されていません。", unsupported: "配布版で利用できます。" }[info.kind]);
    } else if ("updateDownload" in d) {
      $("update-status").textContent = "ダウンロード・検証中…（最大3分）";
      const downloaded = await api.downloadUpdate();
      updatePanel({ ...updateState, ...downloaded, kind: "ready" }, "検証が完了しました。編集を確定してから再起動してください。");
    } else if ("updateApply" in d || "updateRollback" in d) {
      if (document.querySelector("#drawer:not([hidden]) form, #memo-ed")) throw Error("編集中の内容を確定するか、編集画面を閉じてください。");
      if (!d.confirmed) { d.confirmed = "1"; b.textContent = "データを保存して再起動する"; b.disabled = false; return; }
      $("update-status").textContent = "データをバックアップして終了します…";
      await api.applyUpdate("updateRollback" in d);
    }
  } catch (e) {
    const message = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    if ($("update-status")) $("update-status").textContent = message;
    else toast(message.includes("No handler registered") ? "更新機能を使うにはアプリを開き直してください" : message);
  } finally { if (b.isConnected) b.disabled = false; }
});