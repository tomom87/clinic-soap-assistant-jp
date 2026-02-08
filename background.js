// --- Side Panel Behavior ---
// アイコンクリック時にサイドパネルを開く設定
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-recording") {
        // サイドパネル（popup.js）に録音切り替えのメッセージを送信
        chrome.runtime.sendMessage({ action: "toggle-recording" }).catch(() => {
            // サイドパネルが開いていない場合は、まず開くように促すか自動で開く
            // ※現状は開いている状態での操作を想定
            console.log("Side panel is likely closed. Cannot toggle recording.");
        });
    }
});
