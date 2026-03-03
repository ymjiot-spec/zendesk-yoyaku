# GitHub × Zendesk 自動デプロイ ガイド

## 全体の仕組み

```
Kiroでコード修正 → git push → GitHub Actions自動実行 → Zendeskアプリ更新（約16秒）
```

コードを修正してpushするだけで、Zendeskのアプリが自動更新される。

---

## 現在の設定状況

| 環境 | サブドメイン | 状態 |
|------|-------------|------|
| env1 | stardemo | ✅ 設定済み・動作確認OK |
| env2 | （未設定） | ⏳ シークレット追加が必要 |
| env3 | （未設定） | ⏳ シークレット追加が必要 |
| env4 | （未設定） | ⏳ シークレット追加が必要 |

---

## 日常の使い方（コード修正→デプロイ）

### 1. Kiroでコード修正
チャットで「ここ改善して」と言えばコードが修正される。

### 2. pushする
Kiroに「プッシュして」と言うか、ターミナルで：
```bash
git add -A
git commit -m "修正内容のメモ"
git push origin main
```

### 3. 自動デプロイ確認
- GitHub → Actions タブで緑チェック✅を確認
- Zendeskでページリロードすれば反映

**注意**: `zendesk-app/assets/`、`zendesk-app/manifest.json`、`zendesk-app/translations/` のファイルが変更された時だけデプロイが走る。

---

## 新しいZendesk環境を追加する手順（env2〜4）

### ステップ1: Zendeskにアプリを手動インストール
1. 対象のZendesk管理画面を開く
2. アプリとインテグレーション → Zendeskサポートアプリ
3. 「アプリをアップロード」→ ZIPファイルをアップロード
4. インストール完了を確認

### ステップ2: インストールIDを取得
ターミナルで実行（メールアドレスとトークンは対象環境のもの）：
```bash
curl -u "メールアドレス/token:APIトークン" https://サブドメイン.zendesk.com/api/v2/apps/installations.json
```
返ってくるJSONから、自分のアプリ（例: "要約アプリ"）の `"id"` の数字をメモ。

### ステップ3: GitHubにシークレットを追加
GitHub → Settings → Secrets and variables → Actions

**Secrets（環境番号を2,3,4に変えて追加）:**

| シークレット名 | 値の例 | 説明 |
|---------------|--------|------|
| `ZENDESK_SUBDOMAIN_2` | `mycompany` | サブドメインだけ（.zendesk.comは不要） |
| `ZENDESK_EMAIL_2` | `taro@example.com` | Zendeskの管理者メールアドレス |
| `ZENDESK_API_TOKEN_2` | `abcdef123456` | ZendeskのAPIトークン |
| `ZENDESK_APP_INSTALLATION_ID_2` | `38762311181463` | ステップ2で取得した数字 |

**Variables:**

| 変数名 | 値 |
|--------|-----|
| `DEPLOY_ENV2` | `true` |

### ステップ4: 確認
何かファイルを変更してpush → GitHub Actionsで新環境にもデプロイされることを確認。

---

## GitHubシークレットの確認・変更方法

1. https://github.com/ymjiot-spec/zendesk-yoyaku にアクセス
2. Settings → Secrets and variables → Actions
3. シークレットの「Update」ボタンで値を変更
4. 変更時にメール認証（Verify via email）を求められることがある → メールのリンクをクリック

---

## トラブルシューティング

### デプロイが失敗する（exit code 3）
- シークレットの値に余計な空白や改行が入ってないか確認
- `ZENDESK_SUBDOMAIN` に `https://` や `.zendesk.com` が含まれてないか確認
- 全シークレットを削除して入れ直す

### デプロイが実行されない
- `DEPLOY_ENV1=true` のVariableが設定されているか確認
- 変更したファイルが `zendesk-app/` 配下か確認（他のファイルだけの変更ではトリガーされない）

### Zendeskに反映されない
- GitHub Actionsが緑✅になっているか確認
- Zendeskのページをリロード（Ctrl+Shift+R / Cmd+Shift+R）

### 「Confirm access」画面が出る
- GitHubのセキュリティ確認。「Verify via email」を押してメールのリンクをクリック

---

## リポジトリ情報

- **GitHub**: https://github.com/ymjiot-spec/zendesk-yoyaku
- **ブランチ**: main
- **ワークフローファイル**: `.github/workflows/deploy-zendesk-app.yml`

---

## ZendeskのAPIトークン取得方法（参考）

1. Zendesk管理画面 → アプリとインテグレーション → Zendesk API
2. 「トークンアクセス」を有効化
3. 「APIトークンを追加」→ トークンをコピー
