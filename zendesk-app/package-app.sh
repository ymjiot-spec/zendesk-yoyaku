#!/bin/bash

# Zendesk App パッケージングスクリプト

set -e

# 色の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Zendesk Ticket History App パッケージング ===${NC}\n"

# manifest.json のバージョン確認
echo "manifest.json のバージョンを確認中..."
VERSION=$(grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)
echo -e "${GREEN}現在のバージョン: $VERSION${NC}\n"

# 必須ファイルの存在確認
echo "必須ファイルの確認中..."
REQUIRED_FILES=(
    "manifest.json"
    "assets/index.html"
    "assets/main.js"
    "assets/styles.css"
    "translations/ja.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}エラー: 必須ファイル '$file' が見つかりません${NC}"
        exit 1
    fi
    echo -e "  ✓ $file"
done

echo -e "${GREEN}すべての必須ファイルが存在します${NC}\n"

# zcli のインストール確認
if ! command -v zcli &> /dev/null; then
    echo -e "${YELLOW}警告: zcli がインストールされていません${NC}"
    echo "zcli をインストールするには以下のコマンドを実行してください:"
    echo "  npm install -g @zendesk/zcli"
    echo ""
    echo "手動でパッケージを作成する場合は、以下のファイルを ZIP 形式で圧縮してください:"
    echo "  - manifest.json"
    echo "  - assets/"
    echo "  - translations/"
    echo ""
    
    # 手動パッケージング
    PACKAGE_NAME="ticket-history-app-v${VERSION}.zip"
    echo "手動パッケージングを実行中..."
    
    if command -v zip &> /dev/null; then
        zip -r "$PACKAGE_NAME" manifest.json assets/ translations/ -x "*.DS_Store" "*.git*"
        echo -e "${GREEN}パッケージが作成されました: $PACKAGE_NAME${NC}"
    else
        echo -e "${RED}エラー: zip コマンドが見つかりません${NC}"
        exit 1
    fi
else
    # zcli を使用したパッケージング
    echo "zcli を使用してパッケージを作成中..."
    zcli apps:validate
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}アプリの検証に成功しました${NC}\n"
        
        echo "パッケージを作成中..."
        zcli apps:package
        
        echo -e "${GREEN}パッケージが作成されました${NC}"
    else
        echo -e "${RED}アプリの検証に失敗しました${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}=== パッケージング完了 ===${NC}"
echo ""
echo "次のステップ:"
echo "1. Zendesk Admin Center にログイン"
echo "2. Apps and integrations > Apps > Zendesk Support apps に移動"
echo "3. 'Upload private app' をクリック"
echo "4. 作成されたパッケージファイルをアップロード"
echo "5. API エンドポイントと API Key を設定"
echo ""
