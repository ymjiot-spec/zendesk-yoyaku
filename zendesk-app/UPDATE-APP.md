# アプリの更新手順

修正したアプリをZendeskに反映させる手順です。

## ステップ1: 現在のアプリをアンインストール

1. Zendesk Admin Center にログイン
2. **Apps and integrations** > **Apps** > **Zendesk Support apps** に移動
3. 「Ticket History App」を見つける
4. アプリ名をクリック
5. 右上の **Uninstall** をクリック
6. 確認ダイアログで **Uninstall** をクリック

## ステップ2: 新しいZIPファイルを作成

### 方法A: 手動でZIPを作成（推奨）

1. Finderで `zendesk-app` フォルダを開く
2. 以下のファイル/フォルダを選択：
   - `manifest.json`
   - `assets` フォルダ
   - `translations` フォルダ
3. 右クリック > **圧縮**
4. 作成されたZIPファイルの名前を `ticket-history-app.zip` に変更

### 方法B: コマンドラインで作成

```bash
cd zendesk-app
zip -r ticket-history-app.zip manifest.json assets/ translations/ -x "*.DS_Store" "*.git*"
```

## ステップ3: 新しいアプリをアップロード

1. Zendesk Admin Center で **Apps and integrations** > **Apps** > **Zendesk Support apps** に移動
2. **Upload private app** をクリック
3. 作成した `ticket-history-app.zip` を選択
4. **Upload** をクリック

## ステップ4: アプリを設定

1. アプリ名を確認（Ticket History App）
2. 設定画面で以下を入力：
   - **API Endpoint**: 空白のまま（または Lambda の URL）
   - **API Key**: 空白のまま（または API Key）
3. **Install** をクリック

## ステップ5: インストール先を選択

1. **Install for all agents** を選択（推奨）
2. または特定のグループを選択
3. **Install** をクリック

## ステップ6: 動作確認

1. Zendeskのチケット画面を開く
2. ブラウザを完全にリフレッシュ（Cmd+Shift+R / Ctrl+Shift+R）
3. 右サイドバーに「Ticket History App」が表示される
4. ブラウザのコンソールを開いて、ログメッセージを確認：
   ```
   Script loaded, document.readyState: ...
   ZAFClient available: true
   Initializing ZAF Client...
   ZAF initialized successfully
   ```

## トラブルシューティング

### アプリが表示されない

1. ブラウザのキャッシュをクリア
2. シークレット/プライベートウィンドウで開く
3. 別のチケットを開いてみる

### コンソールにエラーが表示される

1. エラーメッセージをコピー
2. `TROUBLESHOOTING.md` を参照
3. 必要に応じてサポートに連絡

### 「ZAF SDKの読み込みに失敗しました」と表示される

1. インターネット接続を確認
2. Zendeskのステータスページを確認
3. 別のブラウザで試す

## 確認すべきログメッセージ

正常に動作している場合、コンソールに以下のようなメッセージが表示されます：

```
Script loaded, document.readyState: interactive
ZAFClient available: true
safeInit called
DOM already ready, initializing immediately
Initializing ZAF Client...
Waiting for ZAF to be ready...
ZAF initialized successfully
API設定を読み込みました
App resized successfully
```

## 次のステップ

アプリが正常に動作したら：

1. 実際のチケットで動作確認
2. 複数のエージェントでテスト
3. AI要約機能を使用する場合は Lambda をデプロイ
