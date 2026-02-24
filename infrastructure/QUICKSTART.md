# クイックスタートガイド

このガイドでは、API Gateway を最速でデプロイする方法を説明します。

## 前提条件

- AWS CLI がインストールされ、設定済み
- Lambda 関数 `zendesk-ticket-history-summarizer` がデプロイ済み
- 適切な AWS 権限

## 最速デプロイ（3ステップ）

### 1. ディレクトリに移動

```bash
cd infrastructure
```

### 2. デプロイスクリプトを実行

```bash
# すべてのオリジンを許可（開発環境向け）
./deploy.sh

# または、特定の Zendesk ドメインのみを許可（本番環境推奨）
ALLOWED_ORIGIN=https://yourcompany.zendesk.com ./deploy.sh
```

### 3. 出力された情報を確認

スクリプトが完了すると、以下の情報が表示されます：

- **API エンドポイント**: Zendesk アプリから呼び出す URL
- **API Key**: リクエストヘッダーに含める認証キー

これらの情報は `../zendesk-app/api-config.json` にも保存されます。

## 次のステップ

### Zendesk アプリの設定

1. `zendesk-app/api-config.json` を確認
2. Zendesk アプリのコードで API エンドポイントと API Key を使用
3. アプリをテスト

### API のテスト

```bash
# 環境変数を設定
export API_ENDPOINT="<your-api-endpoint>"
export API_KEY="<your-api-key>"

# テストリクエストを送信
curl -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -d '{
    "tickets": [
      {
        "subject": "テストチケット",
        "created_at": "2024-01-01T00:00:00Z",
        "status": "solved",
        "description": "これはテストです"
      }
    ]
  }'
```

## トラブルシューティング

### Lambda 関数が見つからない

```bash
# Lambda 関数の存在を確認
aws lambda list-functions --query 'Functions[?FunctionName==`zendesk-ticket-history-summarizer`]'

# Lambda 関数をデプロイ
cd ../lambda
# Lambda デプロイ手順に従う
```

### デプロイが失敗する

```bash
# スタックの状態を確認
aws cloudformation describe-stacks --stack-name zendesk-ticket-history-api

# エラーの詳細を確認
aws cloudformation describe-stack-events \
  --stack-name zendesk-ticket-history-api \
  --max-items 10
```

### API Key を再取得

```bash
# API Key ID を取得
API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name zendesk-ticket-history-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' \
  --output text)

# API Key の値を取得
aws apigateway get-api-key \
  --api-key $API_KEY_ID \
  --include-value \
  --query 'value' \
  --output text
```

## セキュリティ推奨事項

### 本番環境では必ず実施

1. **CORS の制限**
   ```bash
   ALLOWED_ORIGIN=https://yourcompany.zendesk.com ./deploy.sh
   ```

2. **API Key の定期ローテーション**
   - 3〜6ヶ月ごとに新しい API Key を作成
   - 古い API Key を無効化

3. **CloudWatch アラームの設定**
   - エラー率の監視
   - レイテンシの監視
   - 使用量の監視

## 詳細情報

- [完全なデプロイメントガイド](./README.md)
- [CORS 設定ガイド](./CORS-CONFIG.md)
- [CloudFormation テンプレート](./api-gateway.yaml)

## ヘルプ

```bash
./deploy.sh --help
```
