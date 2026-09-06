import { notFound } from 'next/navigation'
import { E2EFixtureClient } from './E2EFixtureClient'

// ============================================================================
// E2Eテスト用の固定データ画面。
//
// 家系図エディタの中身（描画・編集・矛盾検出・指摘一覧）はDBに依存しないため、
// 認証とSupabaseを介さずにブラウザ上の実挙動を検証できるようにする。
// これがないとE2Eはログイン画面より先に進めず、価値のある部分を一切触れない。
//
// 本番では 404 を返す。E2E_FIXTURES=1 を明示的に設定した環境でのみ有効。
// ============================================================================

export const dynamic = 'force-dynamic'

export default function E2EFixturePage() {
  if (process.env.E2E_FIXTURES !== '1') {
    notFound()
  }
  return <E2EFixtureClient />
}
