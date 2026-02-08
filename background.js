// --- Side Panel Behavior ---
// アイコンクリック時にサイドパネルが開くように設定
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("SidePanel setting error:", error));

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-recording") {
    // サイドパネル（popup.js）に録音切り替えのメッセージを送信
    chrome.runtime.sendMessage({ action: "toggle-recording" }).catch(() => {
      // サイドパネルが開いていない場合は何もしない
      console.log("Side panel is likely closed. Cannot toggle recording.");
    });
  }
});
