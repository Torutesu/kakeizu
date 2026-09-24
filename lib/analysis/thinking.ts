// ============================================================================
// Gemini の「思考」の深さ（純関数・テスト対象）。
//
// Gemini 3.x は既定で深く考える（high）。**思考に使ったトークンは出力として課金される**
// （Gemini 3.1 Pro で $12 / 100万トークン）。読み取り結果そのものより思考のほうが
// 長くなることもあり、費用の大きな部分を占めうる。
//
// ANALYSIS_THINKING_LEVEL で浅くできる。未設定ならモデルの既定のまま（精度を
// 変えないため）。どこまで浅くしてよいかは、実データのベンチマークで決める
// （`ANALYSIS_THINKING_LEVEL=low pnpm benchmark` と未設定の結果を比べる）。
// ============================================================================

const LEVELS = ['minimal', 'low', 'medium', 'high'] as const
export type GeminiThinkingLevel = (typeof LEVELS)[number]

export interface ThinkingResolution {
  /** SDK に渡す値（大文字）。null ならモデルの既定のまま */
  level: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | null
  /** 設定が読めなかったときの理由（黙って高い既定のまま動かさないため、ログに出す） */
  warning?: string
}

export function resolveGeminiThinkingLevel(
  model: string,
  env: { [key: string]: string | undefined }
): ThinkingResolution {
  const raw = (env.ANALYSIS_THINKING_LEVEL ?? '').trim().toLowerCase()
  if (!raw) return { level: null }

  // 2.5系は thinkingLevel ではなく thinkingBudget で指定する。渡すとエラーになるため、
  // フォールバックで2.5系に落ちたときは既定のまま動かす
  if (!model.startsWith('gemini-3')) return { level: null }

  if (!(LEVELS as readonly string[]).includes(raw)) {
    return {
      level: null,
      warning:
        `ANALYSIS_THINKING_LEVEL=${env.ANALYSIS_THINKING_LEVEL} は使えない値のため、` +
        `モデルの既定のまま読み取ります（${LEVELS.join(' / ')} のいずれか）`,
    }
  }
  return { level: raw.toUpperCase() as ThinkingResolution['level'] }
}
