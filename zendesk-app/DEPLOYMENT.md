# Zendesk Ticket History App - デプロイメントガイド

## 概要

このドキュメントは、Zendesk Ticket History Appのデプロイメント手順を説明します。

## 前提条件

- Zendesk Support インスタンスへの管理者アクセス
- AWS Lambda + API Gateway のデプロイ完了（バックエンド）
- API エンドポイントと API Key の取得

## 使用するZendesk API

このアプリは以下のZendesk APIを使用します：

### 1. ZAF Client API
- **ticket.requester**: 現在のチケットの依頼者情報を取得
- **ticket.id**: 現在のチケットIDを取得
- **metadata**: アプリの設定パラメータ（API エンドポイント、API Key）を取得

### 2. Zendesk Search API
- **エンドポイント**: `/api/v2/search.json`
- **用途**: 依頼者のメールアドレスで過去のチケットを検索
- **クエリ形式**: `type:ticket requester:{email}`

### 必要な権限

manifest.jsonで以下が設定されています：

```json
{
  "domainWhitelist": [
    "*.execute-api.*.amazonaws.com"
  ]
}
```

これにより、AWS API Gatewayへの外部APIリクエストが許可されます。

## パッケージング手順

### 方法1: zcli を使用（推奨）

1. zcli をインストール（未インストールの場合）:
```bash
npm install -g @zendesk/zcli
```

2. パッケージングスクリプトを実行:
```bash
cd zendesk-app
chmod +x package-app.sh
./package-app.sh
```

3. 生成されたZIPファイルを確認

### 方法2: 手動パッケージング

1. 以下のファイルとディレクトリをZIP形式で圧縮:
   - manifest.json
   - assets/
   - translations/

2. ZIPファイル名: `ticket-history-app-v1.0.0.zip`

## Zendeskへのアップロード手順

1. **Zendesk Admin Centerにログイン**
   - あなたのZendeskインスタンスの管理画面にアクセス

2. **Apps管理画面に移動**
   - Apps and integrations > Apps > Zendesk Support apps

3. **プライベートアプリをアップロード**
   - 右上の「Upload private app」ボタンをクリック
   - パッケージファイル（ZIPファイル）を選択してアップロード

4. **アプリをインストール**
   - アップロード後、「Install」をクリック

5. **設定パラメータを入力**
   
   以下の2つのパラメータを設定します：
   
   - **api_endpoint**: AWS API Gatewayのエンドポイント
     - 形式: `https://{api-id}.execute-api.{region}.amazonaws.com/prod/summarize`
     - 例: `https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/summarize`
   
   - **api_key**: API Gateway API Key
     - AWS CloudFormationのOutputsまたはAPI Gateway管理画面から取得
     - セキュアパラメータとして保存されます

6. **インストールを完了**
   - 「Install」をクリックして完了

## 動作確認

1. Zendeskのチケット画面を開く
2. 右サイドバーに「Ticket History App」が表示されることを確認
3. 過去のチケット一覧が表示されることを確認
4. 「要約する」ボタンをクリックしてAI要約が生成されることを確認

## トラブルシューティング

### アプリが表示されない
- manifest.jsonの`location`設定を確認
- ブラウザのキャッシュをクリアして再読み込み

### API接続エラー
- API エンドポイントのURLが正しいか確認
- API Keyが正しいか確認
- AWS API GatewayのCORS設定を確認
- ブラウザの開発者ツールでネットワークエラーを確認

### 過去のチケットが表示されない
- 依頼者のメールアドレスが正しく取得できているか確認
- Zendesk Search APIの権限を確認
- ブラウザのコンソールログでエラーを確認

## バージョン管理

manifest.jsonの`version`フィールドを更新してバージョンを管理します：

```json
{
  "version": "1.0.0"
}
```

新しいバージョンをデプロイする際は：
1. バージョン番号を更新
2. 再度パッケージング
3. Zendesk Admin Centerで既存のアプリを更新

## セキュリティに関する注意事項

- API Keyは必ず`secure: true`パラメータとして設定
- ローカルストレージには顧客情報を保存しない（実装済み）
- HTTPS通信のみを使用
- API GatewayでCORS設定を適切に制限

## サポート

問題が発生した場合は、以下を確認してください：
- ブラウザのコンソールログ
- AWS CloudWatch Logs（Lambda関数のログ）
- Zendesk App Logs（Admin Center > Apps > Manage）
