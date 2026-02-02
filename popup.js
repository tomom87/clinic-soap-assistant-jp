document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusMsg = document.getElementById('status-msg');
  const resultText = document.getElementById('result-text');
  const copyBtn = document.getElementById('copy-btn');
  const openOptionsBtn = document.getElementById('open-options');

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

  // --- Initialize: Request Microphone Permission ---
  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // すぐに止める
      updateStatus('マイク使用が許可されました。');
    } catch (err) {
      console.error('Permission denied:', err);
      updateStatus('マイクの許可が必要です。設定を確認してください。', 'error');
    }
  };
  requestMicPermission();

  // --- UI Helpers ---
  const updateStatus = (msg, type = 'normal') => {
    statusMsg.textContent = msg;
    statusMsg.style.color = type === 'error' ? '#e74c3c' : (type === 'processing' ? '#3498db' : '#7f8c8d');
  };

  openOptionsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  const copyToClipboard = () => {
    if (!resultText.value) return;
    resultText.select();
    document.execCommand('copy');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'コピーしました!';
    setTimeout(() => copyBtn.textContent = originalText, 1500);
  };

  copyBtn.addEventListener('click', copyToClipboard);

  // --- API Key Management ---
  const getApiKey = async () => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['apiKeys', 'usageLog'], (result) => {
        const keys = result.apiKeys || [];
        // Check for at least one key
        if (!keys.some(k => k && k.trim() !== '')) {
          reject('APIキーが設定されていません。設定画面からキーを登録してください。');
          return;
        }

        const today = new Date().toISOString().split('T')[0];
        let usageLog = result.usageLog || { date: today, counts: [0, 0, 0, 0] };

        // Reset if date changed
        if (usageLog.date !== today) {
          usageLog = { date: today, counts: [0, 0, 0, 0] };
          chrome.storage.local.set({ usageLog });
        }

        // Find available key
        let activeKeyIndex = -1;
        for (let i = 0; i < keys.length; i++) {
          if (keys[i] && keys[i].trim() !== '') {
            if (usageLog.counts[i] < 20) {
              activeKeyIndex = i;
              break;
            }
          }
        }

        if (activeKeyIndex === -1) {
          reject('本日の全APIキー使用回数上限(計80回)に到達しました。');
          return;
        }

        resolve({ key: keys[activeKeyIndex], index: activeKeyIndex, usageLog });
      });
    });
  };

  const incrementUsageCount = (index, usageLog) => {
    usageLog.counts[index]++;
    chrome.storage.local.set({ usageLog });
  };

  // --- Audio Recording ---
  startBtn.addEventListener('click', async () => {
    try {
      // Prompt for microphone permission through getUserMedia
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          await processAudio(base64Audio);
        };

        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      updateStatus('録音中...', 'processing');
      startBtn.disabled = true;
      stopBtn.disabled = false;
      resultText.value = '';
      copyBtn.disabled = true;

    } catch (err) {
      console.error('Error starting recording:', err);
      updateStatus('マイクへのアクセスに失敗しました: ' + err.message, 'error');
    }
  });

  stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      updateStatus('音声処理中...', 'processing');
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  // --- Gemini API Call ---
  const processAudio = async (base64Audio) => {
    try {
      updateStatus('解析中 (Geminiへ送信)...', 'processing');
      const { key, index, usageLog } = await getApiKey();

      // Load custom prompt
      const storage = await new Promise(resolve => chrome.storage.local.get({ customPrompt: DEFAULT_PROMPT }, resolve));
      const activePrompt = storage.customPrompt || DEFAULT_PROMPT;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${key}`;

      const payload = {
        contents: [{
          parts: [
            { text: activePrompt },
            {
              inline_data: {
                mime_type: "audio/webm",
                data: base64Audio
              }
            }
          ]
        }]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const text = data.candidates[0].content.parts.map(p => p.text).join('');
        resultText.value = text;
        updateStatus('完了', 'normal');
        copyBtn.disabled = false;

        // Success - increment usage
        incrementUsageCount(index, usageLog);

        // Auto-copy to clipboard
        copyToClipboard();
      } else {
        throw new Error('No content generated by Gemini.');
      }

    } catch (err) {
      console.error('Error processing audio:', err);
      updateStatus('エラー: ' + err.message, 'error');
    }
  };
});
