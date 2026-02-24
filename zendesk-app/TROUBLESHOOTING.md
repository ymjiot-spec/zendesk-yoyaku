# トラブルシューティング

## アプリが動作しない場合

### 1. ZAF SDKが読み込まれない

**症状**: コンソールに「ZAFClient is not loaded」というエラーが表示される

**解決方法**:
- `index.html`で ZAF SDK のスクリプトタグが正しく配置されているか確認
- ネットワーク接続を確認
- ブラウザのキャッシュをクリア

### 2. API設定が見つからない

**症状**: 「API設定が見つかりません」というエラーが表示される

**解決方法**:
- Zendeskアプリの設定画面で `api_endpoint` と `api_key` が正しく設定されているか確認
- manifest.jsonの `parameters` セクションが正しく定義されているか確認

### 3. チケット履歴が表示されない

**症状**: 「過去のチケットはありません」と表示される

**原因**:
- 依頼者のメールアドレスで検索したチケットが存在しない
- 現在のチケットのみが存在する（現在のチケットは除外される）

**確認方法**:
- ブラウザのコンソールを開いて、エラーメッセージを確認
- Zendesk Search APIのレスポンスを確認

### 4. 要約ボタンが動作しない

**症状**: 要約ボタンをクリックしても何も起こらない

**解決方法**:
- チケットを選択しているか確認（チェックボックスをクリック）
- API設定が正しく設定されているか確認
- ブラウザのコンソールでエラーメッセージを確認

### 5. ローカルテストで動作確認

Zendesk環境外で動作確認する場合：

```bash
# ブラウザでtest-local.htmlを開く
open zendesk-app/test-local.html
```

このファイルはモックデータを使用してアプリの動作を確認できます。

## デバッグ方法

### コンソールログの確認

ブラウザの開発者ツールを開いて、コンソールタブを確認します：

1. Chrome: `Cmd + Option + J` (Mac) / `Ctrl + Shift + J` (Windows)
2. Firefox: `Cmd + Option + K` (Mac) / `Ctrl + Shift + K` (Windows)
3. Safari: `Cmd + Option + C` (Mac)

### ZAF Client APIの確認

コンソールで以下のコマンドを実行して、ZAF Clientが正しく動作しているか確認：

```javascript
// 現在のユーザー情報を取得
zafClient.get('currentUser').then(console.log);

// チケット情報を取得
zafClient.get('ticket.requester').then(console.log);

// アプリ設定を取得
zafClient.metadata().then(console.log);
```

### ネットワークリクエストの確認

ブラウザの開発者ツールのネットワークタブで、以下を確認：

1. Zendesk Search APIへのリクエストが成功しているか
2. API Gatewayへのリクエストが成功しているか
3. レスポンスの内容が正しいか

## よくある質問

### Q: アプリのサイズが小さすぎる/大きすぎる

A: `main.js`の`initializeApp()`関数で`zafClient.invoke('resize', { width: '100%', height: '100%' })`を呼び出していますが、必要に応じて高さを調整できます。

### Q: チケットの並び順を変更したい

A: `fetchTicketHistory()`関数の`tickets.sort()`部分を変更してください。

### Q: 要約の内容をカスタマイズしたい

A: `generateRuleBasedSummary()`関数を変更するか、Lambda関数のプロンプトを変更してください。

## サポート

問題が解決しない場合は、以下の情報を含めてサポートに連絡してください：

1. エラーメッセージ（コンソールログ）
2. 再現手順
3. Zendeskのバージョン
4. ブラウザの種類とバージョン
