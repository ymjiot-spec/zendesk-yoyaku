# Lambda Function クイックスタートガイド

最も簡単な Lambda 関数のデプロイ方法です。

## 1分でデプロイ

```bash
cd infrastructure
./lambda-deploy.sh
```

これだけです！スクリプトが自動的に以下を実行します：

✅ 依存関係のインストール  
✅ デプロイメントパッケージの作成  
✅ IAM ロールの作成（Bedrock アクセス権限付き）  
✅ Lambda 関数の作成  
✅ 環境変数の設定  

## カスタム設定

### 別のリージョンを使用

```bash
BEDROCK_REGION=us-west-2 ./lambda-deploy.sh
```

### 別のモデルを使用

```bash
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 ./lambda-deploy.sh
```

### 両方を指定

```bash
BEDROCK_REGION=us-west-2 \
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 \
./lambda-deploy.sh
```

## 利用可能なモデル

| モデル | ID | 特徴 |
|--------|-----|------|
| **Haiku** (推奨) | `anthropic.claude-3-haiku-20240307-v1:0` | 高速・低コスト |
| Sonnet | `anthropic.claude-3-sonnet-20240229-v1:0` | バランス型 |
| Opus | `anthropic.claude-3-opus-20240229-v1:0` | 最高品質 |

## 動作確認

```bash
aws lambda invoke \
  --function-name zendesk-ticket-history-summarizer \
  --payload '{"body":"{\"tickets\":[{\"subject\":\"テスト\",\"created_at\":\"2024-01-01T00:00:00Z\",\"status\":\"solved\"}]}"}' \
  response.json

cat response.json
```

## 次のステップ

Lambda 関数のデプロイが完了したら、API Gateway をデプロイします：

```bash
./deploy.sh
```

## トラブルシューティング

### エラー: "User is not authorized to perform: bedrock:InvokeModel"

Bedrock のモデルアクセスをリクエストしてください：

1. AWS コンソール > Amazon Bedrock
2. 左メニュー > Model access
3. "Manage model access" をクリック
4. Anthropic の Claude モデルを有効化

### エラー: "Cannot find module"

依存関係を再インストールしてください：

```bash
cd lambda
npm install --production
cd ../infrastructure
./lambda-deploy.sh
```

## 詳細情報

詳細なデプロイ手順やトラブルシューティングについては、[LAMBDA-DEPLOYMENT.md](LAMBDA-DEPLOYMENT.md) を参照してください。
