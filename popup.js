document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusMsg = document.getElementById('status-msg');
  const openOptionsBtn = document.getElementById('open-options');
  const clearHistoryBtn = document.getElementById('clear-history');
  const resultsList = document.getElementById('results-list');
  const cardTemplate = document.getElementById('result-card-template');
  const micErrorContainer = document.getElementById('mic-error-container');
  const openSettingsBtn = document.getElementById('open-settings-btn');

  let mediaRecorder;
  let audioChunks = [];
  const MODEL_NAME = 'gemini-2.5-flash';
  const DEFAULT_PROMPT = `# Role
あなたは優秀な日本の診療クラークです。提供される「医師と患者の診察音声」を解析し、日本の標準的な電子カルテ（SOAP形式）に準拠した診療録を作成してください。

# Constraints
- 日本の医療現場で一般的に使われる略語（DM, HT, DL, 処方など）を適切に使用し、簡潔な箇条書きで構成してください。
- 診察に関係のない雑談はカットしますが、「P」の項目については以下の指示に従ってください。

# Output Format (SOAP)
【S: Subjective】患者の主訴、症状、訴え。
【O: Objective】バイタルデータ、診察所見、検査結果（音声から聞き取れる範囲で）。
【A: Assessment】医師の見立て、診断の方向性。
【P: Plan】
  - 今後の治療方針、処方変更、次回の予約、指導内容。

【Personal Context】
  - ★最重要：患者のプライベートな情報（家族の近況、趣味、記念日、生活上の出来事など）を独立した項目として必ず抽出してください（例：長男が来年成人式、来月旅行の予定、等）。

# Input Data
- 診察室の音声データ（audio/webm）

# Output Data
- コピーするテキストのみ（解説や挨拶は不要）`;

  // --- UI Helpers ---
  const updateStatus = (msg, type = 'normal') => {
    statusMsg.textContent = msg;
    statusMsg.style.color = type === 'error' ? '#e74c3c' : (type === 'processing' ? '#3498db' : '#7f8c8d');
  };

  const handleMicError = (err) => {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      updateStatus('マイクの許可が必要です。', 'error');
      micErrorContainer.style.display = 'block';
    } else {
      updateStatus('マイクエラー: ' + err.message, 'error');
    }
  };

  const addResultCard = (text, timestamp, isPast = false) => {
    const clone = cardTemplate.content.cloneNode(true);
    const card = clone.querySelector('.result-card');
    const timeSpan = clone.querySelector('.card-time');
    const textArea = clone.querySelector('.result-text');
    const copyBtn = clone.querySelector('.copy-btn');
    const deleteBtn = clone.querySelector('.delete-btn');

    // Store timestamp for history persistence
    const ts = timestamp || Date.now();
    card.dataset.timestamp = ts;

    const date = new Date(ts);
    timeSpan.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " " + date.toLocaleDateString();

    if (isPast) {
      card.classList.add('complete');
      textArea.value = text;
    }

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textArea.value);
        const icon = copyBtn.querySelector('i');
        icon.className = 'fas fa-check';
        setTimeout(() => icon.className = 'fas fa-copy', 1500);
      } catch (err) {
        console.error('Failed to copy keys: ', err);
        updateStatus('コピーに失敗しました', 'error');
      }
    });

    deleteBtn.addEventListener('click', () => {
      card.remove();
      saveHistory(); // Save immediately after deletion
    });

    resultsList.prepend(card);
    return card;
  };

  const saveHistory = async () => {
    const cards = document.querySelectorAll('.result-card.complete');
    const history = Array.from(cards).map(card => {
      const text = card.querySelector('.result-text').value;
      // Use existing dataset timestamp if available, else current time (fallback)
      const timestamp = parseInt(card.dataset.timestamp) || Date.now();
      return { text, timestamp };
    }).slice(0, 100);

    chrome.storage.local.set({ history: history.reverse() });
  };

  const updateCardContent = async (card, text) => {
    card.classList.add('complete');
    const textArea = card.querySelector('.result-text');
    textArea.value = text;
    saveHistory();

    try {
      await navigator.clipboard.writeText(text);
      updateStatus('最新の解析結果をコピーしました');
    } catch (err) {
      console.error('Auto-copy failed:', err);
      updateStatus('自動コピーに失敗しました', 'error');
    }
  };

  // --- API Key Management ---
  const getApiKey = async () => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['apiKeys', 'usageLog'], (result) => {
        const keys = result.apiKeys || [];
        if (!keys.some(k => k && k.trim() !== '')) return reject('APIキーが設定されていません。右上の歯車アイコンから設定してください。');
        const today = new Date().toISOString().split('T')[0];
        let usageLog = result.usageLog || { date: today, counts: [0, 0, 0, 0] };
        if (usageLog.date !== today) usageLog = { date: today, counts: [0, 0, 0, 0] };

        let activeIndex = keys.findIndex((k, i) => k && k.trim() !== '' && usageLog.counts[i] < 20);
        if (activeIndex === -1) return reject('全APIキーの使用回数上限に到達しました。');
        resolve({ key: keys[activeIndex], index: activeIndex, usageLog });
      });
    });
  };

  // --- Recording Logic ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micErrorContainer.style.display = 'none';
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          const newCard = addResultCard('', Date.now(), false);
          processAudio(base64Audio, newCard);
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      updateStatus('録音中...', 'processing');
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } catch (err) {
      handleMicError(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      updateStatus('解析リクエストを送信しました');
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  };

  const processAudio = async (base64Audio, card) => {
    try {
      const { key, index, usageLog } = await getApiKey();
      const storage = await new Promise(resolve => chrome.storage.local.get({ customPrompt: null }, resolve));
      const prompt = storage.customPrompt || DEFAULT_PROMPT;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "audio/webm", data: base64Audio } }] }]
        })
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      const text = data.candidates[0].content.parts.map(p => p.text).join('');

      updateCardContent(card, text);
      usageLog.counts[index]++;
      chrome.storage.local.set({ usageLog });

    } catch (err) {
      console.error('Process error:', err);
      const spinner = card.querySelector('.loading-spinner');
      if (spinner) {
        spinner.innerHTML = `<i class="fas fa-circle-exclamation"></i> エラー: ${err.message}`;
        spinner.style.color = '#e74c3c';
      }
    }
  };

  // --- Initialize: Load History and Request Permission ---
  const loadHistory = async () => {
    const result = await new Promise(resolve => chrome.storage.local.get({ history: [] }, resolve));
    result.history.forEach(item => {
      addResultCard(item.text, item.timestamp, true);
    });
  };

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      updateStatus('待機中');
      micErrorContainer.style.display = 'none';
    } catch (err) {
      console.warn('Microphone permission status:', err.name || err);
      handleMicError(err);
    }
  };

  // --- Events ---
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
  openOptionsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'options.html' });
  });
  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('すべての履歴を削除しますか？')) {
      resultsList.innerHTML = '';
      chrome.storage.local.set({ history: [] });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggle-recording") {
      (mediaRecorder && mediaRecorder.state === 'recording') ? stopRecording() : startRecording();
    }
  });

  openSettingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${chrome.runtime.id}` });
  });

  // --- Final Execution ---
  await loadHistory();
  requestMicPermission();
});
