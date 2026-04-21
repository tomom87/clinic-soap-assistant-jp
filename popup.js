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
  let activeStream = null; // 録音停止時にトラックを確実に止めるための参照
  const MODEL_NAME = 'gemini-3.1-flash-lite-preview';
  // 音声キャプチャ制約：音声認識用途なのでモノラル/16kHz/低ビットレートに固定
  const AUDIO_CONSTRAINTS = {
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };
  const RECORDER_OPTIONS = {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 24000
  };
  const RECORDER_TIMESLICE_MS = 1000; // 1秒ごとにチャンクを吐き出し、stop 時のBlob化を軽量化

  // 大きな Blob を高速に base64 化する（FileReader.readAsDataURL より速く、メモリも安定）
  const blobToBase64Fast = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const CHUNK = 0x8000; // 32KB ずつ fromCharCode.apply
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  };
  const getErrorMessage = (err) => {
    if (!err) return '不明なエラーが発生しました。';
    if (typeof err === 'string') return err;
    if (err instanceof Error && err.message) return err.message;
    return String(err);
  };
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
    const message = getErrorMessage(err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      updateStatus('マイクの許可が必要です。', 'error');
      micErrorContainer.style.display = 'block';
    } else {
      updateStatus('マイクエラー: ' + message, 'error');
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
      } catch (err) {
        // サイドパネルにフォーカスがない場合等、offscreen経由でフォールバック
        try {
          const response = await chrome.runtime.sendMessage({ action: 'write-to-clipboard', text: textArea.value });
          if (!response || !response.success) {
            throw new Error(response?.error || 'コピーに失敗しました');
          }
        } catch (fallbackErr) {
          console.error('Copy failed:', fallbackErr);
          updateStatus('コピーに失敗しました', 'error');
          return;
        }
      }
      const icon = copyBtn.querySelector('i');
      icon.className = 'fas fa-check';
      setTimeout(() => icon.className = 'fas fa-copy', 1500);
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
      // ユーザーのフォーカスが外れてタイムアウトした場合でもコピーできるようBackground経由で実行
      const response = await chrome.runtime.sendMessage({ action: 'write-to-clipboard', text: text });
      if (response && response.success) {
        updateStatus('最新の解析結果をコピーしました');
      } else {
        throw new Error(response ? response.error : 'No response from background');
      }
    } catch (err) {
      console.error('Auto-copy failed:', err);
      updateStatus('自動コピーに失敗: ' + getErrorMessage(err), 'error');
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
      const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      activeStream = stream;
      micErrorContainer.style.display = 'none';
      // 環境が指定 mimeType に対応していなければデフォルトにフォールバック
      let recorderOpts = RECORDER_OPTIONS;
      if (typeof MediaRecorder.isTypeSupported === 'function'
          && !MediaRecorder.isTypeSupported(RECORDER_OPTIONS.mimeType)) {
        recorderOpts = { audioBitsPerSecond: RECORDER_OPTIONS.audioBitsPerSecond };
      }
      mediaRecorder = new MediaRecorder(stream, recorderOpts);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          const mimeType = mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunks, { type: mimeType });
          const newCard = addResultCard('', Date.now(), false);
          const base64Audio = await blobToBase64Fast(audioBlob);
          // API の inline_data.mime_type は codec パラメータ無しの方が安全
          const pureMime = mimeType.split(';')[0];
          processAudio(base64Audio, newCard, pureMime);
        } catch (err) {
          console.error('Post-stop processing error:', err);
          updateStatus('音声変換に失敗: ' + getErrorMessage(err), 'error');
        } finally {
          if (activeStream) {
            activeStream.getTracks().forEach(track => track.stop());
            activeStream = null;
          }
        }
      };

      // timeslice を指定して録音中にチャンクを分割取得（stop 時のブロッキングを回避）
      mediaRecorder.start(RECORDER_TIMESLICE_MS);
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

  // SSE / JSON 配列どちらで返ってきても解釈できる寛容なストリームパーサ
  const consumeGeminiStream = async (response, onDelta) => {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isSSE = contentType.includes('event-stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let rawAll = '';
    let accumulated = '';
    let blockedReason = null;
    let finishReason = null;

    const handleJson = (obj) => {
      if (!obj) return;
      if (obj.promptFeedback?.blockReason) blockedReason = obj.promptFeedback.blockReason;
      const cand = obj.candidates?.[0];
      if (cand?.finishReason) finishReason = cand.finishReason;
      const parts = cand?.content?.parts;
      if (Array.isArray(parts)) {
        const delta = parts.map(p => p.text || '').join('');
        if (delta) {
          accumulated += delta;
          onDelta(accumulated, delta);
        }
      }
    };

    // SSE 用: CRLF 正規化してから \n\n 区切りで 1 イベントずつ処理
    const drainSSE = (flush = false) => {
      sseBuffer = sseBuffer.replace(/\r\n/g, '\n');
      let sep;
      while ((sep = sseBuffer.indexOf('\n\n')) >= 0) {
        const rawEvent = sseBuffer.slice(0, sep);
        sseBuffer = sseBuffer.slice(sep + 2);
        const payload = rawEvent
          .split('\n')
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).replace(/^\s/, ''))
          .join('\n')
          .trim();
        if (!payload || payload === '[DONE]') continue;
        try { handleJson(JSON.parse(payload)); }
        catch (e) { console.warn('SSE parse skipped:', e.message, payload.slice(0, 200)); }
      }
      if (flush && sseBuffer.trim()) {
        // flush 時の末尾残留（通常は空）
        const payload = sseBuffer.split('\n').filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).replace(/^\s/, '')).join('\n').trim();
        if (payload && payload !== '[DONE]') {
          try { handleJson(JSON.parse(payload)); } catch {}
        }
        sseBuffer = '';
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawAll += chunk;
      if (isSSE) {
        sseBuffer += chunk;
        drainSSE(false);
      }
    }
    const tail = decoder.decode();
    if (tail) {
      rawAll += tail;
      if (isSSE) { sseBuffer += tail; }
    }
    if (isSSE) drainSSE(true);

    // フォールバック: SSE と見なしたのに何も取れない or そもそもJSON配列で返ってきた
    if (!accumulated) {
      const trimmed = rawAll.trim();
      try {
        if (trimmed.startsWith('[')) {
          // Gemini の非SSEストリーミング: JSON配列
          const arr = JSON.parse(trimmed);
          if (Array.isArray(arr)) arr.forEach(handleJson);
        } else if (trimmed.startsWith('{')) {
          handleJson(JSON.parse(trimmed));
        } else {
          // "data: {...}" 形式だが Content-Type が違うケース
          const lines = trimmed.split(/\r?\n/).filter(l => l.startsWith('data:'));
          for (const l of lines) {
            const p = l.slice(5).trim();
            if (!p || p === '[DONE]') continue;
            try { handleJson(JSON.parse(p)); } catch {}
          }
        }
      } catch (e) {
        console.warn('Fallback JSON parse failed:', e.message);
      }
    }

    // デバッグ: 何も取れない場合、原文の先頭を開発者ツールに残す
    if (!accumulated) {
      console.warn('[AI Medical Scribe] stream produced no text.',
        { contentType, bytes: rawAll.length, head: rawAll.slice(0, 500) });
    }

    return { text: accumulated, blockedReason, finishReason, contentType, raw: rawAll };
  };

  // 非ストリーミング呼び出し（フォールバック用）
  const callGenerateContentOnce = async (key, body) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const apiMessage = data?.error?.message;
      throw new Error(apiMessage ? `API Error: ${apiMessage}` : `API Error: ${res.status}`);
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    const finishReason = data?.candidates?.[0]?.finishReason;
    const blockedReason = data?.promptFeedback?.blockReason;
    const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() : '';
    return { text, blockedReason, finishReason };
  };

  const processAudio = async (base64Audio, card, mimeType = 'audio/webm') => {
    const textArea = card.querySelector('.result-text');
    const spinner = card.querySelector('.loading-spinner');
    try {
      const { key, index, usageLog } = await getApiKey();
      const storage = await new Promise(resolve => chrome.storage.local.get({ customPrompt: null }, resolve));
      const prompt = storage.customPrompt || DEFAULT_PROMPT;

      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Audio } }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 1024
        }
      });

      let response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:streamGenerateContent?alt=sse&key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
            body
          }
        );
      } catch (networkErr) {
        if (networkErr instanceof TypeError) {
          throw new Error('通信に失敗しました。manifest の host_permissions / ネットワーク接続 / APIキー設定を確認してください。');
        }
        throw networkErr;
      }

      if (!response.ok) {
        // ストリームではなく JSON エラーが返ってくることがある
        let apiMessage;
        try {
          const errData = await response.json();
          apiMessage = errData?.error?.message;
        } catch {}
        throw new Error(apiMessage ? `API Error: ${apiMessage}` : `API Error: ${response.status}`);
      }

      // 最初の delta が来た瞬間にスピナーを消してカードを表示状態へ
      card.classList.add('complete');
      updateStatus('解析中（ストリーミング受信）', 'processing');

      let firstDeltaShown = false;
      let { text, blockedReason, finishReason } = await consumeGeminiStream(response, (accumulated) => {
        if (!firstDeltaShown && spinner) {
          spinner.style.display = 'none';
          firstDeltaShown = true;
        }
        textArea.value = accumulated;
      });

      // ストリームから何も取り出せなかった場合、安全ネットとして非ストリーミングで再試行
      if ((!text || !text.trim()) && !blockedReason) {
        console.warn('[AI Medical Scribe] streaming returned empty; retrying with non-streaming endpoint');
        updateStatus('ストリームが空、通常リクエストで再試行中', 'processing');
        const fb = await callGenerateContentOnce(key, body);
        text = fb.text;
        blockedReason = fb.blockedReason || blockedReason;
        finishReason = fb.finishReason || finishReason;
        if (text) textArea.value = text;
      }

      if (!text || !text.trim()) {
        if (blockedReason) throw new Error(`生成がブロックされました: ${blockedReason}`);
        if (finishReason && finishReason !== 'STOP') {
          throw new Error(`生成が途中終了しました (finishReason: ${finishReason})`);
        }
        throw new Error('生成テキストが空です。');
      }

      // 最終テキストの確定・履歴保存・自動コピー
      await updateCardContent(card, text.trim());
      usageLog.counts[index]++;
      chrome.storage.local.set({ usageLog });

    } catch (err) {
      console.error('Process error:', err);
      const message = getErrorMessage(err);
      updateStatus(`エラー: ${message}`, 'error');
      // CSS の .complete 状態では spinner が非表示になるため、エラー時は complete を剥がす
      card.classList.remove('complete');
      if (spinner) {
        spinner.style.display = '';
        spinner.innerHTML = `<i class="fas fa-circle-exclamation"></i> エラー: ${message}`;
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
