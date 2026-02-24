# インフラストラクチャ デプロイメントガイド

このディレクトリには、Zendesk Ticket History App のインフラストラクチャを設定するためのスクリプトとテンプレートが含まれています。

## 概要

デプロイメントは以下の2つのステップで構成されます：

1. **Lambda 関数のデプロイ** - Bedrock を使用した要約生成機能
2. **API Gateway のデプロイ** - Lambda 関数への REST API エンドポイント

## クイックスタート

```bash
# 1. Lambda 関数をデプロイ
./lambda-deploy.sh

# 2. API Gateway をデプロイ
./deploy.sh
```

詳細な手順については、以下のドキュメントを参照してください：
- [Lambda デプロイメントガイド](LAMBDA-DEPLOYMENT.md)
- [API Gateway デプロイメントガイド](#api-gateway-デプロイメント)（このドキュメント）

---

# Lambda Function デプロイメント

Lambda 関数のデプロイについては、[LAMBDA-DEPLOYMENT.md](LAMBDA-DEPLOYMENT.md) を参照してください。

簡単なデプロイ方法：

```bash
cd infrastructure
./lambda-deploy.sh
```

環境変数のカスタマイズ：

```bash
BEDROCK_REGION=us-west-2 BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 ./lambda-deploy.sh
```

---

# API Gateway デプロイメント

## 前提条件

- AWS CLI がインストールされ、設定されていること
- Lambda 関数が既にデプロイされていること（上記参照）
- 適切な AWS 権限（API Gateway、Lambda の作成・管理権限）

## デプロイ手順

### 1. Lambda 関数の ARN を取得

```bash
aws lambda get-function --function-name zendesk-ticket-history-summarizer --query 'Configuration.FunctionArn' --output text
```

### 2. CloudFormation スタックをデプロイ

```bash
aws cloudformation create-stack \
  --stack-name zendesk-ticket-history-api \
  --template-body file://api-gateway.yaml \
  --parameters \
    ParameterKey=LambdaFunctionArn,ParameterValue=<YOUR_LAMBDA_ARN> \
    ParameterKey=LambdaFunctionName,ParameterValue=zendesk-ticket-history-summarizer \
  --capabilities CAPABILITY_IAM
```

### 3. デプロイの完了を待つ

```bash
aws cloudformation wait stack-create-complete \
  --stack-name zendesk-ticket-history-api
```

### 4. API エンドポイントと API Key を取得

```bash
# API エンドポイント
aws cloudformation describe-stacks \
  --stack-name zendesk-ticket-history-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text

# API Key ID
aws cloudformation describe-stacks \
  --stack-name zendesk-ticket-history-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' \
  --output text
```

### 5. API Key の値を取得

```bash
API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name zendesk-ticket-history-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' \
  --output text)

aws apigateway get-api-key \
  --api-key $API_KEY_ID \
  --include-value \
  --query 'value' \
  --output text
```

## 設定内容

### API Gateway REST API

- **API 名**: zendesk-ticket-history-api
- **エンドポイント**: `/summarize`
- **メソッド**: POST
- **認証**: API Key 認証

### CORS 設定

以下のヘッダーが設定されています：

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: Content-Type,X-Api-Key`
- `Access-Control-Allow-Methods: POST,OPTIONS`

**注意**: 本番環境では、`Access-Control-Allow-Origin` を Zendesk の特定のドメインに制限することを推奨します。

### API Key と使用量プラン

- **月間クォータ**: 10,000 リクエスト
- **レート制限**: 50 リクエスト/秒
- **バースト制限**: 100 リクエスト

## 更新手順

スタックを更新する場合：

```bash
aws cloudformation update-stack \
  --stack-name zendesk-ticket-history-api \
  --template-body file://api-gateway.yaml \
  --parameters \
    ParameterKey=LambdaFunctionArn,ParameterValue=<YOUR_LAMBDA_ARN> \
    ParameterKey=LambdaFunctionName,ParameterValue=zendesk-ticket-history-summarizer \
  --capabilities CAPABILITY_IAM
```

## 削除手順

スタックを削除する場合：

```bash
aws cloudformation delete-stack \
  --stack-name zendesk-ticket-history-api
```

## トラブルシューティング

### Lambda 実行権限エラー

Lambda 関数に API Gateway からの実行権限が付与されていることを確認してください。CloudFormation テンプレートには `LambdaInvokePermission` リソースが含まれています。

### CORS エラー

OPTIONS メソッドが正しく設定されていることを確認してください。ブラウザの開発者ツールでプリフライトリクエストを確認できます。

### API Key エラー

リクエストヘッダーに `X-Api-Key` が含まれていることを確認してください：

```javascript
fetch(apiEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'your-api-key-here'
  },
  body: JSON.stringify({ tickets: [...] })
});
```

## セキュリティ推奨事項

1. **CORS の制限**: 本番環境では、`Access-Control-Allow-Origin` を Zendesk の特定のドメインに制限してください。

2. **API Key の管理**: API Key は安全に保管し、定期的にローテーションしてください。

3. **使用量の監視**: CloudWatch を使用して API の使用状況を監視し、異常なトラフィックを検出してください。

4. **ログの有効化**: API Gateway のアクセスログと実行ログを有効にして、監査とトラブルシューティングに活用してください。
