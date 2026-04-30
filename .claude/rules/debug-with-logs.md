# バグ調査時のログ確認ルール

バグ報告・不具合調査を行うとき、コードを読む前に必ずセッションログを確認すること。

## ログファイルの場所

Electron の `app.getPath("logs")` が指すディレクトリ（macOS では `~/Library/Logs/VideoJockeyJS/`）に以下の2種類が生成される：

- `session-YYYY-MM-DD-HH-MM-SS.log` — メインプロセスのテキストログ（起動・IPC・クラッシュ等）
- `session-YYYY-MM-DD-HH-MM-SS.jsonl` — レンダラー/Output から送られた構造化ログ（各行がJSON）

調査対象のパフォーマンス時刻に対応するファイルを特定して読む。

```bash
ls ~/Library/Logs/VideoJockeyJS/ | tail -10
```

## JSONL の読み方

各行は `{ "ts": <epoch_ms>, "level": "info"|"warn"|"error", "src": "controller"|"output", "op": "<操作名>", "data": {...} }` 形式。

主な `op` の意味：
- `plugin:mount` / `plugin:unmount` — プラグインのロード・解放
- `video:playing` / `video:stalled` / `video:waiting` / `video:error` — 映像再生状態
- `video:loadedmetadata` — 動画メタデータ取得（duration確認に使う）
- `layer:go` — GOボタン押下（transition type + 前後のプラグインIDが入る）

## 調査手順

1. 問題発生時刻周辺の `error` / `warn` エントリを先に抽出する
2. その前後の `info` エントリで操作の流れを確認する
3. `video:stalled` や `video:waiting` が繰り返されている場合はデコードエラーまたはループ処理のバグを疑う
4. `plugin:unmount` が意図しないタイミングで発生していないか確認する

## ログが存在しない場合

- Controller の PerfBar に表示される LOG ボタンが OFF になっている可能性がある
- アプリ起動直後からログは開始される（手動でONにする必要はない）
- ログ書き込みを停止した場合は再起動で再開する
