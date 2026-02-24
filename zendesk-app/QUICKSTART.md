# クイックスタート

このガイドでは、Zendeskチケット履歴アプリを最速で動作させる方法を説明します。

## 前提条件

- Zendesk Support アカウント（管理者権限）
- ブラウザ（Chrome、Firefox、Safari など）

## ステップ1: アプリのパッケージ化

### オプションA: 手動パッケージング（推奨）

1. 以下のファイルとフォルダを ZIP 形式で圧縮：
   ```
   manifest.json
   assets/
   translations/
   ```

2. ZIP ファイル名を `ticket-history-app.zip` にする

### オプションB: スクリプトを使用

```bash
cd zendesk-app
chmod +x package-app.sh
./package-app.sh
```

## ステップ2: Zendeskにアップロード

1. Zendesk Admin Center にログイン
2. **Apps and integrations** > **Apps** > **Zendesk Support apps** に移動
3. **Upload private app** をクリック
4. 作成した ZIP ファイルをアップロード
5. アプリ名を確認して **Upload** をクリック

## ステップ3: アプリの設定

アップロード後、設定画面が表示されます：

### 必須設定

- **API Endpoint**: 空白のままでOK（AI要約機能を使用しない場合）
- **API Key**: 空白のままでOK（AI要約機能を使用しない場合）

### AI要約機能を使用する場合

Lambda関数をデプロイ後、以下を設定：

- **API Endpoint**: `https://your-api-id.execute-api.region.amazonaws.com/prod/summarize`
- **API Key**: API Gatewayで生成したAPIキー

## ステップ4: アプリのインストール

1. 設定を保存
2. **Install** をクリック
3. インストール先を選択（すべてのエージェント、または特定のグループ）
4. **Install** をクリック

## ステップ5: 動作確認

1. Zendesk Support のチケット画面を開く
2. 右サイドバーに「Ticket History App」が表示される
3. アプリが自動的に依頼者の過去のチケット履歴を表示

## トラブルシューティング

### アプリが表示されない

- ブラウザをリフレッシュ（Cmd+R / Ctrl+R）
- ブラウザのキャッシュをクリア
- 別のチケットを開いてみる

### 「アプリの初期化に失敗しました」と表示される

- ブラウザのコンソールを開いてエラーメッセージを確認
- manifest.json の設定を確認
- アプリを再アップロード

### チケット履歴が表示されない

- 依頼者のメールアドレスで過去のチケットが存在するか確認
- ブラウザのコンソールでエラーメッセージを確認

### 要約ボタンが動作しない

- API設定が正しく設定されているか確認
- Lambda関数がデプロイされているか確認
- チケットを選択（チェックボックスをクリック）しているか確認

## 次のステップ

- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - 詳細なトラブルシューティング
- [README.md](README.md) - 完全なドキュメント
- [../infrastructure/README.md](../infrastructure/README.md) - Lambda関数のデプロイ

## サポート

問題が解決しない場合は、以下の情報を含めて報告してください：

1. エラーメッセージ（ブラウザのコンソールから）
2. 再現手順
3. Zendeskのバージョン
4. ブラウザの種類とバージョン
