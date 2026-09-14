import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import { LiveEdit, LiveEditDraft, pruneLiveEdits, LIVE_EDIT_TTL_MS } from '../utils/liveEdits'

// ============================================================================
// 同じ案件を開いている人どうしの、保存を伴わないやり取り。
//
//   在席（presence） … 誰が開いているか、いま誰がどの人物を編集中か
//   下書き（broadcast）… 入力中・ドラッグ中の値をその場で流す
//
// どちらもDBを経由しない。保存はこれとは別に、従来どおり行われる。
// DBを通すと「手を止めてから1〜2秒後」になるため、その場で見せるには別の経路が要る。
// ============================================================================

export interface ProjectEditor {
  userId: string
  label: string
  canEdit: boolean
  /** いま編集ダイアログを開いている人物のid */
  editingPersonId: string | null
}

export interface CollaborationSelf {
  userId: string
  label: string
  canEdit: boolean
}

interface PresencePayload extends CollaborationSelf {
  editingPersonId: string | null
}

interface LiveEditMessage {
  personId: string
  userId: string
  label: string
  draft?: LiveEditDraft
  position?: { x: number; y: number }
  /** 編集・ドラッグを終えたとき。受け取り側は下書きを消す */
  done?: boolean
}

/** 送信の間隔。詰めすぎると通信が増え、空けすぎると「その場で見える」感じが薄れる */
const BROADCAST_INTERVAL_MS = 120

export interface UseProjectCollaborationReturn {
  /** 自分以外の在席者 */
  editors: ProjectEditor[]
  /** 保存前の下書き（人物id → 内容） */
  liveEdits: Map<string, LiveEdit>
  /** 入力中・ドラッグ中の値を流す。同じ人物への連続送信は間引かれる */
  publishLiveEdit: (
    personId: string,
    payload: { draft?: LiveEditDraft; position?: { x: number; y: number } }
  ) => void
  /** 編集・ドラッグの終了を知らせ、下書きを消す */
  finishLiveEdit: (personId: string) => void
  /** いま自分が編集している人物を知らせる（他の人のカードに表示される） */
  setEditingPersonId: (personId: string | null) => void
}

export function useProjectCollaboration(
  projectId: string,
  me: CollaborationSelf | null
): UseProjectCollaborationReturn {
  const [editors, setEditors] = useState<ProjectEditor[]>([])
  const [liveEdits, setLiveEdits] = useState<Map<string, LiveEdit>>(new Map())

  const channelRef = useRef<RealtimeChannel | null>(null)
  const editingPersonIdRef = useRef<string | null>(null)
  const lastSentAtRef = useRef<Map<string, number>>(new Map())
  const pendingRef = useRef<Map<string, LiveEditMessage>>(new Map())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!projectId || !me) return

    const supabase = getSupabaseBrowserClient()
    const channel = supabase.channel(`collab:project:${projectId}`, {
      config: { presence: { key: me.userId }, broadcast: { self: false } },
    })
    channelRef.current = channel

    const syncPresence = () => {
      const state = channel.presenceState<PresencePayload>()
      const others = new Map<string, ProjectEditor>()
      for (const [key, entries] of Object.entries(state)) {
        if (key === me.userId) continue
        const entry = entries[0]
        if (!entry) continue
        others.set(entry.userId ?? key, {
          userId: entry.userId ?? key,
          label: entry.label ?? '不明な利用者',
          canEdit: entry.canEdit ?? false,
          editingPersonId: entry.editingPersonId ?? null,
        })
      }
      setEditors([...others.values()])

      // 退出した人の下書きは残さない
      setLiveEdits(prev => {
        if (prev.size === 0) return prev
        const next = new Map<string, LiveEdit>()
        prev.forEach((edit, key) => {
          if (others.has(edit.userId)) next.set(key, edit)
        })
        return next.size === prev.size ? prev : next
      })
    }

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .on('broadcast', { event: 'live_edit' }, ({ payload }) => {
        const message = payload as LiveEditMessage
        if (!message?.personId || message.userId === me.userId) return

        setLiveEdits(prev => {
          const next = new Map(prev)
          if (message.done) {
            next.delete(message.personId)
            return next
          }
          const previous = next.get(message.personId)
          next.set(message.personId, {
            personId: message.personId,
            userId: message.userId,
            label: message.label,
            // 位置だけ・下書きだけの更新でも、もう片方は保つ
            draft: message.draft ?? previous?.draft,
            position: message.position ?? previous?.position,
            at: Date.now(),
          })
          return next
        })
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ ...me, editingPersonId: editingPersonIdRef.current })
        }
      })

    // 送信者が落ちた場合の保険。期限切れの下書きを掃除する
    const pruneTimer = setInterval(() => {
      setLiveEdits(prev => {
        const pruned = pruneLiveEdits(prev)
        return pruned.size === prev.size ? prev : pruned
      })
    }, LIVE_EDIT_TTL_MS / 2)

    return () => {
      clearInterval(pruneTimer)
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      channelRef.current = null
      supabase.removeChannel(channel)
    }
    // meはオブジェクトのため、中身が同じでも参照が変わると再購読になる。値で依存を張る
  }, [projectId, me?.userId, me?.label, me?.canEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((message: LiveEditMessage) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'live_edit', payload: message })
  }, [])

  /** 間引いた送信。保留分は必ずあとで流す（途中の値で止まったままにしない） */
  const flushPending = useCallback(() => {
    flushTimerRef.current = null
    const now = Date.now()
    pendingRef.current.forEach((message, personId) => {
      send(message)
      lastSentAtRef.current.set(personId, now)
    })
    pendingRef.current.clear()
  }, [send])

  const publishLiveEdit = useCallback<UseProjectCollaborationReturn['publishLiveEdit']>(
    (personId, payload) => {
      if (!me) return
      const message: LiveEditMessage = { personId, userId: me.userId, label: me.label, ...payload }

      const now = Date.now()
      const lastSentAt = lastSentAtRef.current.get(personId) ?? 0
      if (now - lastSentAt >= BROADCAST_INTERVAL_MS) {
        send(message)
        lastSentAtRef.current.set(personId, now)
        return
      }

      // 間隔内は最新の値だけを保持し、あとでまとめて流す
      pendingRef.current.set(personId, message)
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushPending, BROADCAST_INTERVAL_MS)
      }
    },
    [me, send, flushPending]
  )

  const finishLiveEdit = useCallback(
    (personId: string) => {
      if (!me) return
      pendingRef.current.delete(personId)
      lastSentAtRef.current.delete(personId)
      send({ personId, userId: me.userId, label: me.label, done: true })
    },
    [me, send]
  )

  const setEditingPersonId = useCallback(
    (personId: string | null) => {
      editingPersonIdRef.current = personId
      if (!me) return
      void channelRef.current?.track({ ...me, editingPersonId: personId })
    },
    [me]
  )

  return useMemo(
    () => ({ editors, liveEdits, publishLiveEdit, finishLiveEdit, setEditingPersonId }),
    [editors, liveEdits, publishLiveEdit, finishLiveEdit, setEditingPersonId]
  )
}
