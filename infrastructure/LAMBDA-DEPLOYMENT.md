# Lambda Function デプロイメントガイド

このガイドでは、Zendesk Ticket History Lambda 関数のデプロイ方法を説明します。

## 前提条件

- AWS CLI がインストールされ、設定されていること
- Node.js 18.x 以上がインストールされていること
- 適切な AWS 権限（Lambda、IAM、CloudWatch の作成・管理権限）
- Amazon Bedrock へのアクセス権限

## 環境変数

Lambda 関数は以下の環境変数を使用します：

| 環境変数 | 説明 | デフォルト値 |
|---------|------|------------|
| `BEDROCK_REGION` | Bedrock API のリージョン | `us-east-1` |
| `BEDROCK_MODEL_ID` | 使用する Bedrock モデル ID | `anthropic.claude-3-haiku-20240307-v1:0` |

### 利用可能なモデル

- `anthropic.claude-3-haiku-20240307-v1:0` - 高速で低コスト（推奨）
- `anthropic.claude-3-sonnet-20240229-v1:0` - バランス型
- `anthropic.claude-3-opus-20240229-v1:0` - 最高品質

## デプロイ方法

### 方法 1: シェルスクリプトを使用（推奨）

最も簡単な方法です。スクリプトが自動的に以下を実行します：
- 依存関係のインストール
- デプロイメントパッケージの作成
- IAM ロールの作成（必要な場合）
- Lambda 関数の作成または更新

#### 基本的な使用方法

```bash
cd infrastructure
chmod +x lambda-deploy.sh
./lambda-deploy.sh
```

#### カスタム設定でデプロイ

```bash
# 別のリージョンを使用
BEDROCK_REGION=us-west-2 ./lambda-deploy.sh

# 別のモデルを使用
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 ./lambda-deploy.sh

# 両方を指定
BEDROCK_REGION=us-west-2 BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 ./lambda-deploy.sh
```

#### ヘルプの表示

```bash
./lambda-deploy.sh --help
```

### 方法 2: CloudFormation を使用

インフラストラクチャをコードとして管理したい場合に推奨します。

#### ステップ 1: Lambda コードのパッケージング

```bash
cd lambda
npm install --production
zip -r ../lambda-deployment.zip . -x "*.test.js" "*.md"
cd ..
```

#### ステップ 2: S3 にアップロード（オプション）

大きなパッケージの場合は S3 を使用します：

```bash
aws s3 cp lambda-deployment.zip s3://your-bucket-name/lambda/
```

#### ステップ 3: CloudFormation スタックの作成

```bash
cd infrastructure

# ローカルの ZIP ファイルを使用する場合
aws cloudformation create-stack \
  --stack-name zendesk-ticket-history-lambda \
  --template-body file://lambda-cloudformation.yaml \
  --parameters \
    ParameterKey=BedrockRegion,ParameterValue=us-east-1 \
    ParameterKey=BedrockModelId,ParameterValue=anthropic.claude-3-haiku-20240307-v1:0 \
  --capabilities CAPABILITY_NAMED_IAM

# スタックの作成完了を待つ
aws cloudformation wait stack-create-complete \
  --stack-name zendesk-ticket-history-lambda
```

#### ステップ 4: Lambda コードの更新

CloudFormation テンプレートにはプレースホルダーコードが含まれているため、実際のコードをデプロイする必要があります：

```bash
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name zendesk-ticket-history-lambda \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' \
  --output text)

aws lambda update-function-code \
  --function-name $FUNCTION_NAME \
  --zip-file fileb://lambda-deployment.zip
```

### 方法 3: AWS CLI を直接使用

手動で細かく制御したい場合に使用します。

#### ステップ 1: IAM ロールの作成

```bash
# 信頼ポリシーの作成
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# ロールの作成
aws iam create-role \
  --role-name zendesk-ticket-history-summarizer-role \
  --assume-role-policy-document file://trust-policy.json

# 基本的な実行ポリシーをアタッチ
aws iam attach-role-policy \
  --role-name zendesk-ticket-history-summarizer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

#### ステップ 2: Bedrock アクセスポリシーの作成

```bash
cat > bedrock-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
      ]
    }
  ]
}
EOF

# ポリシーの作成
aws iam create-policy \
  --policy-name zendesk-ticket-history-bedrock-policy \
  --policy-document file://bedrock-policy.json

# ポリシーをロールにアタッチ
aws iam attach-role-policy \
  --role-name zendesk-ticket-history-summarizer-role \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/zendesk-ticket-history-bedrock-policy
```

#### ステップ 3: Lambda 関数の作成

```bash
# コードのパッケージング
cd lambda
npm install --production
zip -r ../lambda-deployment.zip .
cd ..

# ロール ARN の取得
ROLE_ARN=$(aws iam get-role \
  --role-name zendesk-ticket-history-summarizer-role \
  --query 'Role.Arn' \
  --output text)

# Lambda 関数の作成
aws lambda create-function \
  --function-name zendesk-ticket-history-summarizer \
  --runtime nodejs18.x \
  --role $ROLE_ARN \
  --handler index.handler \
  --zip-file fileb://lambda-deployment.zip \
  --timeout 30 \
  --memory-size 512 \
  --environment "Variables={BEDROCK_REGION=us-east-1,BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0}"
```

## IAM ロールと権限

Lambda 関数には以下の権限が必要です：

### 1. 基本的な Lambda 実行権限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

これは AWS マネージドポリシー `AWSLambdaBasicExecutionRole` に含まれています。

### 2. Bedrock API アクセス権限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
      ]
    }
  ]
}
```

## 環境変数の更新

デプロイ後に環境変数を更新する場合：

```bash
aws lambda update-function-configuration \
  --function-name zendesk-ticket-history-summarizer \
  --environment "Variables={BEDROCK_REGION=us-west-2,BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0}"
```

## 動作確認

### テストイベントの実行

```bash
aws lambda invoke \
  --function-name zendesk-ticket-history-summarizer \
  --payload '{"body":"{\"tickets\":[{\"subject\":\"テスト問い合わせ\",\"created_at\":\"2024-01-01T00:00:00Z\",\"status\":\"solved\",\"description\":\"これはテストです\"}]}"}' \
  response.json

# レスポンスの確認
cat response.json
```

### ログの確認

```bash
aws logs tail /aws/lambda/zendesk-ticket-history-summarizer --follow
```

## トラブルシューティング

### エラー: "User is not authorized to perform: bedrock:InvokeModel"

**原因**: IAM ロールに Bedrock アクセス権限がない

**解決方法**:
```bash
# Bedrock ポリシーをロールにアタッチ
aws iam attach-role-policy \
  --role-name zendesk-ticket-history-summarizer-role \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/zendesk-ticket-history-bedrock-policy
```

### エラー: "Task timed out after 3.00 seconds"

**原因**: Lambda のタイムアウト設定が短すぎる

**解決方法**:
```bash
aws lambda update-function-configuration \
  --function-name zendesk-ticket-history-summarizer \
  --timeout 30
```

### エラー: "Cannot find module '@aws-sdk/client-bedrock-runtime'"

**原因**: 依存関係がパッケージに含まれていない

**解決方法**:
```bash
cd lambda
npm install --production
zip -r ../lambda-deployment.zip .
cd ..

aws lambda update-function-code \
  --function-name zendesk-ticket-history-summarizer \
  --zip-file fileb://lambda-deployment.zip
```

### Bedrock モデルが利用できない

**原因**: 指定したリージョンで Bedrock モデルが利用できない

**解決方法**:
1. AWS コンソールで Bedrock が有効になっているか確認
2. モデルアクセスをリクエスト（Bedrock コンソール > Model access）
3. 利用可能なリージョンを確認（us-east-1, us-west-2 など）

## 監視とログ

### CloudWatch メトリクス

Lambda 関数は以下のメトリクスを自動的に記録します：

- **Invocations**: 呼び出し回数
- **Errors**: エラー回数
- **Duration**: 実行時間
- **Throttles**: スロットル回数
- **ConcurrentExecutions**: 同時実行数

### カスタムログ

Lambda 関数は以下の情報をログに記録します：

- アクセスログ（タイムスタンプ、エンドポイント、ステータス、実行時間）
- エラー詳細
- Bedrock API 呼び出し情報

### ログの検索

```bash
# エラーログの検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/zendesk-ticket-history-summarizer \
  --filter-pattern "ERROR"

# アクセスログの検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/zendesk-ticket-history-summarizer \
  --filter-pattern "ACCESS_LOG"
```

## コスト最適化

### 推奨設定

- **メモリ**: 512 MB（バランス型）
- **タイムアウト**: 30 秒
- **モデル**: Claude 3 Haiku（最もコスト効率が良い）

### コスト削減のヒント

1. **適切なメモリサイズを選択**: 512 MB で十分な場合が多い
2. **タイムアウトを適切に設定**: 不要に長く設定しない
3. **Haiku モデルを使用**: Sonnet や Opus より大幅に安価
4. **ログ保持期間を設定**: CloudWatch ログの保持期間を 30 日に設定

## セキュリティのベストプラクティス

1. **最小権限の原則**: 必要最小限の IAM 権限のみを付与
2. **環境変数の暗号化**: 機密情報は AWS Secrets Manager を使用
3. **VPC 内での実行**: 必要に応じて VPC 内で Lambda を実行
4. **API Key 認証**: API Gateway で API Key 認証を有効化
5. **ログの監視**: CloudWatch Logs Insights でログを定期的に監視

## 次のステップ

Lambda 関数のデプロイが完了したら：

1. **API Gateway のデプロイ**: `./deploy.sh` を実行
2. **統合テスト**: API Gateway 経由で Lambda を呼び出してテスト
3. **Zendesk App の設定**: API エンドポイントと API Key を設定
4. **監視の設定**: CloudWatch アラームを設定

## 参考リンク

- [AWS Lambda ドキュメント](https://docs.aws.amazon.com/lambda/)
- [Amazon Bedrock ドキュメント](https://docs.aws.amazon.com/bedrock/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Claude 3 モデルドキュメント](https://docs.anthropic.com/claude/docs)
