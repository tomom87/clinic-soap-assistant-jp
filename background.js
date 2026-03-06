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

// --- Offscreen Document for Clipboard Writing ---
let creating; // A global promise to avoid race conditions
async function setupOffscreenDocument(path) {
  // `hasDocument` Is the standard way in Manifest V3 to check if it exists
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) {
    return;
  }

  // Prevent multiple calls from trying to create the document at the exact same time
  if (creating) {
    await creating;
    return;
  }

  creating = chrome.offscreen.createDocument({
    url: path,
    reasons: ['CLIPBOARD'],
    justification: 'Copying generated text to clipboard automatically after long API response'
  });

  await creating;
  creating = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'write-to-clipboard') {
    (async () => {
      try {
        await setupOffscreenDocument('offscreen.html');
        // Send message to the offscreen document
        chrome.runtime.sendMessage({
          type: 'copy-data-to-clipboard',
          target: 'offscreen',
          data: msg.text
        });

        // Wait briefly for the offscreen document to process the copy
        await new Promise(resolve => setTimeout(resolve, 100));

        // Optionally close the offscreen document to save memory
        // await chrome.offscreen.closeDocument();

        sendResponse({ success: true });
      } catch (error) {
        console.error('Offscreen clipboard error:', error);
        sendResponse({ success: false, error: String(error.message || error) });
      }
    })();
    return true; // Keep message channel open for async response
  }
});
