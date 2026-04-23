# hatakanata-vj — Application Architecture

_基礎設計。詳細仕様は `../2026-04-04_system-spec-v1.md` を参照。_

## プロセス / ウィンドウ構成

```
┌─ Main Process ─────────────────────────────────────────┐
│  - BrowserWindow 管理（Controller / Output）            │
│  - plugins/ postfx/ transitions/ の fs.watch            │
│  - yt-dlp spawn（materials/videos/ に保存）             │
│  - electron-store による設定永続化                      │
└────────────────────────────────────────────────────────┘
        │ IPC (contextBridge)
        ├────────────────────┬─────────────────────
┌─ Controller Window ─┐  ┌─ Output Window ────┐
│ React UI            │  │ Three.js Composer  │
│ - Assets            │  │ - WebGLRenderer x1 │
│ - Layer Stack       │  │ - renderTargets    │
│ - Params            │  │ - blend / postfx   │
│ - Transport         │  │ - transitions      │
│ state: zustand      │  │                    │
└─────────────────────┘  └────────────────────┘
```

- Controller が「何を出すか」の状態 (layers, params, bpm, ...) を保持
- Main 経由で Output に broadcast → Composer がレンダリング
- Output ウィンドウはフルスクリーン化してセカンドモニター / プロジェクターへ

## ディレクトリ

```
src/
  main/
    index.ts            ← app.whenReady, 両ウィンドウ生成
    windows.ts          ← createControllerWindow / createOutputWindow
    ipc.ts              ← ipcMain.handle / broadcast
    pluginLoader.ts     ← plugins, postfx, transitions を fs.readdir + watch
    videoDownloader.ts  ← yt-dlp spawn + 進捗 IPC
    store.ts            ← electron-store ラッパ
  preload/
    index.ts            ← contextBridge で window.vj API 公開
    index.d.ts
  renderer/             ← Controller (React)
    index.html
    main.tsx
    App.tsx
    components/
      TopBar.tsx
      AssetsPanel.tsx
      LayerStack.tsx
      AssetParamsPanel.tsx
      TransportBar.tsx
    state/
      vjStore.ts        ← zustand store (layers, params, bpm, transitions)
    styles/
      app.css           ← v6 テーマ移植
  output/               ← Composer (Three.js)
    index.html
    main.tsx
    Composer.ts         ← WebGLRenderer 管理 + レンダリングループ
    Layer.ts
    PluginHost.ts       ← 素材プラグインのライフサイクル管理
  core/                 ← プラグインから import される共通ユーティリティ
    rhythm.ts
    dispose.ts
    easing.ts
    texture.ts
  shared/
    types.ts            ← VJState, LayerState, PluginMeta, IPCチャネル名 等

plugins/       ← 素材プラグイン（自動スキャン対象）
postfx/        ← シェーダーフィルタ
transitions/   ← トランジションシェーダー
materials/
  videos/      ← yt-dlp のダウンロード先
```

## IPC チャネル

主要チャネル（shared/types.ts で文字列定数化）。

| 方向 | チャネル | 用途 |
|---|---|---|
| R→M | `vj:download-video` | yt-dlp 実行、`{filePath, title}` を返す |
| M→R | `vj:download-progress` | ダウンロード進捗 |
| R→M | `vj:list-plugins` | プラグイン一覧取得 |
| M→R | `vj:plugins-changed` | fs.watch による差分通知 |
| R→M | `vj:state-update` | Controller → Output の状態同期 |
| M→O | `vj:state-broadcast` | Main が Output へ中継 |
| R→M | `vj:settings-get/set` | electron-store |

## レンダリングパイプライン（Output側）

```
(各レイヤー)
  素材プラグイン.update() → renderTarget に描画 → テクスチャ
      ↓
  レイヤーブレンドパス（カスタムシェーダー）
      ↓
  PostFX チェーン（EffectComposer）
      ↓
  最終 canvas
```

- WebGLRenderer は **1 つだけ** 所有（パフォーマンス & dispose 簡素化）
- 各プラグインの `dispose()` は必須。レイヤーから外れた時点で呼ぶ
- プラグイン例外時は自動ミュート + Controller にエラー通知

## 状態モデル（zustand）

```ts
interface VJState {
  global: { bpm: number; beat: number; bar: number; audio: AudioState };
  layers: LayerState[];        // 4枚程度。拡張可
  transition: { type: string; progress: number };
  postfx: PostFXChain;
  availablePlugins: PluginMeta[];
  selectedLayer: number;
}
```

状態は Controller の zustand が source of truth。変更は debounced で IPC broadcast。

## 開発スクリプト

- `npm run dev` — electron-vite dev（HMR）
- `npm run build` — 本番ビルド
- `npm run preview` — ビルド結果の動作確認

## マイルストーン（仕様書の Week 1 から）

1. electron-vite の起動 + Controller / Output 2 ウィンドウ
2. プラグインローダー（manifest 読み込み）
3. Composer（WebGLRenderer + 1 レイヤー）
4. Controller の v6 UI 移植
5. BPM / beat / bar と audio 解析
6. yt-dlp 統合
7. PostFX / Transitions
8. dispose 検証 / 30分連続稼働テスト
