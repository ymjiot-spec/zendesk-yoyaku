# タスク 14.2 実装サマリー: Lambda関数のデプロイ設定

## 実装内容

このタスクでは、Lambda 関数のデプロイに必要な環境変数設定と IAM ロール設定を実装しました。

## 作成されたファイル

### 1. デプロイメントスクリプト

#### `lambda-deploy.sh` (推奨)
- **目的**: Lambda 関数の自動デプロイ
- **機能**:
  - 依存関係の自動インストール
  - デプロイメントパッケージの作成
  - IAM ロールの自動作成（Bedrock アクセス権限付き）
  - Lambda 関数の作成/更新
  - 環境変数の設定（BEDROCK_REGION, BEDROCK_MODEL_ID）
  - CloudWatch ログの設定

**使用方法**:
```bash
cd infrastructure
./lambda-deploy.sh

# カスタム設定
BEDROCK_REGION=us-west-2 ./lambda-deploy.sh
```

### 2. CloudFormation テンプレート

#### `lambda-cloudformation.yaml`
- **目的**: Infrastructure as Code によるデプロイ
- **リソース**:
  - Lambda 関数
  - IAM 実行ロール（Bedrock アクセス権限付き）
  - CloudWatch ログ グループ
  - CloudWatch アラーム（エラー、スロットル、実行時間）

**使用方法**:
```bash
aws cloudformation create-stack \
  --stack-name zendesk-ticket-history-lambda \
  --template-body file://lambda-cloudformation.yaml \
  --parameters \
    ParameterKey=BedrockRegion,ParameterValue=us-east-1 \
    ParameterKey=BedrockModelId,ParameterValue=anthropic.claude-3-haiku-20240307-v1:0 \
  --capabilities CAPABILITY_NAMED_IAM
```

### 3. ドキュメント

#### `LAMBDA-DEPLOYMENT.md`
包括的なデプロイメントガイド：
- 3つのデプロイ方法（シェルスクリプト、CloudFormation、AWS CLI）
- 環境変数の詳細説明
- IAM ロールと権限の説明
- トラブルシューティングガイド
- 監視とログの設定
- コスト最適化のヒント
- セキュリティのベストプラクティス

#### `QUICKSTART-LAMBDA.md`
1分でデプロイできるクイックスタートガイド

#### `DEPLOYMENT-CHECKLIST.md`
完全なデプロイメントチェックリスト（Lambda + API Gateway + Zendesk App）

#### `lambda-config.env.example`
環境変数の設定例

## 環境変数の設定

### BEDROCK_REGION
- **説明**: Bedrock API のリージョン
- **デフォルト値**: `us-east-1`
- **利用可能な値**: `us-east-1`, `us-west-2`, `ap-northeast-1`, `eu-central-1`

### BEDROCK_MODEL_ID
- **説明**: 使用する Bedrock モデル ID
- **デフォルト値**: `anthropic.claude-3-haiku-20240307-v1:0`
- **利用可能な値**:
  - `anthropic.claude-3-haiku-20240307-v1:0` (高速・低コスト、推奨)
  - `anthropic.claude-3-sonnet-20240229-v1:0` (バランス型)
  - `anthropic.claude-3-opus-20240229-v1:0` (最高品質)

## IAM ロールと権限

### 作成される IAM ロール
- **ロール名**: `zendesk-ticket-history-summarizer-role`
- **信頼ポリシー**: Lambda サービスからの AssumeRole を許可

### アタッチされるポリシー

#### 1. AWSLambdaBasicExecutionRole (AWS マネージドポリシー)
CloudWatch Logs への書き込み権限：
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

#### 2. Bedrock アクセスポリシー (カスタムポリシー)
Bedrock API へのアクセス権限：
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

## Lambda 関数の設定

### 基本設定
- **関数名**: `zendesk-ticket-history-summarizer`
- **ランタイム**: Node.js 18.x
- **ハンドラー**: `index.handler`
- **タイムアウト**: 30秒
- **メモリ**: 512 MB

### 環境変数
- `BEDROCK_REGION`: Bedrock API のリージョン
- `BEDROCK_MODEL_ID`: 使用するモデル ID

### CloudWatch 設定
- **ログ グループ**: `/aws/lambda/zendesk-ticket-history-summarizer`
- **ログ保持期間**: 30日

## 監視とアラート

CloudFormation テンプレートには以下のアラームが含まれています：

### 1. エラーアラーム
- **メトリクス**: Lambda Errors
- **閾値**: 5分間で5回以上のエラー
- **アクション**: アラーム状態に移行

### 2. スロットルアラーム
- **メトリクス**: Lambda Throttles
- **閾値**: 5分間で1回以上のスロットル
- **アクション**: アラーム状態に移行

### 3. 実行時間アラーム
- **メトリクス**: Lambda Duration
- **閾値**: 平均実行時間が25秒以上
- **アクション**: アラーム状態に移行

## デプロイ方法の比較

| 方法 | 難易度 | 推奨度 | 特徴 |
|------|--------|--------|------|
| **シェルスクリプト** | ⭐ 簡単 | ⭐⭐⭐ 推奨 | 最も簡単、自動化、初心者向け |
| **CloudFormation** | ⭐⭐ 中級 | ⭐⭐ 推奨 | IaC、バージョン管理、本番環境向け |
| **AWS CLI** | ⭐⭐⭐ 上級 | ⭐ 非推奨 | 手動、細かい制御、学習目的 |

## 要件との対応

### 要件 10.2: 環境変数の設定
✅ **実装済み**
- `BEDROCK_REGION` 環境変数の設定
- `BEDROCK_MODEL_ID` 環境変数の設定
- デフォルト値の提供
- カスタマイズ可能な設定

### 要件 10.3: IAM ロールと権限の設定
✅ **実装済み**
- Lambda 実行ロールの作成
- CloudWatch Logs への書き込み権限
- Bedrock API へのアクセス権限
- 最小権限の原則に従った設定

## 使用例

### 基本的なデプロイ

```bash
cd infrastructure
./lambda-deploy.sh
```

### カスタム設定でのデプロイ

```bash
# 別のリージョンとモデルを使用
BEDROCK_REGION=us-west-2 \
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 \
./lambda-deploy.sh
```

### 環境変数の更新

```bash
aws lambda update-function-configuration \
  --function-name zendesk-ticket-history-summarizer \
  --environment "Variables={BEDROCK_REGION=us-west-2,BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0}"
```

### 動作確認

```bash
aws lambda invoke \
  --function-name zendesk-ticket-history-summarizer \
  --payload '{"body":"{\"tickets\":[{\"subject\":\"テスト\",\"created_at\":\"2024-01-01T00:00:00Z\",\"status\":\"solved\"}]}"}' \
  response.json

cat response.json
```

## セキュリティ考慮事項

1. **最小権限の原則**: IAM ロールは必要最小限の権限のみを付与
2. **リソース制限**: Bedrock アクセスは Claude モデルのみに制限
3. **ログの有効化**: すべての実行がログに記録される
4. **環境変数の暗号化**: 機密情報は AWS Secrets Manager の使用を推奨

## コスト最適化

1. **メモリサイズ**: 512 MB（バランス型）
2. **タイムアウト**: 30秒（適切な設定）
3. **モデル選択**: Haiku（最もコスト効率が良い）
4. **ログ保持**: 30日（適切な期間）

## 次のステップ

1. Lambda 関数のデプロイ: `./lambda-deploy.sh`
2. API Gateway のデプロイ: `./deploy.sh`
3. Zendesk App の設定
4. 統合テスト

## 参考ドキュメント

- [LAMBDA-DEPLOYMENT.md](LAMBDA-DEPLOYMENT.md) - 詳細なデプロイメントガイド
- [QUICKSTART-LAMBDA.md](QUICKSTART-LAMBDA.md) - クイックスタートガイド
- [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) - デプロイメントチェックリスト
- [README.md](README.md) - API Gateway デプロイメントガイド

## 実装完了

✅ タスク 14.2 「Lambda関数のデプロイ設定」は完了しました。

すべての要件が満たされ、包括的なデプロイメントソリューションが提供されています。
