# Privacy Policy (プライバシーポリシー)

## 1. データの収集と使用 (Data Collection and Usage)
AI Medical Scribe（以下「本拡張機能」）は、ユーザーのプライバシーを最優先に設計されています。

- **音声データ**: ユーザーが録音した音声データは、ブラウザの一時メモリ内でのみ処理されます。音声データが開発者や第三者のサーバーに送信、保存されることは一切ありません。
- **解析テキスト**: 生成された診療録（SOAP形式のテキスト）は、ユーザー自身のブラウザ内でのみ表示され、外部に自動送信・保存されることはありません。
- **設定情報**: APIキーやプロンプト設定は、ブラウザの `chrome.storage` 領域にのみ保存され、複数の端末間で同期されることもありません（Local Storage）。

## 2. APIとの通信 (API Communication)
本拡張機能は、AI解析のために Google Gemini API を使用します。
- 音声およびプロンプトデータは、ユーザーのブラウザから直接 Google のサーバーへ送信されます。
- 中間サーバーを介した通信は一切行っていません。
- Google API の利用規約およびプライバシーポリシーについては、[Google の公式ドキュメント](https://ai.google.dev/terms)をご確認ください。

## 3. データの共有 (Data Sharing)
本拡張機能は、ユーザーの個人情報、音声データ、または解析結果をいかなる第三者にも販売、共有、または提供することはありません。

## 4. パーミッションの使用目的 (Permissions)
- `storage`: APIキーやユーザーの設定（プロンプト等）をブラウザ内に安全に保存するために使用します。
- `activeTab`: 音声入力の開始や、利便性の向上のために現在のタブ情報を参照する場合があります（データ収集目的ではありません）。

---

# Single Purpose Description (単一目的の記述)
AI Medical Scribe is an extension designed for the sole purpose of assisting medical professionals in generating SOAP-formatted medical notes from consultation audio using the Gemini AI API.
（AI Medical Scribeは、Gemini AI APIを使用して、診察の音声からSOAP形式の診療録を生成することを唯一の目的とする拡張機能です。）
