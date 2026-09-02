'use client'

import { useCallback, useState } from 'react'
import { ConfirmDialog, ConfirmOptions } from '../components/ConfirmDialog'

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

/**
 * confirm() をアプリ内ダイアログで置き換えるためのフック。
 * `const confirmed = await confirm({ title: '削除しますか' })` のように使い、
 * 返り値の要素を画面のどこかに描画する。
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setPending({ ...options, resolve })
    })
  }, [])

  const settle = useCallback((confirmed: boolean) => {
    setPending(current => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  const dialog = pending ? (
    <ConfirmDialog
      isOpen
      title={pending.title}
      description={pending.description}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      destructive={pending.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, confirmDialog: dialog }
}
