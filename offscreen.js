chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') {
        return false;
    }

    if (message.type === 'copy-data-to-clipboard') {
        (async () => {
            try {
                await navigator.clipboard.writeText(message.data);
                sendResponse({ success: true });
            } catch (err) {
                // Fallback to execCommand if clipboard API fails
                try {
                    const textElement = document.getElementById('copy-area');
                    textElement.value = message.data;
                    textElement.select();
                    document.execCommand('copy');
                    sendResponse({ success: true });
                } catch (fallbackErr) {
                    sendResponse({ success: false, error: fallbackErr.message });
                }
            }
        })();
        return true; // Keep channel open for async sendResponse
    }
});
