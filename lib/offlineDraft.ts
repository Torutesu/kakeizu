import { TreeDelta } from '../utils/mergeTreeChanges'

// ============================================================================
// オフラインでの編集の持ち越し。
//
// 通信が切れている間も編集を続けられるようにし、つながったら送る。
// タブを閉じたり再読み込みしても消えないよう、端末に残す。
//
// **持ち越すのは「自分が何を変えたか」だけ**（家系図まるごとではない）。
//   - 復帰したときに、その時点のサーバーの内容へ重ね直せる
//     （まるごと持ち越すと、自分が触っていない箇所まで古い値で上書きしてしまう）
//   - 端末に残る個人情報の量が減る
//
// **保存できた時点で必ず消す。** 戸籍の個人情報を、必要のない間ずっと端末に
// 置いたままにしないため（要件8章・4.8の考え方に合わせる）。
// ログアウト時にも消す。
// ============================================================================

const KEY_PREFIX = 'kakeizu:offline-draft:'

export interface OfflineDraft {
  /** この変更の土台になったサーバーの版数 */
  baselineVersion: number
  delta: TreeDelta
  savedAt: string
}

function keyOf(projectId: string, userId: string): string {
  return `${KEY_PREFIX}${projectId}:${userId}`
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    // プライベートブラウジング等で参照そのものが例外になる場合がある
    return null
  }
}

export function saveOfflineDraft(
  projectId: string,
  userId: string,
  draft: OfflineDraft
): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(keyOf(projectId, userId), JSON.stringify(draft))
  } catch (error) {
    // 容量超過など。持ち越せないだけで、編集そのものは続けられる
    console.warn(
      '未保存の変更を端末に残せませんでした:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function loadOfflineDraft(projectId: string, userId: string): OfflineDraft | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(keyOf(projectId, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as OfflineDraft
    if (typeof parsed?.baselineVersion !== 'number' || !parsed?.delta) return null
    return parsed
  } catch {
    return null
  }
}

export function clearOfflineDraft(projectId: string, userId: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(keyOf(projectId, userId))
  } catch {
    // 消せなくても実害はない（次の保存成功で上書きされる）
  }
}

/** ログアウト時に、この端末に残っている未保存の変更をすべて消す */
export function clearAllOfflineDrafts(): void {
  const store = storage()
  if (!store) return
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(KEY_PREFIX)) keys.push(key)
    }
    keys.forEach(key => store.removeItem(key))
  } catch {
    // 消せない環境では何もしない
  }
}
