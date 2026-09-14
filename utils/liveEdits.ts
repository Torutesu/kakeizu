import { ProcessedPerson, buildDisplayName } from './familyDataProcessor'

// ============================================================================
// 保存前の編集を、その場で他の利用者へ見せる（表計算ソフトの共同編集に近づける）。
//
// 保存はDBを経由するため、どうしても「手を止めてから1〜2秒後」になる。
// 入力中・ドラッグ中の様子まで見せるには、**保存とは別の経路**で流す必要がある。
//
// ここで流すのは**まだ保存されていない下書き**であり、家系図のデータではない。
// 受け取った側は表示にだけ重ね、自分の保存データには混ぜない。
// 混ぜてしまうと、他人の入力途中の値を自分が保存することになる。
// ============================================================================

export interface LiveEditDraft {
  surname?: string
  givenName?: string
  sex?: 'male' | 'female' | null
  birthDate?: string | null
  deathDate?: string | null
}

export interface LiveEdit {
  personId: string
  userId: string
  /** 画面に出す名前 */
  label: string
  /** 入力中の値（編集ダイアログ） */
  draft?: LiveEditDraft
  /** ドラッグ中の位置 */
  position?: { x: number; y: number }
  /** 送信時刻。古いものは掃除する */
  at: number
}

/** 下書きが届かなくなってから、これを過ぎたら消す（送信者が落ちた場合の保険） */
export const LIVE_EDIT_TTL_MS = 12_000

/**
 * 編集者の色。利用者ごとに安定した色を割り当てる（毎回変わると誰の色か覚えられない）。
 * 人物カードの性別の色（青・桃・灰）と混ざらない色味を選んでいる。
 */
const EDITOR_COLORS = [
  '#7c3aed', // 紫
  '#0d9488', // 青緑
  '#c2410c', // 橙
  '#4d7c0f', // 萌黄
  '#a21caf', // 赤紫
  '#0369a1', // 藍
] as const

export function editorColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return EDITOR_COLORS[hash % EDITOR_COLORS.length]
}

/** 期限切れの下書きを落とす */
export function pruneLiveEdits(
  edits: Map<string, LiveEdit>,
  now: number = Date.now()
): Map<string, LiveEdit> {
  const alive = new Map<string, LiveEdit>()
  edits.forEach((edit, key) => {
    if (now - edit.at <= LIVE_EDIT_TTL_MS) alive.set(key, edit)
  })
  return alive
}

/**
 * 受け取った下書きを、表示用の人物データへ重ねる。
 * **元の配列は変えない。**重ねた結果は表示専用で、保存には使わない。
 */
export function applyLiveEdits(
  persons: ProcessedPerson[],
  edits: Map<string, LiveEdit>
): ProcessedPerson[] {
  if (edits.size === 0) return persons

  return persons.map(person => {
    const edit = edits.get(person.id)
    if (!edit) return person

    const next: ProcessedPerson = { ...person }

    if (edit.draft) {
      const name = {
        surname: edit.draft.surname ?? person.name.surname,
        given_name: edit.draft.givenName ?? person.name.given_name,
      }
      next.name = name
      next.displayName = buildDisplayName(name)
      if (edit.draft.sex !== undefined) next.sex = edit.draft.sex
      if (edit.draft.birthDate !== undefined) {
        next.birth = { ...person.birth, date: edit.draft.birthDate }
      }
      if (edit.draft.deathDate !== undefined) {
        next.death = { ...person.death, date: edit.draft.deathDate }
      }
    }

    if (edit.position) {
      next.x = edit.position.x
      next.y = edit.position.y
    }

    return next
  })
}
