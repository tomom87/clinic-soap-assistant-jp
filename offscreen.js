chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
    if (message.target !== 'offscreen') {
        return false;
    }

    if (message.type === 'copy-data-to-clipboard') {
        try {
            await navigator.clipboard.writeText(message.data);
        } catch (err) {
            // Fallback to execCommand if clipboard API fails (unlikely in offscreen doc with CLIPBOARD reason)
            const textElement = document.getElementById('copy-area');
            textElement.value = message.data;
            textElement.select();
            document.execCommand('copy');
        }
    }
}
