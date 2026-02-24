#!/bin/bash

# Zendesk Ticket History Lambda Function デプロイメントスクリプト

set -e

# 色の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 設定
FUNCTION_NAME="zendesk-ticket-history-summarizer"
LAMBDA_DIR="../lambda"
BEDROCK_REGION="${BEDROCK_REGION:-us-east-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-anthropic.claude-3-haiku-20240307-v1:0}"
RUNTIME="nodejs18.x"
HANDLER="index.handler"
TIMEOUT=30
MEMORY_SIZE=512

echo -e "${GREEN}=== Zendesk Ticket History Lambda Function デプロイメント ===${NC}\n"

# 使用方法の表示
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo "使用方法: $0 [OPTIONS]"
    echo ""
    echo "環境変数:"
    echo "  BEDROCK_REGION      Bedrock APIのリージョン (デフォルト: us-east-1)"
    echo "  BEDROCK_MODEL_ID    使用するBedrockモデルID (デフォルト: anthropic.claude-3-haiku-20240307-v1:0)"
    echo ""
    echo "例:"
    echo "  $0                                          # デフォルト設定でデプロイ"
    echo "  BEDROCK_REGION=us-west-2 $0                # 別リージョンを指定"
    echo "  BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0 $0  # 別モデルを指定"
    echo ""
    exit 0
fi

echo "設定:"
echo "  - 関数名: $FUNCTION_NAME"
echo "  - Bedrock リージョン: $BEDROCK_REGION"
echo "  - Bedrock モデル ID: $BEDROCK_MODEL_ID"
echo "  - ランタイム: $RUNTIME"
echo "  - タイムアウト: ${TIMEOUT}秒"
echo "  - メモリ: ${MEMORY_SIZE}MB"
echo ""

# Lambda ディレクトリの確認
if [ ! -d "$LAMBDA_DIR" ]; then
    echo -e "${RED}エラー: Lambda ディレクトリが見つかりません: $LAMBDA_DIR${NC}"
    exit 1
fi

# 依存関係のインストール
echo "依存関係をインストール中..."
cd $LAMBDA_DIR
npm install --production
cd - > /dev/null

# デプロイメントパッケージの作成
echo "デプロイメントパッケージを作成中..."
TEMP_DIR=$(mktemp -d)
cp -r $LAMBDA_DIR/* $TEMP_DIR/
cd $TEMP_DIR

# package.json から devDependencies を除外
if [ -f "package.json" ]; then
    # 本番用の依存関係のみをインストール
    rm -rf node_modules
    npm install --production --no-optional
fi

# ZIP ファイルの作成
ZIP_FILE="lambda-deployment.zip"
zip -r $ZIP_FILE . -x "*.test.js" "*.md" ".git/*" > /dev/null
cd - > /dev/null

echo -e "${GREEN}デプロイメントパッケージを作成しました: $TEMP_DIR/$ZIP_FILE${NC}\n"

# IAM ロールの確認または作成
ROLE_NAME="${FUNCTION_NAME}-role"
echo "IAM ロールを確認中..."

if ! aws iam get-role --role-name $ROLE_NAME &> /dev/null; then
    echo "IAM ロールを作成中..."
    
    # 信頼ポリシーの作成
    TRUST_POLICY=$(cat <<EOF
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
)
    
    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document "$TRUST_POLICY" \
        --description "IAM role for Zendesk Ticket History Lambda function" \
        > /dev/null
    
    echo -e "${GREEN}IAM ロールを作成しました: $ROLE_NAME${NC}"
    
    # 基本的な Lambda 実行ポリシーをアタッチ
    echo "Lambda 実行ポリシーをアタッチ中..."
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    
    # Bedrock アクセスポリシーの作成とアタッチ
    echo "Bedrock アクセスポリシーを作成中..."
    POLICY_NAME="${FUNCTION_NAME}-bedrock-policy"
    
    BEDROCK_POLICY=$(cat <<EOF
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
)
    
    POLICY_ARN=$(aws iam create-policy \
        --policy-name $POLICY_NAME \
        --policy-document "$BEDROCK_POLICY" \
        --description "Policy for Bedrock API access" \
        --query 'Policy.Arn' \
        --output text 2>/dev/null || \
        aws iam list-policies \
        --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" \
        --output text)
    
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn $POLICY_ARN
    
    echo -e "${GREEN}Bedrock アクセスポリシーをアタッチしました${NC}"
    
    # ロールの伝播を待つ
    echo "IAM ロールの伝播を待機中（10秒）..."
    sleep 10
else
    echo -e "${GREEN}既存の IAM ロールを使用します: $ROLE_NAME${NC}"
fi

# ロール ARN の取得
ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
echo "ロール ARN: $ROLE_ARN"
echo ""

# Lambda 関数の確認
if aws lambda get-function --function-name $FUNCTION_NAME &> /dev/null; then
    echo -e "${YELLOW}既存の Lambda 関数が見つかりました。更新を実行します...${NC}"
    
    # 関数コードの更新
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://$TEMP_DIR/$ZIP_FILE \
        > /dev/null
    
    echo "関数コードを更新しました"
    
    # 環境変数の更新
    echo "環境変数を更新中..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --environment "Variables={BEDROCK_REGION=$BEDROCK_REGION,BEDROCK_MODEL_ID=$BEDROCK_MODEL_ID}" \
        --timeout $TIMEOUT \
        --memory-size $MEMORY_SIZE \
        > /dev/null
    
    echo -e "${GREEN}Lambda 関数を更新しました${NC}\n"
else
    echo "新しい Lambda 関数を作成中..."
    
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --role $ROLE_ARN \
        --handler $HANDLER \
        --zip-file fileb://$TEMP_DIR/$ZIP_FILE \
        --timeout $TIMEOUT \
        --memory-size $MEMORY_SIZE \
        --environment "Variables={BEDROCK_REGION=$BEDROCK_REGION,BEDROCK_MODEL_ID=$BEDROCK_MODEL_ID}" \
        --description "Lambda function for summarizing Zendesk ticket history using Amazon Bedrock" \
        > /dev/null
    
    echo -e "${GREEN}Lambda 関数を作成しました${NC}\n"
fi

# クリーンアップ
rm -rf $TEMP_DIR

# 関数情報の表示
echo -e "${GREEN}=== デプロイメント情報 ===${NC}\n"

FUNCTION_ARN=$(aws lambda get-function \
    --function-name $FUNCTION_NAME \
    --query 'Configuration.FunctionArn' \
    --output text)

echo -e "${GREEN}関数名:${NC} $FUNCTION_NAME"
echo -e "${GREEN}関数 ARN:${NC} $FUNCTION_ARN"
echo -e "${GREEN}ランタイム:${NC} $RUNTIME"
echo -e "${GREEN}ハンドラー:${NC} $HANDLER"
echo -e "${GREEN}タイムアウト:${NC} ${TIMEOUT}秒"
echo -e "${GREEN}メモリ:${NC} ${MEMORY_SIZE}MB"
echo ""
echo -e "${GREEN}環境変数:${NC}"
echo "  BEDROCK_REGION: $BEDROCK_REGION"
echo "  BEDROCK_MODEL_ID: $BEDROCK_MODEL_ID"
echo ""

# テスト用のサンプルペイロード
echo -e "${YELLOW}=== テスト用サンプルペイロード ===${NC}\n"
echo "aws lambda invoke \\"
echo "  --function-name $FUNCTION_NAME \\"
echo "  --payload '{\"body\":\"{\\\"tickets\\\":[{\\\"subject\\\":\\\"テスト\\\",\\\"created_at\\\":\\\"2024-01-01T00:00:00Z\\\",\\\"status\\\":\\\"solved\\\"}]}\"}' \\"
echo "  response.json"
echo ""

echo -e "${GREEN}デプロイメントが完了しました！${NC}"
echo ""
echo -e "${YELLOW}次のステップ:${NC}"
echo "1. API Gateway をデプロイ: ./deploy.sh"
echo "2. Zendesk App に API エンドポイントと API Key を設定"
echo ""
