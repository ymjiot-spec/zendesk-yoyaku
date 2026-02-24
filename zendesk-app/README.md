# Zendesk チケット履歴アプリ

このアプリは、Zendeskチケットの依頼者の過去の問い合わせ履歴を表示し、Amazon Bedrockを使用してAI要約を生成します。

## 機能

- 現在のチケットの依頼者の過去のチケット履歴を表示
- チケットを作成日時の降順でソート
- 各チケットの件名、作成日時、ステータスを表示
- Amazon Bedrock (Claude 3 Haiku) を使用したAI要約生成
- エラーハンドリングとロギング

## 必要な環境

- Zendesk Support
- AWS Lambda + API Gateway
- Amazon Bedrock (Claude 3 Haiku)
- Node.js 18.x以上（開発用）

## インストール

### 1. バックエンドのセットアップ

1. AWS Lambda関数をデプロイ（詳細は `lambda/` ディレクトリを参照）
2. API Gatewayを設定
3. API Keyを生成

### 2. Zendeskアプリのインストール

1. Zendesk Apps Framework CLI (zcli) をインストール:
   ```bash
   npm install -g @zendesk/zcli
   ```

2. アプリをパッケージ化:
   ```bash
   cd zendesk-app
   zcli apps:validate
   zcli apps:package
   ```

3. Zendesk管理画面からアプリをアップロード:
   - 管理 > アプリとインテグレーション > Zendesk Support アプリ
   - 「アップロード」をクリック
   - パッケージファイル (.zip) を選択
   - APIエンドポイントとAPIキーを設定

## 開発

### ローカルでのテスト（ZAF SDK不要）

ZAF SDKなしでUIと基本機能をテストする場合：

```bash
# test-local.htmlをブラウザで開く
open zendesk-app/test-local.html
```

このファイルはZAFClientのモック実装を含んでおり、Zendesk環境外でもアプリの動作を確認できます。

### ローカルでの実行（ZAF SDK使用）

Zendesk環境と連携してテストする場合：

```bash
cd zendesk-app
zcli apps:server
```

ブラウザで `https://localhost:4567` を開き、Zendeskインスタンスにログインします。

### テスト

```bash
npm test
```

## ディレクトリ構造

```
zendesk-app/
├── manifest.json          # アプリのメタデータと設定
├── assets/
│   ├── index.html        # メインHTML
│   ├── styles.css        # スタイルシート
│   └── main.js           # メインJavaScript
├── translations/
│   └── ja.json           # 日本語翻訳
└── README.md             # このファイル
```

## ライセンス

Private
