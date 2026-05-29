# GAS Webアプリ「長期非アクセス403」対策パターン

2026-05-18 に実施した修正のポイント。他のGASプロジェクトでも再利用可能。

---

## 問題のサマリー

GAS Webアプリは、**再デプロイしていなくても約1ヶ月の非アクセスで突然 403 Forbidden を返す**ことがある。OAuth承認・デプロイ設定が全て正しくても発生する。

エラーHTMLは「アクセスが拒否されました」だが、根本原因はアクセス権限ではなく、**スクリプトの「実行コンテキスト休眠」**（観察ベースの仮説。Google公式仕様には未確認）。

---

## 修正のポイント（4点）

### ① 「休眠」と「OAuth承認失効」は別物

| 区分 | 症状 | 復旧手段 |
|---|---|---|
| OAuth承認失効 | 許可ダイアログが出る | 許可をクリック |
| **今回の休眠** | 許可ダイアログ**なし**で外部アクセスが403 | testAuth() を1回実行 |

切り分けは「testAuth() 実行時に許可ダイアログが出るかどうか」で判定できる。

### ② 復旧は testAuth() 1回でOK

スクリプト所有者が任意の関数を1回実行するだけで、外部アクセスが復活する。新規デプロイ不要、URL変更不要。

### ③ 根本対策は「毎日1回 所有者として軽量実行」

休眠を未然に防ぐため、`keepAlive()` 関数を毎日トリガーで自動実行する。

```javascript
function keepAlive() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const folder = DriveApp.getRootFolder();
    Logger.log("keepAlive OK: " + ss.getName() + " / " + folder.getName() + " @ " + new Date().toISOString());
  } catch (err) {
    Logger.log("keepAlive error: " + err.message);
  }
}
```

トリガー設定は **GASエディタの時計アイコン → 手動で「日タイマー／午前3時〜4時」で keepAlive を登録**するのが最速。コードからの `ScriptApp.newTrigger()` は追加スコープが必要になるため、手動UI登録の方が手間が少ない。

### ④ XHRの`onerror`は403を区別できない仕様

ブラウザの XMLHttpRequest は **CORS拒否・403・接続失敗を全て同じ `onerror` で通知する**。アプリ側で「ネットワークエラー」としか表示できない理由はこれ。

→ 対策：エラーメッセージに「testAuth()実行」「デプロイ設定確認」など具体的な対処手順を含める（[index.html:872-874](../index.html#L872) で実装済み）。

---

## 他プロジェクトへの再利用手順

別のGAS Webアプリで同じ問題が起きたら、または起きる前に予防として：

1. コード.gs に上記 `keepAlive()` 関数を貼り付け
2. GASエディタ → 時計アイコン → 「+ トリガーを追加」
3. 関数=`keepAlive`、種類=日タイマー、時刻=午前3時〜4時
4. 「保存」→ 認証ダイアログで「許可」
5. 完了

これだけ。コード側は1関数追加するだけで、`ScriptApp` を直接使わないので追加スコープも不要。

---

## 関連ファイル

- [gas_auth_network_error.md](gas_auth_network_error.md) — 詳細な調査経緯・なぜなぜ分析・観察事実
- [network_error_recurring.md](network_error_recurring.md) — 初期対応（CORS / エラーメッセージ改善）
- [../コード.gs](../コード.gs) — `keepAlive` / `setupKeepAliveTrigger` の実装
- [../DESIGN.md](../DESIGN.md) — プロジェクト全体設計
