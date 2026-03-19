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
let creating; // Promise to avoid race conditions during creation

async function setupOffscreenDocument(path) {
  // Check if document already exists
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  // Handle concurrent creation requests
  if (creating) {
    await creating;
    return;
  }

  console.log("Creating offscreen document...");
  try {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['CLIPBOARD'],
      justification: 'Automated clipboard copy of medical records to EHR after long AI processing'
    });
    await creating;
  } catch (err) {
    console.error("Failed to create offscreen document:", err);
    throw err;
  } finally {
    creating = null;
  }
}

async function handleWriteToClipboard(text, sendResponse) {
  try {
    await setupOffscreenDocument('offscreen.html');

    // Retry sending message to offscreen, as it might not be ready the microsecond it's created
    let success = false;
    for (let i = 0; i < 5; i++) {
      try {
        await chrome.runtime.sendMessage({
          type: 'copy-data-to-clipboard',
          target: 'offscreen',
          data: text
        });
        success = true;
        break;
      } catch (e) {
        console.warn(`Retry ${i + 1} to contact offscreen doc...`);
        await new Promise(r => setTimeout(r, 200)); // Wait 200ms
      }
    }

    if (success) {
      sendResponse({ success: true });
    } else {
      throw new Error("オフスクリーンドキュメントへの通信に失敗しました（リトライ上限到達）");
    }
  } catch (error) {
    console.error('Background clipboard error:', error);
    sendResponse({ success: false, error: error.message || String(error) });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'write-to-clipboard') {
    handleWriteToClipboard(msg.text, sendResponse);
    return true; // Keep channel open for async sendResponse
  }
});

