chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
    if (message.target !== 'offscreen') {
        return false;
    }

    if (message.type === 'copy-data-to-clipboard') {
        handleClipboardWrite(message.data);
    }
}

function handleClipboardWrite(data) {
    const textElement = document.getElementById('copy-area');
    textElement.value = data;
    textElement.select();
    document.execCommand('copy');

    // 処理が終わったら自身（offscreen）を閉じるようbackgroundに合図を送っても良いが、
    // background側で管理するためここでは何もしない。
}
