// ============================================================================
// 実機確認に必要な環境変数の受け取りと、足りないときの扱い。
//
// 足りないものは**失敗ではなく skip** にする。実機確認は「鍵が全部そろうまで
// 何も流せない」より「そろった分から流す」ほうが役に立つ。
// ============================================================================

export interface LiveAccount {
  email: string
  password: string
}

function account(prefix: string): LiveAccount | null {
  const email = process.env[`${prefix}_EMAIL`]
  const password = process.env[`${prefix}_PASSWORD`]
  if (!email || !password) return null
  return { email, password }
}

export const live = {
  baseUrl: process.env.LIVE_BASE_URL ?? '',
  /** 管理者。保管期間を過ぎた原本も開ける側 */
  admin: account('LIVE_ADMIN'),
  /** 作業者。保管期間の制限を受ける側。同時編集の相手役でもある */
  worker: account('LIVE_WORKER'),
  /** 閲覧のみの利用者（任意） */
  viewer: account('LIVE_VIEWER'),
  /** 確認に使う案件。未指定なら確認用の案件をその場で作る */
  projectId: process.env.LIVE_PROJECT_ID ?? '',
  /** 取り込みの確認に使う戸籍の画像・PDFを置いたディレクトリ（任意） */
  kosekiDir: process.env.LIVE_KOSEKI_DIR ?? '',
  /** 保管期間の確認に使う。RLSを迂回するため確認用の環境にだけ渡すこと */
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
}

/** この確認に要るものがそろっているか。そろっていなければ理由を返す */
export function missing(...required: Array<keyof typeof live>): string | null {
  const lack = required.filter(key => {
    const value = live[key]
    return value === null || value === '' || value === undefined
  })
  if (lack.length === 0) return null
  const names: Record<string, string> = {
    baseUrl: 'LIVE_BASE_URL',
    admin: 'LIVE_ADMIN_EMAIL / LIVE_ADMIN_PASSWORD',
    worker: 'LIVE_WORKER_EMAIL / LIVE_WORKER_PASSWORD',
    viewer: 'LIVE_VIEWER_EMAIL / LIVE_VIEWER_PASSWORD',
    projectId: 'LIVE_PROJECT_ID',
    kosekiDir: 'LIVE_KOSEKI_DIR（確認用の戸籍ファイルを置いたディレクトリ）',
    serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
    supabaseUrl: 'SUPABASE_URL',
  }
  return `未設定のため確認できません: ${lack.map(key => names[key] ?? key).join(', ')}`
}
