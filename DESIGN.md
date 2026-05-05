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
| （なし） | ステータス確認（`{ status: "running", version: "4.0" }`） |

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
  "date": "2026/05/05"
}
```

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
| C | 著者名 | |
| D | 評価 | 1〜5の整数 |
| E | 要約 | |
| F | 読書メモ | |
| G | 登録日 | yyyy/MM/dd |
| H | 📁画像フォルダ | リッチテキストリンク |

---

## フロントエンドの主要状態変数

| 変数 | 説明 |
|------|------|
| `apiKey` | Anthropic APIキー（sessionStorageに保存） |
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

---

## 既知の問題・改善予定

| 優先度 | 内容 | 詳細 |
|--------|------|------|
| ~~高~~ | ~~エラーメッセージが不親切~~ | 2026-05-05 対応済：GAS URL・デプロイ設定・URL変更の3点チェックを案内するメッセージに改善 |
| ~~高~~ | ~~CORSプリフライトによる保存失敗~~ | 2026-05-05 対応済：Content-Type を text/plain;charset=utf-8 に変更してプリフライトを回避 |
| 中 | 起動時GAS疎通テスト未実装 | GAS URLが無効でも起動時に気づけない。保存時に初めてエラーになる |
| 中 | GAS ping アクション未実装 | 疎通テスト用に `?action=ping` を追加すべき |

→ 詳細は [feedback/network_error_recurring.md](feedback/network_error_recurring.md) を参照

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-05-05 | DESIGN.md 初版作成 |
