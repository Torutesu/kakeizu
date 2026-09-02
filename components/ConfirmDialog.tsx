'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'

export interface ConfirmOptions {
  title: string
  description?: string
  /** 実行ボタンの文言（既定: 「実行」） */
  confirmLabel?: string
  cancelLabel?: string
  /** 削除など取り返しのつかない操作は destructive にする */
  destructive?: boolean
}

interface ConfirmDialogProps extends ConfirmOptions {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * ブラウザ標準の confirm() の代わりに使う確認ダイアログ。
 * 見た目がアプリと揃い、モバイルでも扱いやすい。
 */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = '実行',
  cancelLabel = 'キャンセル',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className="whitespace-pre-line">{description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
