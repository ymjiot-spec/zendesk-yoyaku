#!/bin/bash

# Zendesk Ticket History API Gateway デプロイメントスクリプト

set -e

# 色の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 設定
STACK_NAME="zendesk-ticket-history-api"
LAMBDA_FUNCTION_NAME="zendesk-ticket-history-summarizer"
TEMPLATE_FILE="api-gateway.yaml"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-*}"  # デフォルトは * (すべてのオリジンを許可)

echo -e "${GREEN}=== Zendesk Ticket History API Gateway デプロイメント ===${NC}\n"

# 使用方法の表示
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo "使用方法: $0 [OPTIONS]"
    echo ""
    echo "オプション:"
    echo "  ALLOWED_ORIGIN=<origin>  許可するオリジンを指定 (デフォルト: *)"
    echo ""
    echo "例:"
    echo "  $0                                          # すべてのオリジンを許可"
    echo "  ALLOWED_ORIGIN=https://yourcompany.zendesk.com $0  # 特定のドメインのみ許可"
    echo ""
    exit 0
fi

echo "設定:"
echo "  - Lambda 関数名: $LAMBDA_FUNCTION_NAME"
echo "  - 許可するオリジン: $ALLOWED_ORIGIN"
echo ""

# Lambda 関数の存在確認
echo "Lambda 関数の確認中..."
if ! aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME &> /dev/null; then
    echo -e "${RED}エラー: Lambda 関数 '$LAMBDA_FUNCTION_NAME' が見つかりません${NC}"
    echo "先に Lambda 関数をデプロイしてください"
    exit 1
fi

# Lambda ARN の取得
echo "Lambda 関数の ARN を取得中..."
LAMBDA_ARN=$(aws lambda get-function \
    --function-name $LAMBDA_FUNCTION_NAME \
    --query 'Configuration.FunctionArn' \
    --output text)

echo -e "${GREEN}Lambda ARN: $LAMBDA_ARN${NC}\n"

# スタックの存在確認
if aws cloudformation describe-stacks --stack-name $STACK_NAME &> /dev/null; then
    echo -e "${YELLOW}既存のスタックが見つかりました。更新を実行します...${NC}"
    
    aws cloudformation update-stack \
        --stack-name $STACK_NAME \
        --template-body file://$TEMPLATE_FILE \
        --parameters \
            ParameterKey=LambdaFunctionArn,ParameterValue=$LAMBDA_ARN \
            ParameterKey=LambdaFunctionName,ParameterValue=$LAMBDA_FUNCTION_NAME \
            ParameterKey=AllowedOrigin,ParameterValue=$ALLOWED_ORIGIN \
        --capabilities CAPABILITY_IAM
    
    echo "スタックの更新完了を待機中..."
    aws cloudformation wait stack-update-complete --stack-name $STACK_NAME
    echo -e "${GREEN}スタックの更新が完了しました${NC}\n"
else
    echo "新しいスタックを作成中..."
    
    aws cloudformation create-stack \
        --stack-name $STACK_NAME \
        --template-body file://$TEMPLATE_FILE \
        --parameters \
            ParameterKey=LambdaFunctionArn,ParameterValue=$LAMBDA_ARN \
            ParameterKey=LambdaFunctionName,ParameterValue=$LAMBDA_FUNCTION_NAME \
            ParameterKey=AllowedOrigin,ParameterValue=$ALLOWED_ORIGIN \
        --capabilities CAPABILITY_IAM
    
    echo "スタックの作成完了を待機中..."
    aws cloudformation wait stack-create-complete --stack-name $STACK_NAME
    echo -e "${GREEN}スタックの作成が完了しました${NC}\n"
fi

# 出力の取得
echo -e "${GREEN}=== デプロイメント情報 ===${NC}\n"

API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text)

API_KEY_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' \
    --output text)

API_KEY_VALUE=$(aws apigateway get-api-key \
    --api-key $API_KEY_ID \
    --include-value \
    --query 'value' \
    --output text)

echo -e "${GREEN}API エンドポイント:${NC}"
echo "$API_ENDPOINT"
echo ""

echo -e "${GREEN}API Key:${NC}"
echo "$API_KEY_VALUE"
echo ""

# 設定ファイルの作成
CONFIG_FILE="../zendesk-app/api-config.json"
echo "設定ファイルを作成中: $CONFIG_FILE"

cat > $CONFIG_FILE << EOF
{
  "apiEndpoint": "$API_ENDPOINT",
  "apiKey": "$API_KEY_VALUE"
}
EOF

echo -e "${GREEN}設定ファイルが作成されました${NC}\n"

# テスト用のサンプルリクエスト
echo -e "${YELLOW}=== テスト用サンプルリクエスト ===${NC}\n"
echo "curl -X POST $API_ENDPOINT \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'X-Api-Key: $API_KEY_VALUE' \\"
echo "  -d '{\"tickets\": [{\"subject\": \"テスト\", \"created_at\": \"2024-01-01T00:00:00Z\", \"status\": \"solved\"}]}'"
echo ""

echo -e "${GREEN}デプロイメントが完了しました！${NC}"
