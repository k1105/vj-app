# VideoJockeyJS

VJ system: Controller UI + Three.js Composer を Electron の 2 ウィンドウで動かす。

詳細設計: [ARCHITECTURE.md](./ARCHITECTURE.md)
仕様書: [`../2026-04-04_system-spec-v1.md`](../2026-04-04_system-spec-v1.md)

## Dev

```bash
npm install
npm run dev
```

初回起動で Controller ウィンドウと Output ウィンドウ（1920x1080 初期サイズ）が開く。

## スクリプト

| コマンド | 説明 |
|---|---|
| `npm run dev` | electron-vite 開発サーバ (HMR) |
| `npm run build` | 本番ビルド (out/) |
| `npm run preview` | ビルド結果で起動 |
| `npm run typecheck` | main/preload と renderer の型チェック |

## 依存ツール（同梱しない）

- `yt-dlp` — YouTube ダウンロード機能で使用。`brew install yt-dlp`

## ディレクトリ

- `src/main` — Main process（ウィンドウ / IPC / pluginLoader / yt-dlp）
- `src/preload` — contextBridge
- `src/renderer` — Controller UI（React）
- `src/output` — Composer（Three.js）
- `src/core` — プラグイン共通ユーティリティ
- `src/shared` — 型定義
- `plugins/` `postfx/` `transitions/` — プラグイン配置先
- `materials/videos/` — yt-dlp ダウンロード先
