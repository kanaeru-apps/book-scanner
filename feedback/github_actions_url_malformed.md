# フィードバック：GitHub Actions keep-alive ping が「URL malformed」で毎時失敗

**日付：2026-05-29**

---

## 結論（一言で）

毎時失敗の原因は、**`GAS_URL` secret に紛れ込んだ「目に見えない文字」**だった。
ワークフローの空白除去 `tr -d '[:space:]'` は半角スペース等の**単バイト空白しか消せず**、
**全角スペースなどのマルチバイト不可視文字が URL に残り、curl が URL malformed (exit 3) で弾いていた**。

➡ GAS 本体がダウンしていたわけでも、403 だったわけでもない。

---

## 何が起きたか（症状）

- GitHub Actions「GAS keep-alive ping」が毎時（#2〜#6）すべて失敗 → 失敗メールが毎時届く
- ログのエラー：
  ```
  curl: (3) URL rejected: Malformed input to a URL function
  Error: Process completed with exit code 3.
  ```
- わずか「2秒で失敗」＝ curl が GAS に到達する前に、URL 自体を不正として弾いていた

---

## なぜなぜ分析（5回）

| # | 問い | 答え |
|---|------|------|
| 1 | なぜ失敗した？ | curl が exit 3（URL malformed）で終了したため |
| 2 | なぜ URL が不正？ | secret から組み立てた URL に、curl が許容しない文字が混入していたため |
| 3 | なぜ混入文字が残った？ | サニタイズの `tr -d '[:space:]'` は**半角スペース・タブ・改行など単バイト空白しか除去できず**、全角スペース(U+3000)・NBSP(U+00A0)・ゼロ幅文字などの**マルチバイト不可視文字を除去できない**ため |
| 4 | なぜそんな文字が入った？ | secret に URL を貼り付ける際、日本語IME由来の全角スペースや、ドキュメント/ブラウザからのコピーで不可視文字が紛れ込んだ（※secret は表示不可のため断定はできず、観察と症状からの推測） |
| 5 | なぜ仕組みで防げなかった？ | サニタイズが単バイト空白しか想定しておらず、URL として妥当かの検証もなかったため、混入を検知も除去もできなかった |

---

## 根本原因

`tr -d '[:space:]'` は **バイト単位**で動くため、単バイト空白しか消せない。
全角スペース(U+3000 = `E3 80 80`)・NBSP(U+00A0 = `C2 A0`)・ゼロ幅スペース等は
**複数バイトの不可視文字**で、tr では消えずに URL に残る。その不正文字を curl が拒否した。

---

## 修正内容

「不要な文字を**引き算で消す**」のではなく「正しい URL の**形だけを抜き出す**」方式に変更した。

**Before:**
```bash
url=$(printf '%s' "${GAS_URL}" | tr -d '[:space:]')
```

**After:**
```bash
url=$(printf '%s' "${GAS_URL}" | grep -oiE 'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec' | head -1)
```

`grep` で URL の形に一致する部分だけを抽出するため、**前後に混入した不可視文字・クォート・改行などをまとめて無視できる**。
抽出できなければ空になり、原因が分かる日本語メッセージで停止する。

→ 実装：[../.github/workflows/keepalive.yml](../.github/workflows/keepalive.yml)
→ 結果：手動実行 #7 が Success（HTTP 200）。修正成功＋GAS 本体も正常稼働を確認。

---

## 教訓・再発防止

- **シェルでユーザー入力の URL をサニタイズするときは、「不要文字を消す」より「必要な形を抜き出す」方が堅牢。**
  `tr -d '[:space:]'` はマルチバイト不可視文字に無力。
- **日本語環境では全角スペース(U+3000)の混入を常に疑う。** 半角スペースと見た目がほぼ同じで、コピペで紛れ込みやすい。
- **GAS 本体の死活と、外部 ping ワークフローの死活は別物。**
  ping 失敗 = GAS ダウンとは限らない（今回は curl が GAS に到達すらしていなかった）。
  切り分けは「ログに HTTP ステータスが出ているか／curl 自体のエラーか」で判定する。
- **secret を貼り直すときは、メモ帳等でプレーンテキスト化してから貼る**と不可視文字の混入を防げる。

---

## 関連ファイル

- [../.github/workflows/keepalive.yml](../.github/workflows/keepalive.yml) — 修正したワークフロー
- [keepalive_pattern.md](keepalive_pattern.md) — GAS 側の「長期非アクセス403」対策（別問題）
- [gas_auth_network_error.md](gas_auth_network_error.md) — GAS 403/休眠の調査経緯
