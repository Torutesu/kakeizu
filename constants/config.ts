// 家系図アプリケーションの設定定数
export const LAYOUT_CONFIG = {
  // レイアウト設定
  generationSpacing: 250,     // 世代間隔
  minFamilySpacing: 450,      // 家族間の最小間隔
  cardSpacing: 200,           // カード間の最小間隔
  spouseSpacing: 180,         // 配偶者間の間隔
  cardWidth: 160,             // カードの幅
  cardHeight: 120,            // カードの高さ
  cornerRadius: 8,            // 線の角の丸み

  // キャンバス境界
  canvasPadding: 100,         // 人物・関係線の周囲に確保するSVGの余白
  // 極端なCSS座標はブラウザのレイアウト／合成処理を不安定にするため、
  // 通常の家系図では十分に広い範囲を上限とする
  maxCanvasCoordinate: 1_000_000,

  // 初期位置
  initialX: 100,
  initialY: 80,

  // ズーム設定
  minZoom: 0.1,
  maxZoom: 3,
  zoomStep: 1.2,
  defaultZoom: 1,
} as const

// ズーム・ピンチ感度や表示に関するユーザー設定（設定画面から変更可能）
export const ZOOM_SETTINGS_CONFIG = {
  storageKey: 'family-tree-app:zoom-settings:v1',
  // マウスホイール／トラックパッドのピンチ操作でのズーム感度（大きいほど少ない操作で大きくズームする）
  wheelSensitivity: { min: 0.2, max: 3, step: 0.1, default: 1 },
  // ズームイン・アウトボタン1クリックあたりの拡大率
  buttonZoomStep: { min: 1.05, max: 2, step: 0.05, default: LAYOUT_CONFIG.zoomStep },
} as const

export type ZoomSettings = {
  wheelSensitivity: number
  buttonZoomStep: number
  // 世代ガイド（青い破線と「第N世代」ラベル）を常時表示するか、人物カードをドラッグしている間だけ表示するか
  alwaysShowGenerationGuides: boolean
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  wheelSensitivity: ZOOM_SETTINGS_CONFIG.wheelSensitivity.default,
  buttonZoomStep: ZOOM_SETTINGS_CONFIG.buttonZoomStep.default,
  alwaysShowGenerationGuides: false,
}

export const COLORS = {
  // 性別による色分け
  male: {
    background: 'bg-blue-50',
    border: 'border-blue-200',
    indicator: 'bg-blue-500',
  },
  female: {
    background: 'bg-pink-50',
    border: 'border-pink-200', 
    indicator: 'bg-pink-500',
  },
  unknown: {
    background: 'bg-white',
    border: 'border-gray-200',
    indicator: 'bg-gray-400',
  },

  // 線の色
  marriageLine: '#dc2626',        // 結婚関係線（赤）
  parentChildLine: '#6b7280',     // 親子関係線（グレー）

  // 状態色
  uncertain: {
    background: 'bg-yellow-50',
    border: 'border-yellow-400 border-dashed',
    text: 'text-yellow-600',
  },
  selected: 'ring-2 ring-blue-500',
} as const

export const DATA_CONFIG = {
  // デフォルト値
  defaultGeneration: 1,
} as const

export const UI_CONFIG = {
  // サイドバー設定
  leftSidebarWidth: 320,
  rightSidebarWidth: 320,

  // アニメーション設定
  transitionDuration: '0.1s',
} as const
