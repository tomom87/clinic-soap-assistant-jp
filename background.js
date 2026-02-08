// --- Side Panel Behavior ---
// アイコンクリック時にサイドパネルが開くように設定
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-recording") {
        chrome.runtime.sendMessage({ action: "toggle-recording" }).catch(() => {
            console.log("Side panel is closed. Recording toggle ignored.");
        });
    }
});
