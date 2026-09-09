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
| 画像・PDF保存 | Google Drive（GAS経由、本ごとのフォルダ） |
| ホスティング | GitHub Pages（`kanaeru-apps/book-scanner` / `/book-scanner/` パス） |

**アプリURL：** https://kanaeru-apps.github.io/book-scanner/

**添付ファイル：** 新規登録後、または「画像・PDFを追加」から登録済みの本を選び、画像とPDFを保存できる。PDFは日本語のファイル名と原本のバイト列を保持し、画像は従来どおりJPEGに縮小する。上限は1ファイル20MB・選択合計50MB・20ファイル。保存後にDriveへのリンクを表示し、失敗したファイルだけ再送できる。保存先フォルダの共有設定は変更しない。PDFの内容をAI解析する機能ではない。

既存GASの `uploadImage` はMIMEタイプとファイル名を受け取りBlobを作るため、PDF対応にGASの再デプロイは不要。回帰確認は `node tests/attachments.test.cjs`。Drive呼び出しをモックし、実際のGAS保存関数に渡るPDFのバイト列・MIME・名前と画像の互換性を検証する。

**keep-alive の稼働場所（2026-08-04時点）：** 新リポジトリの `keepalive.yml` は **無効化中**（`GAS_URL` / `CHATWORK_API_TOKEN` / `CHATWORK_ROOM_ID` の3つのsecretが未設定のため、有効なままだと毎時失敗する）。実際のping稼働は旧 `ChihiroHonma/book-scanner-archive` 側が継続している。新リポジトリのSettings→Secretsに3件を登録してから `gh workflow enable keepalive.yml -R kanaeru-apps/book-scanner` で切り替えること。
（2026-08-04 に `ChihiroHonma/book-scanner` から移設。旧URL `chihirohonma.github.io/book-scanner/` は移行完了後に停止する）

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
| ~~中~~ | ~~起動時GAS疎通テスト未実装~~ | 2026-06-10 対応済：起動時に `?action=ping` を打ち、失敗したら復旧手順つきの警告を常時表示する `checkGasHealth()` を実装 |
| ~~高~~ | ~~OAuth承認の失効で403（2026-06-04発生）~~ | 2026-06-10 復旧・対策済：keepAliveトリガーごと認証失効し6日間気づけなかった。keep-alive ping失敗時にChatworkへ即通知（状態変化時のみ）＋起動時疎通チェックを実装。詳細は [feedback/oauth_revocation_2026_06.md](feedback/oauth_revocation_2026_06.md) |
| 低 | 承認失効の根本原因が未確定 | パスワード変更・セキュリティ診断・Google側の自動失効のいずれかの可能性。[Googleアカウントの接続管理](https://myaccount.google.com/connections) の履歴で確認予定 |
| ~~高~~ | ~~Webアプリのデプロイ失効で403（2026-06-17発生）~~ | 2026-06-18 復旧・対策済：**OAuth失効とは別物**。アクセス=全員のままユーザー無操作で匿名アクセスが403に。`keepAlive`トリガーは成功＝OAuthは無事だったため `testAuth` では直らず、**新バージョン再デプロイ＋URL貼り替え**で復旧。誤誘導を防ぐため、起動時警告とChatwork通知を「まず再デプロイ→ダメならtestAuth」の順＋HTTPステータス表示に改修。詳細は [feedback/web_403_oauth_intact_2026_06_17.md](feedback/web_403_oauth_intact_2026_06_17.md) |
| 中 | 匿名公開モデルの構造的脆さ | スマホからログイン不要で使うには「全員に公開」が必須で、Googleが時々その匿名アクセスをロックする。完全な根絶は本格再構築（サーバーレス＋サービスアカウント・有料）が必要。当面は「めったに壊れない＋即検知＋数十秒で復旧」の運用でカバー（[なおし方メモ.md](なおし方メモ.md)） |
| 中 | **6/29のOAuth同意画面本番公開後も承認切れが再発** → 7/4に再認可実施済み・経過観察中 | 原因は「本番公開しても既発行の旧トークン（テスト中発行・7日期限付き）は延命されない」仕様が最有力。7/4にアクセス権削除→testAuth再認可を実施し、7/5時点でWeb App（ping/getBooks）正常を確認済み。**判定日2026-07-12：それまで失敗通知が来なければ恒久解決確定**。再発したらGCP紐付けと公開ステータスの一致を再確認。詳細は [feedback/oauth_expiry_after_production_2026_07_04.md](feedback/oauth_expiry_after_production_2026_07_04.md) |

| ~~高~~ | ~~リポジトリ移設でGitHub Pagesが消滅しアプリ全停止（2026-08-03発生）~~ | 2026-08-04 復旧済：旧リポジトリを非公開化した時点でPagesが消え、アプリURLが404に。**GASは正常なのでkeep-alive pingは成功し続け、フロント側の死活を誰も見ていなかった**ため検知が遅れた。詳細は [feedback/pages_lost_on_repo_migration_2026_08_04.md](feedback/pages_lost_on_repo_migration_2026_08_04.md) |
| 中 | フロント（GitHub Pages）の死活監視が無い | keep-aliveはGAS（サーバー側）しか見ていない。アプリURL自体の200監視を keepalive.yml に足すと今回の事象を自動検知できる（未実装） |
| ~~高~~ | ~~古いデプロイのURLを設定していて機能が動かない（2026-08-06発生）~~ | 2026-08-06 対応済：デプロイが4つ存在し、正常応答するのは最新版(v30)の1つだけだった。**残り3つもHTTP 200を返す**（@HEADはGoogleログイン画面、v1/v12は旧コードの別JSON）ため、HTTPコードだけを見ていた keep-alive では検知できなかった。判定基準をアプリ側 `checkGasHealth()` と同じ「本文の `ok:true`」に統一し、不一致時は `BAD_RESPONSE` としてデプロイ選び直しの手順つきでChatwork通知するよう改修 |
| ~~中~~ | ~~空欄のまま「保存」を押すと設定ボックスの入力欄が消える~~ | 2026-08-06 対応済：`showError()` は対象要素の `textContent` を丸ごと差し替える実装なのに、エラー表示用要素ではなく設定ボックス自体の id（`apiBox` / `configBox`）を渡していた。入力欄とボタンが消え、5秒後に文字も消えるためリロードしないと復旧できなかった。各ボックスに専用の `error-box`（`apiErrorBox` / `gasErrorBox`）を追加して解消 |
| ~~中~~ | ~~ホーム画面に追加すると設定（APIキー2つ＋GAS URL）が消える~~ | 2026-08-06 対応済：iOSではSafariとホーム画面アプリでlocalStorageが別扱いになることがある。localStorage/IndexedDB/Cache APIはいずれも同じ分離ルールに従うため**自動引き継ぎは実現不可能**。代わりに「引き継ぎコード」（3つの設定をまとめたBase64文字列）を作り、貼り付け1回で復元できる仕組みを実装。standalone起動かつ設定が空のときは移行手順の案内バナーを自動表示する |

→ 詳細は [feedback/network_error_recurring.md](feedback/network_error_recurring.md) を参照
→ 止まったときの非技術者向け手順は [なおし方メモ.md](なおし方メモ.md) を参照

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-05-05 | DESIGN.md 初版作成 |
| 2026-05-29 | keep-alive ping の「URL malformed」失敗を修正（URL抽出をgrep方式に変更）。経緯は [feedback/github_actions_url_malformed.md](feedback/github_actions_url_malformed.md) |
| 2026-05-30 | C列に「表紙画像」を追加。登録時に表紙画像をセル内画像として自動埋め込み（v5.0）。旧8列シートは自動マイグレーション |
| 2026-06-10 | OAuth承認失効（6/4発生）から復旧。再発対策：①keep-alive失敗→Chatwork即通知（復旧通知つき） ②起動時GAS疎通チェック ③通知に復旧手順を埋め込み。経緯は [feedback/oauth_revocation_2026_06.md](feedback/oauth_revocation_2026_06.md) |
| 2026-06-18 | Webアプリのデプロイ失効による403（6/17発生）から復旧。OAuth失効と症状が同じ403でも原因が違うことが判明。再発対策（実用ハードニング）：①起動時警告とChatwork通知を「まず再デプロイ→ダメならtestAuth」順＋HTTPステータス表示に改修 ②非技術者向け [なおし方メモ.md](なおし方メモ.md) を新設。経緯は [feedback/web_403_oauth_intact_2026_06_17.md](feedback/web_403_oauth_intact_2026_06_17.md) |
| 2026-07-04 | 6/29のOAuth同意画面本番公開後にも承認切れが再発している問題を調査。「本番公開しても既発行トークンの7日期限は消えない」仕様が主要因の可能性。原因候補4つと確認・再認可手順（GCP紐付け確認→公開ステータス確認→アクセス権削除→testAuth再認可）を整理してユーザーに案内、同日ユーザーが全手順を実施。経緯は [feedback/oauth_expiry_after_production_2026_07_04.md](feedback/oauth_expiry_after_production_2026_07_04.md) |
| 2026-08-04 | **`kanaeru-apps/book-scanner` へ移設**（匿名化対策の一環）。全43コミットのauthor/committerを `git filter-repo --mailmap` で `kanaeru-apps` に統一し、新規リポジトリへ通常push。GitHub Pages を有効化しアプリURLを https://kanaeru-apps.github.io/book-scanner/ に変更。8/3のリポジトリ作り直しでPagesが消えアプリが停止していた障害からの復旧も兼ねる。経緯は [feedback/pages_lost_on_repo_migration_2026_08_04.md](feedback/pages_lost_on_repo_migration_2026_08_04.md) |
| 2026-08-06 | ①**keep-aliveの合否判定を「HTTP 200」から「本文の `ok:true`」へ変更**。デプロイが4つ存在し3つが誤った応答をHTTP 200で返していたため、監視が緑のままアプリが動かない状態を見逃していた。新ステータス `BAD_RESPONSE` を追加し、デプロイ選び直しの手順つきで通知する。②`kanaeru-apps` 側で keep-alive を有効化（secret 3件を再設定）。③**設定の引き継ぎ機能を実装**。ホーム画面追加でAPIキーが消える問題に対し、3つの設定をまとめた「引き継ぎコード」の作成・復元と、standalone起動時の案内バナーを追加 |
| 2026-07-05 | 朝の失敗通知（keepAlive Authorization is required）を調査。エラー発生は7/4 3:13＝**再認可前の残骸**をGoogleの日次サマリーが約24時間遅れで報告したものと確定（Gmail本文・Web App直接検証で裏取り）。現在の認可は正常（ping/getBooks成功）。判定日7/12まで経過観察。keepAliveは失効検知のカナリアとして有効と再評価 |
