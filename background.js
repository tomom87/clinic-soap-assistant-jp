// --- Side Panel Behavior ---
// インストール・更新時にサイドパネルの動作を設定
chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
});

// アイコンクリック時の予備動作（念のため）
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

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
