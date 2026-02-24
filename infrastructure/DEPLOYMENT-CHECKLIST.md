# デプロイメント チェックリスト

このチェックリストは、Zendesk Ticket History App を AWS にデプロイする際の手順を示します。

## 事前準備

- [ ] AWS CLI がインストールされている
- [ ] AWS CLI が設定されている（`aws configure`）
- [ ] Node.js 18.x 以上がインストールされている
- [ ] 適切な AWS 権限がある（Lambda、IAM、API Gateway、CloudWatch）
- [ ] Amazon Bedrock へのアクセス権限がある
- [ ] Bedrock でモデルアクセスが有効になっている

## ステップ 1: Lambda 関数のデプロイ

### 環境変数の設定（オプション）

デフォルト設定を使用する場合はスキップできます。

- [ ] `lambda-config.env.example` を `lambda-config.env` にコピー
- [ ] `BEDROCK_REGION` を設定（デフォルト: us-east-1）
- [ ] `BEDROCK_MODEL_ID` を設定（デフォルト: claude-3-haiku）

### デプロイの実行

```bash
cd infrastructure

# デフォルト設定でデプロイ
./lambda-deploy.sh

# または、カスタム設定でデプロイ
BEDROCK_REGION=us-west-2 ./lambda-deploy.sh
```

### 確認事項

- [ ] Lambda 関数が正常に作成された
- [ ] IAM ロールが作成された
- [ ] 環境変数が正しく設定された
- [ ] 関数 ARN が表示された

### テスト

```bash
aws lambda invoke \
  --function-name zendesk-ticket-history-summarizer \
  --payload '{"body":"{\"tickets\":[{\"subject\":\"テスト\",\"created_at\":\"2024-01-01T00:00:00Z\",\"status\":\"solved\"}]}"}' \
  response.json

cat response.json
```

- [ ] Lambda 関数が正常に実行された
- [ ] レスポンスに要約が含まれている

## ステップ 2: API Gateway のデプロイ

### デプロイの実行

```bash
# デフォルト設定（すべてのオリジンを許可）
./deploy.sh

# または、特定のドメインのみ許可
ALLOWED_ORIGIN=https://yourcompany.zendesk.com ./deploy.sh
```

### 確認事項

- [ ] API Gateway が正常に作成された
- [ ] API エンドポイントが表示された
- [ ] API Key が表示された
- [ ] `../zendesk-app/api-config.json` が作成された

### テスト

```bash
# API_ENDPOINT と API_KEY を deploy.sh の出力から取得
curl -X POST <API_ENDPOINT> \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <API_KEY>' \
  -d '{"tickets": [{"subject": "テスト", "created_at": "2024-01-01T00:00:00Z", "status": "solved"}]}'
```

- [ ] API が正常にレスポンスを返す
- [ ] CORS ヘッダーが含まれている

## ステップ 3: Zendesk App の設定

### API 設定の確認

- [ ] `zendesk-app/api-config.json` が存在する
- [ ] API エンドポイントが正しい
- [ ] API Key が正しい

### Zendesk App のパッケージング

```bash
cd zendesk-app
npm install
zcli apps:package
```

- [ ] アプリがパッケージ化された
- [ ] `.zip` ファイルが作成された

### Zendesk へのアップロード

1. Zendesk 管理画面にログイン
2. 設定 > アプリとインテグレーション > Zendesk Support アプリ
3. 「アプリをアップロード」をクリック
4. パッケージ化した `.zip` ファイルを選択
5. アプリをインストール

- [ ] アプリが正常にアップロードされた
- [ ] アプリがインストールされた

## ステップ 4: 動作確認

### Zendesk でのテスト

1. Zendesk でチケットを開く
2. サイドバーにアプリが表示されることを確認
3. 過去のチケット履歴が表示されることを確認
4. 「要約する」ボタンをクリック
5. AI 要約が表示されることを確認

- [ ] アプリが正常に表示される
- [ ] 過去のチケットが取得できる
- [ ] AI 要約が生成される
- [ ] エラーが発生しない

### ログの確認

```bash
# Lambda ログ
aws logs tail /aws/lambda/zendesk-ticket-history-summarizer --follow

# API Gateway ログ（有効化されている場合）
aws logs tail /aws/apigateway/zendesk-ticket-history-api --follow
```

- [ ] ログが正常に記録されている
- [ ] エラーログがない

## ステップ 5: 監視の設定

### CloudWatch アラームの確認

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix zendesk-ticket-history
```

- [ ] Lambda エラーアラームが設定されている
- [ ] Lambda スロットルアラームが設定されている
- [ ] Lambda 実行時間アラームが設定されている

### メトリクスの確認

AWS コンソール > CloudWatch > メトリクス

- [ ] Lambda 呼び出し回数が記録されている
- [ ] API Gateway リクエスト数が記録されている
- [ ] エラー率が正常範囲内

## トラブルシューティング

### Lambda 関数が実行できない

**症状**: Lambda 関数の呼び出しでエラーが発生

**確認事項**:
- [ ] IAM ロールが正しく設定されている
- [ ] Bedrock アクセス権限がある
- [ ] 環境変数が正しく設定されている
- [ ] タイムアウト設定が十分（30秒以上）

**解決方法**: [LAMBDA-DEPLOYMENT.md](LAMBDA-DEPLOYMENT.md) のトラブルシューティングセクションを参照

### API Gateway でエラーが発生

**症状**: API 呼び出しで 403 や 500 エラー

**確認事項**:
- [ ] API Key が正しい
- [ ] Lambda 実行権限が設定されている
- [ ] CORS 設定が正しい

**解決方法**: [README.md](README.md) のトラブルシューティングセクションを参照

### Zendesk App でエラーが発生

**症状**: アプリが表示されない、または動作しない

**確認事項**:
- [ ] `api-config.json` が正しい
- [ ] API エンドポイントにアクセスできる
- [ ] ブラウザのコンソールでエラーを確認

**解決方法**: ブラウザの開発者ツールでネットワークタブとコンソールを確認

## セキュリティチェック

- [ ] API Key が安全に保管されている
- [ ] CORS が適切に設定されている（本番環境では特定ドメインのみ）
- [ ] IAM ロールが最小権限の原則に従っている
- [ ] CloudWatch ログが有効になっている
- [ ] ログ保持期間が設定されている（30日推奨）

## コスト最適化

- [ ] Lambda メモリサイズが適切（512 MB 推奨）
- [ ] Lambda タイムアウトが適切（30秒推奨）
- [ ] Claude 3 Haiku モデルを使用（最もコスト効率が良い）
- [ ] API Gateway の使用量プランが適切
- [ ] CloudWatch ログの保持期間が適切

## 本番環境への移行

### 本番環境固有の設定

- [ ] CORS を特定の Zendesk ドメインに制限
- [ ] API Key を定期的にローテーション
- [ ] CloudWatch アラームの通知先を設定
- [ ] バックアップとディザスタリカバリ計画を作成
- [ ] 負荷テストを実施

### ドキュメント

- [ ] デプロイメント手順書を更新
- [ ] 運用手順書を作成
- [ ] トラブルシューティングガイドを作成
- [ ] API ドキュメントを作成

## 完了

すべてのチェック項目が完了したら、デプロイメントは完了です！

## 参考ドキュメント

- [Lambda デプロイメントガイド](LAMBDA-DEPLOYMENT.md)
- [API Gateway デプロイメントガイド](README.md)
- [CORS 設定ガイド](CORS-CONFIG.md)
- [Zendesk 統合ガイド](ZENDESK-INTEGRATION.md)
