# Zendesk アプリとの統合ガイド

このドキュメントでは、デプロイした API Gateway を Zendesk アプリから呼び出す方法を説明します。

## 前提条件

- API Gateway がデプロイ済み
- `api-config.json` が生成済み

## 設定ファイルの確認

デプロイスクリプトは自動的に `../zendesk-app/api-config.json` を生成します：

```json
{
  "apiEndpoint": "https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/summarize",
  "apiKey": "your-api-key-here"
}
```

## Zendesk アプリでの実装

### 1. 設定ファイルの読み込み

```javascript
// api-config.json を読み込む
import config from './api-config.json';

const API_ENDPOINT = config.apiEndpoint;
const API_KEY = config.apiKey;
```

### 2. API 呼び出し関数の実装

```javascript
/**
 * チケット履歴から AI 要約を生成
 * @param {Array} tickets - チケット情報の配列
 * @returns {Promise<string>} - 生成された要約テキスト
 */
async function generateSummary(tickets) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY
      },
      body: JSON.stringify({ tickets })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'API リクエストが失敗しました');
    }

    const data = await response.json();
    return data.summary;
  } catch (error) {
    console.error('要約生成エラー:', error);
    throw error;
  }
}
```

### 3. エラーハンドリング付きの実装

```javascript
/**
 * エラーハンドリング付きの要約生成関数
 */
async function generateSummaryWithErrorHandling(tickets) {
  // ローディング表示
  showLoading(true);
  
  try {
    // チケットが空の場合
    if (!tickets || tickets.length === 0) {
      throw new Error('過去のチケットがありません');
    }

    // API 呼び出し
    const summary = await generateSummary(tickets);
    
    // 要約を表示
    displaySummary(summary);
    
  } catch (error) {
    // エラーメッセージの表示
    if (error.message.includes('ネットワーク')) {
      showError('ネットワーク接続を確認してください');
    } else if (error.message.includes('タイムアウト')) {
      showError('リクエストがタイムアウトしました。もう一度お試しください');
    } else {
      showError('要約の生成に失敗しました: ' + error.message);
    }
    
    // エラーログの記録
    console.error('要約生成エラー:', error);
    
  } finally {
    // ローディング非表示
    showLoading(false);
  }
}
```

### 4. タイムアウト処理の実装

```javascript
/**
 * タイムアウト付きの fetch
 */
async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('リクエストがタイムアウトしました');
    }
    throw error;
  }
}

/**
 * タイムアウト付きの要約生成
 */
async function generateSummary(tickets) {
  const response = await fetchWithTimeout(
    API_ENDPOINT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY
      },
      body: JSON.stringify({ tickets })
    },
    30000 // 30秒のタイムアウト
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'API リクエストが失敗しました');
  }

  const data = await response.json();
  return data.summary;
}
```

### 5. UI の実装例

```javascript
// ボタンのクリックイベント
document.getElementById('summarize-button').addEventListener('click', async () => {
  const tickets = getTicketHistory(); // チケット履歴を取得
  await generateSummaryWithErrorHandling(tickets);
});

// ローディング表示
function showLoading(show) {
  const button = document.getElementById('summarize-button');
  const spinner = document.getElementById('loading-spinner');
  
  if (show) {
    button.disabled = true;
    button.textContent = '生成中...';
    spinner.style.display = 'block';
  } else {
    button.disabled = false;
    button.textContent = '要約する';
    spinner.style.display = 'none';
  }
}

// 要約の表示
function displaySummary(summary) {
  const summaryArea = document.getElementById('summary-area');
  summaryArea.textContent = summary;
  summaryArea.style.display = 'block';
  
  // ボタンテキストを変更
  const button = document.getElementById('summarize-button');
  button.textContent = '再要約する';
}

// エラー表示
function showError(message) {
  const errorArea = document.getElementById('error-area');
  errorArea.textContent = message;
  errorArea.style.display = 'block';
  errorArea.style.color = 'red';
  
  // 5秒後に非表示
  setTimeout(() => {
    errorArea.style.display = 'none';
  }, 5000);
}
```

## リクエスト形式

### リクエスト

```http
POST /prod/summarize HTTP/1.1
Host: xxxxx.execute-api.us-east-1.amazonaws.com
Content-Type: application/json
X-Api-Key: your-api-key-here

{
  "tickets": [
    {
      "subject": "商品の返品について",
      "created_at": "2024-01-15T10:30:00Z",
      "status": "solved",
      "description": "商品が破損していたため返品したい"
    },
    {
      "subject": "配送状況の確認",
      "created_at": "2024-01-10T14:20:00Z",
      "status": "closed",
      "description": "注文した商品の配送状況を知りたい"
    }
  ]
}
```

### レスポンス（成功）

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type,X-Api-Key
Access-Control-Allow-Methods: POST,OPTIONS

{
  "summary": "## 過去の問い合わせ履歴の要約\n\nこの顧客は過去2回の問い合わせがあります...\n\n## 注意点\n\n- 商品の品質に敏感な顧客です\n...\n\n## 対応のヒント\n\n- 丁寧な対応を心がけてください\n..."
}
```

### レスポンス（エラー）

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Invalid tickets data",
  "message": "チケット情報が不正です"
}
```

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "Internal server error",
  "message": "要約の生成中にエラーが発生しました",
  "details": "Bedrock API error: ..."
}
```

## テスト方法

### 1. ブラウザの開発者ツールでテスト

```javascript
// ブラウザのコンソールで実行
const testTickets = [
  {
    subject: 'テストチケット',
    created_at: '2024-01-01T00:00:00Z',
    status: 'solved',
    description: 'これはテストです'
  }
];

fetch('https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/summarize', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'your-api-key-here'
  },
  body: JSON.stringify({ tickets: testTickets })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error(error));
```

### 2. curl でテスト

```bash
curl -X POST https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/summarize \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key-here" \
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

## セキュリティのベストプラクティス

### 1. API Key の保護

```javascript
// ❌ 悪い例: API Key をハードコード
const API_KEY = 'abcd1234...';

// ✅ 良い例: 設定ファイルから読み込み（Git に含めない）
import config from './api-config.json';
const API_KEY = config.apiKey;
```

`.gitignore` に追加:
```
api-config.json
```

### 2. エラーメッセージの適切な処理

```javascript
// ❌ 悪い例: 詳細なエラーをユーザーに表示
showError(error.stack);

// ✅ 良い例: ユーザーフレンドリーなメッセージ
showError('要約の生成に失敗しました。しばらくしてからもう一度お試しください');
console.error('詳細なエラー:', error); // コンソールにのみ記録
```

### 3. レート制限の考慮

```javascript
// 連続クリックを防止
let isGenerating = false;

async function generateSummaryWithRateLimit(tickets) {
  if (isGenerating) {
    showError('要約を生成中です。しばらくお待ちください');
    return;
  }
  
  isGenerating = true;
  try {
    await generateSummary(tickets);
  } finally {
    isGenerating = false;
  }
}
```

## トラブルシューティング

### CORS エラー

```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**解決方法:**
1. API Gateway の CORS 設定を確認
2. `AllowedOrigin` パラメータに正しい Zendesk ドメインが設定されているか確認
3. OPTIONS メソッドが正しく設定されているか確認

### 401 Unauthorized

```
{"message":"Unauthorized"}
```

**解決方法:**
1. `X-Api-Key` ヘッダーが含まれているか確認
2. API Key の値が正しいか確認
3. API Key が有効化されているか確認

### 403 Forbidden

```
{"message":"Forbidden"}
```

**解決方法:**
1. 使用量プランの制限を超えていないか確認
2. API Key が使用量プランに関連付けられているか確認

### タイムアウト

**解決方法:**
1. タイムアウト時間を延長（30秒以上）
2. チケット数を制限（大量のチケットを送信しない）
3. Lambda 関数のタイムアウト設定を確認

## 参考資料

- [Zendesk Apps Framework - Making API Requests](https://developer.zendesk.com/documentation/apps/app-developer-guide/using-the-apps-framework/#making-api-requests)
- [Fetch API - MDN](https://developer.mozilla.org/ja/docs/Web/API/Fetch_API)
- [AWS API Gateway - Error Responses](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-method-request-validation.html)
