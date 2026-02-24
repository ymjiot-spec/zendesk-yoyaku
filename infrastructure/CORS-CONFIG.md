# CORS 設定ガイド

## 現在の設定

CloudFormation テンプレートには、以下の CORS 設定が含まれています：

- **Access-Control-Allow-Origin**: `*` (すべてのオリジンを許可)
- **Access-Control-Allow-Headers**: `Content-Type,X-Api-Key`
- **Access-Control-Allow-Methods**: `POST,OPTIONS`

## Zendesk ドメインへの制限（推奨）

本番環境では、セキュリティ強化のため、Zendesk の特定のドメインのみを許可することを推奨します。

### 1. Zendesk ドメインの確認

Zendesk アプリは以下のドメインから実行されます：

- `https://{subdomain}.zendesk.com`
- `https://{subdomain}.zdassets.com`

例: `https://yourcompany.zendesk.com`

### 2. CloudFormation テンプレートの更新

`api-gateway.yaml` の CORS ヘッダーを更新します：

#### 変更前:
```yaml
ResponseParameters:
  method.response.header.Access-Control-Allow-Origin: "'*'"
```

#### 変更後:
```yaml
ResponseParameters:
  method.response.header.Access-Control-Allow-Origin: "'https://yourcompany.zendesk.com'"
```

### 3. 複数のドメインを許可する場合

API Gateway は単一のオリジンのみをサポートしているため、複数のドメインを許可する場合は Lambda 関数で動的に処理する必要があります。

#### Lambda 関数での実装例:

```javascript
export async function handler(event) {
  // 許可するオリジンのリスト
  const allowedOrigins = [
    'https://yourcompany.zendesk.com',
    'https://yourcompany.zdassets.com'
  ];
  
  // リクエストのオリジンを取得
  const origin = event.headers?.origin || event.headers?.Origin;
  
  // オリジンが許可リストに含まれているか確認
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  // レスポンスヘッダーにオリジンを設定
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
  
  // ... 残りの処理
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ summary })
  };
}
```

### 4. 環境変数での管理

より柔軟な設定のため、許可するオリジンを環境変数で管理することを推奨します：

```yaml
# CloudFormation テンプレートに追加
Parameters:
  AllowedOrigins:
    Type: String
    Description: Comma-separated list of allowed origins
    Default: 'https://yourcompany.zendesk.com'

# Lambda 関数の環境変数に設定
Environment:
  Variables:
    ALLOWED_ORIGINS: !Ref AllowedOrigins
```

Lambda 関数での使用:

```javascript
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
```

## テスト方法

### ブラウザでのテスト

1. ブラウザの開発者ツールを開く
2. Network タブを選択
3. API リクエストを実行
4. プリフライトリクエスト (OPTIONS) を確認
5. レスポンスヘッダーに正しい CORS ヘッダーが含まれていることを確認

### curl でのテスト

```bash
# OPTIONS リクエスト (プリフライト)
curl -X OPTIONS https://your-api-endpoint/summarize \
  -H "Origin: https://yourcompany.zendesk.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,X-Api-Key" \
  -v

# POST リクエスト
curl -X POST https://your-api-endpoint/summarize \
  -H "Origin: https://yourcompany.zendesk.com" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{"tickets": []}' \
  -v
```

## トラブルシューティング

### CORS エラーが発生する場合

1. **プリフライトリクエストの確認**
   - OPTIONS メソッドが正しく設定されているか確認
   - 認証が不要になっているか確認 (`ApiKeyRequired: false`)

2. **ヘッダーの確認**
   - `Access-Control-Allow-Origin` が正しく設定されているか
   - `Access-Control-Allow-Headers` に必要なヘッダーが含まれているか
   - `Access-Control-Allow-Methods` に POST と OPTIONS が含まれているか

3. **Lambda 関数の確認**
   - Lambda 関数が正しい CORS ヘッダーを返しているか
   - エラーレスポンスにも CORS ヘッダーが含まれているか

4. **API Gateway の設定確認**
   - Integration Response と Method Response の両方に CORS ヘッダーが設定されているか
   - デプロイメントが最新の設定を反映しているか

## セキュリティのベストプラクティス

1. **本番環境では必ず特定のドメインに制限する**
   - `*` (ワイルドカード) は開発環境のみで使用

2. **HTTPS のみを許可する**
   - HTTP オリジンは許可しない

3. **必要最小限のヘッダーのみを許可する**
   - 不要なヘッダーは `Access-Control-Allow-Headers` に含めない

4. **定期的な監査**
   - CloudWatch Logs で不正なオリジンからのアクセスを監視
   - 異常なトラフィックパターンを検出

## 参考資料

- [AWS API Gateway CORS 設定](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html)
- [MDN Web Docs - CORS](https://developer.mozilla.org/ja/docs/Web/HTTP/CORS)
- [Zendesk Apps Framework - Security](https://developer.zendesk.com/documentation/apps/app-developer-guide/using-the-apps-framework/#security)
