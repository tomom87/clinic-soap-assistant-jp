// --- Side Panel Behavior ---
// アイコンクリック時にサイドパネルが開くように設定
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("SidePanel setting error:", error));

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-recording") {
    // サイドパネル（popup.js）に録音切り替えのメッセージを送信
    chrome.runtime.sendMessage({ action: "toggle-recording" }).catch((err) => {
      // サイドパネルが開いていない場合は何もしないが、デバッグ用にログは残す
      // エラーオブジェクトが undefined の場合もあるのでケア
      const msg = err ? err.message : "No receiver";
      console.log("Side panel is likely closed. Cannot toggle recording:", msg);
    });
  }
});
