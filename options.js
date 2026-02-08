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

// Saves options to chrome.storage
const saveOptions = () => {
  const key1 = document.getElementById('key1').value;
  const key2 = document.getElementById('key2').value;
  const key3 = document.getElementById('key3').value;
  const key4 = document.getElementById('key4').value;
  const prompt = document.getElementById('prompt').value;

  chrome.storage.local.set(
    {
      apiKeys: [key1, key2, key3, key4],
      customPrompt: prompt
    },
    () => {
      // ... existing status logic ...
      // Update status to let user know options were saved.
      const status = document.getElementById('status');
      status.textContent = '設定を保存しました。';
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    }
  );
};

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
const restoreOptions = () => {
  chrome.storage.local.get({ apiKeys: ['', '', '', ''], customPrompt: DEFAULT_PROMPT }, (items) => {
    document.getElementById('key1').value = items.apiKeys[0] || '';
    document.getElementById('key2').value = items.apiKeys[1] || '';
    document.getElementById('key3').value = items.apiKeys[2] || '';
    document.getElementById('key4').value = items.apiKeys[3] || '';
    document.getElementById('prompt').value = items.customPrompt || DEFAULT_PROMPT;
  });
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('open-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
