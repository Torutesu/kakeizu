import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabase/client'

export interface ProjectEditor {
  userId: string
  /** 画面に出す名前。表示名が無ければメールアドレスの@より前を使う */
  label: string
  /** 編集権限があるか。閲覧のみの人は「編集中」ではない */
  canEdit: boolean
}

interface PresencePayload {
  userId: string
  label: string
  canEdit: boolean
}

/**
 * いま同じ案件を開いている利用者を返す（要件v1.1 4.5「編集している利用者がわかること」）。
 *
 * 自分自身は含めない。接続が切れた利用者は、Supabase側で自動的に一覧から外れる
 * （明示的な退出処理に頼ると、タブを閉じた・回線が切れた場合に残り続けてしまう）。
 */
export function useProjectPresence(
  projectId: string,
  me: PresencePayload | null
): ProjectEditor[] {
  const [editors, setEditors] = useState<ProjectEditor[]>([])

  useEffect(() => {
    if (!projectId || !me) return

    const supabase = getSupabaseBrowserClient()
    const channel = supabase.channel(`presence:project:${projectId}`, {
      config: { presence: { key: me.userId } },
    })

    const sync = () => {
      const state = channel.presenceState<PresencePayload>()
      const others: ProjectEditor[] = []
      for (const [key, entries] of Object.entries(state)) {
        if (key === me.userId) continue
        const entry = entries[0]
        if (!entry) continue
        others.push({
          userId: entry.userId ?? key,
          label: entry.label ?? '不明な利用者',
          canEdit: entry.canEdit ?? false,
        })
      }
      // 同じ人が複数のタブで開いていても1人として見せる
      const unique = new Map(others.map(editor => [editor.userId, editor]))
      setEditors([...unique.values()])
    }

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') channel.track(me)
      })

    return () => {
      supabase.removeChannel(channel)
    }
    // meはオブジェクトのため、中身が同じでも参照が変わると再購読になる。値で依存を張る
  }, [projectId, me?.userId, me?.label, me?.canEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  return editors
}
