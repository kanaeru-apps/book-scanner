# リポジトリ移設でGitHub Pagesが消滅しアプリが全停止（2026-08-03発生 / 08-04復旧）

## 事象

アプリを開こうとしても使えない状態になっていた。原因はGASでもスプレッドシートでもなく、
**アプリ本体を配信していたGitHub Pagesが消えていた**こと。

```
https://chihirohonma.github.io/book-scanner/  →  HTTP 404
```

## 何が起きたか（確認できた事実）

| 時刻 | 出来事 |
|---|---|
| 2026-08-03 14:31 | `ChihiroHonma/muon-camera` を作り直し（中身push済・Pages有効・完了） |
| 2026-08-03 14:34 | 旧 `book-scanner` を `book-scanner-archive` にリネームし非公開化 → **この時点でPagesが消滅** |
| 2026-08-03 14:34 | 空の `ChihiroHonma/book-scanner` を新規作成 → **pushとPages有効化が未実施のまま中断** |
| 2026-08-04 | ユーザーが「アプリが使えない」と報告 → 調査で判明 |

muon-camera は最後まで完了していたが、book-scanner だけ「旧を止める」→「新を立てる」の
**後半が抜けた状態で放置**されていた。

## 根本原因

1. **順序が逆だった。** 旧リポジトリの非公開化（＝Pages停止）を、新リポジトリの
   push・Pages有効化・疎通確認より**先に**実施した。移設は必ず
   「新を立てる → 疎通確認 → 旧を止める」の順にする
2. **フロントの死活監視が存在しなかった。** keep-alive ping はGAS（サーバー側）だけを見ており、
   GASは正常だったので毎時「成功」を返し続けた。アプリのURL自体が404になっても
   通知は一切飛ばず、ユーザーが手で開くまで誰も気づけなかった

## 教訓・再発防止

- **移設手順は「新→確認→旧停止」を固定順とする。** 旧を先に止めない
- **移設は1リポジトリずつ最後まで完了させる。** 複数を並行して途中まで進めると、
  どれが未完了か分からなくなる
- **死活監視は「ユーザーが触る面」に置く。** サーバーが生きていてもアプリが死ぬ経路がある。
  keepalive.yml にアプリURLの200チェックを足せば同じ事象を自動検知できる（未実装・改善案）
- **PWAはドメインが変わるとlocalStorageが失われる。** 移設前にAPIキー・GAS URLを
  控えておく（旧URLが生きているうちに取得する）

## 復旧内容（2026-08-04）

- `git filter-repo --mailmap` で全43コミットのauthor/committerを `kanaeru-apps` に統一
- `kanaeru-apps/book-scanner` を新規作成して通常push、GitHub Pages を有効化
- アプリURLは https://kanaeru-apps.github.io/book-scanner/ に変更
- keep-alive は当面 `ChihiroHonma/book-scanner-archive` 側で稼働継続（secret移設後に切替）
