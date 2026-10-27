import { notFound } from 'next/navigation'
import { E2EEditorFixtureClient } from './E2EEditorFixtureClient'

// E2Eテスト用の編集画面（2通の戸籍を統合した家系図）。
// 本番では 404 を返す。E2E_FIXTURES=1 を明示的に設定した環境でのみ有効。
export const dynamic = 'force-dynamic'

export default function E2EEditorFixturePage() {
  if (process.env.E2E_FIXTURES !== '1') {
    notFound()
  }
  return <E2EEditorFixtureClient />
}
