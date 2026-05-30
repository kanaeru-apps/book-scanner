# Book Scanner - 設計書

## 概要・背景

スマホで本の表紙を撮影し、Claude Vision APIで書誌情報を自動抽出してGoogleスプレッドシートに登録するPWAアプリ。  
ホーム画面に追加してブックマークから使用できる。

---

## 技術構成

| 要素 | 技術 |
|------|------|
| フロントエンド | HTML / CSS / Vanilla JS（シングルファイル） |
| PWA | Service Worker + manifest.json |
| AI解析 | Claude Vision API（claude-sonnet-4-6） |
| データ保存 | Google Apps Script（GAS）Webアプリ -> Googleスプレッドシート |
| 画像保存 | Google Drive（GAS経由） |
| ホスティング | GitHub Pages（`/book-scanner/` パス） |

---

## ファイル構成

```
book-scanner/
+-- index.html          # アプリ本体（UI + JSすべて含む）
+-- manifest.json       # PWA設定
+-- service-worker.js   # オフライン対応・キャッシュ管理
+-- コード.gs           # GAS（Google Apps Script）サーバー側
+-- icons/
|   +-- icon-192.png
|   +-- icon-512.png
+-- feedback/
    +-- network_error_recurring.md  # エラー対応ログ・改善メモ
```

---

## 機能一覧

### Phase 1：表紙解析・書籍登録
1. 表紙画像をアップロードまたはカメラ撮影
2. Claude Vision APIで書誌情報（タイトル・著者・ジャンル・要約・評価）を自動抽出
3. 内容を確認・編集してスプレッドシートに登録
4. Googleドライブに書籍フォルダを自動作成

### Phase 2：ページ画像追加
5. 登録済み書籍にページ画像（メモ・気になった箇所）をドライブへアップロード
6. 「画像を追加」タブから既存書籍を選択してアップロードも可能

---

## データフロー

```
[スマホブラウザ]
    |
    +- 表紙画像 -> Claude API (api.anthropic.com)
    |              v JSON（タイトル・著者・ジャンル等）
    |
    +- 書籍データ -> GAS Webアプリ (POST)
                     v
                     +- Googleスプレッドシート（書籍一覧）
                     +- Googleドライブ（書籍フォルダ作成）
                            v
                     ページ画像 -> GAS Webアプリ (POST: uploadImage)
                                   v
                                   Googleドライブ（フォルダ内に保存）
```

---

## GASのAPI仕様

### エンドポイント
`https://script.google.com/macros/s/{DEPLOY_ID}/exec`

### doGet
| パラメータ | 動作 |
|-----------|------|
| `?action=getBooks` | 登録済み書籍一覧を返す |
| （なし） | ステータス確認（`{ status: "running", version: "5.0" }`） |

### doPost（bodyはJSON）
| `action` フィールド | 動作 |
|--------------------|------|
| `uploadImage` | 画像をGoogleドライブにアップロード |
| （省略） | 書籍をスプレッドシートに登録 |

### 書籍登録リクエスト形式
```json
{
  "title": "タイトル",
  "author": "著者名",
  "genre": "ジャンル",
  "rating": 3,
  "summary": "要約",
  "memo": "読書メモ",
  "date": "2026/05/05",
  "coverImageBase64": "（表紙画像のBase64・任意）",
  "coverImageMime": "image/jpeg"
}
```

`coverImageBase64` が含まれる場合、GASは表紙画像を本のドライブフォルダに保存し、
スプレッドシートのC列にセル内画像（CellImage）として埋め込む。

### 書籍登録レスポンス
```json
{ "success": true, "folderUrl": "https://drive.google.com/drive/folders/..." }
```

---

## スプレッドシート構造

シート名：`読書記録`

| 列 | ヘッダー | 内容 |
|----|---------|------|
| A | ジャンル | |
| B | タイトル | |
| C | 表紙画像 | セル内画像（CellImage）。新規登録時のみ自動埋め込み |
| D | 著者名 | |
| E | 評価 | 1〜5の整数 |
| F | 要約 | |
| G | 読書メモ | |
| H | 登録日 | yyyy/MM/dd |
| I | 📁画像フォルダ | リッチテキストリンク |

### 表紙画像（C列）の仕組み

- 解析に使った表紙画像を登録時にGASへ送信し、本のドライブフォルダに `_cover_*.jpg` として保存
- セル内表示にはURLアクセスが必要なため、**表紙画像ファイルのみ「リンクを知る全員が閲覧可」に共有設定**（本文ページ・他データは対象外）
- `https://drive.google.com/thumbnail?id=...&sz=w400` を `SpreadsheetApp.newCellImage()` でセルに埋め込む
- 表示サイズ（標準）：C列幅 90px / 行の高さ 120px（縦長表紙は実表示 約86×120px）
- **マイグレーション**：旧8列レイアウトのシートは `insertColumnAfter(2)` でC列を実挿入し、既存データを保持したまま右へシフト。既存行のC列は空（新規登録分のみ画像が入る）
- **【推測】** サムネイルURL方式は標準的だが、Google側の仕様変更で表示が崩れる可能性あり。崩れた場合は `IMAGE()` 関数方式へ切替可能

---

## フロントエンドの主要状態変数

| 変数 | 説明 |
|------|------|
| `apiKey` | Anthropic APIキー（localStorageに保存） |
| `gasUrl` | GAS WebアプリURL（localStorageに保存） |
| `imageBase64` | 表紙画像のBase64データ |
| `currentRating` | 選択中の星評価（デフォルト3） |
| `currentFolderUrl` | 登録後に返ってくる書籍フォルダURL |
| `pageImages` | ページ画像のキュー `{ inline: [], add: [] }` |

---

## GASデプロイ設定（必須）

| 設定項目 | 値 |
|---------|-----|
| 実行するユーザー | 自分 |
| アクセスできるユーザー | **全員（匿名ユーザーを含む）** |
| デプロイ種別 | ウェブアプリ |

**重要：**「新しいデプロイ」を作成するとURLが変わる。アプリのGAS URL設定を必ず更新すること。  
URLを変えずに更新する場合は「デプロイを管理」→既存デプロイの「編集」→「新しいバージョン」を選択。

### デプロイ後の確認チェックリスト（必須）

再デプロイのたびに認証がリセットされる場合があり、確認しないと「ネットワークエラー」で気づけない。

- [ ] **① testAuth() をGASエディタから実行**（「新しいデプロイ」を新規作成したときのみ。「新しいバージョン」更新時は不要）
- [ ] **② ブラウザでGAS URLに直接アクセスして `{"status":"running"}` が返るか確認**
- [ ] **③ スマホのSafariから保存テストを1件行う**

---

## 既知の問題・改善予定

| 優先度 | 内容 | 詳細 |
|--------|------|------|
| ~~高~~ | ~~エラーメッセージが不親切~~ | 2026-05-05 対応済：GAS URL・デプロイ設定・URL変更の3点チェックを案内するメッセージに改善 |
| ~~高~~ | ~~CORSプリフライトによる保存失敗~~ | 2026-05-05 対応済：Content-Type を text/plain;charset=utf-8 に変更してプリフライトを回避 |
| ~~高~~ | ~~長期非アクセスで403になる~~ | 2026-05-18 対応済：`keepAlive()` 関数＋毎日トリガーでスクリプトを休眠させない仕組みを実装。詳細は [feedback/gas_auth_network_error.md](feedback/gas_auth_network_error.md) |
| ~~中~~ | ~~keep-alive pingが毎時失敗（URL malformed）~~ | 2026-05-29 対応済：`GAS_URL` secret混入のマルチバイト不可視文字でcurlが落ちていた。URLを「grepで形抽出」する方式に修正。詳細は [feedback/github_actions_url_malformed.md](feedback/github_actions_url_malformed.md) |
| 中 | 起動時GAS疎通テスト未実装 | GAS URLが無効でも起動時に気づけない。保存時に初めてエラーになる |

→ 詳細は [feedback/network_error_recurring.md](feedback/network_error_recurring.md) を参照

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-05-05 | DESIGN.md 初版作成 |
| 2026-05-29 | keep-alive ping の「URL malformed」失敗を修正（URL抽出をgrep方式に変更）。経緯は [feedback/github_actions_url_malformed.md](feedback/github_actions_url_malformed.md) |
| 2026-05-30 | C列に「表紙画像」を追加。登録時に表紙画像をセル内画像として自動埋め込み（v5.0）。旧8列シートは自動マイグレーション |
