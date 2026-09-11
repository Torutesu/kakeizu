'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

interface ShortcutHelpDialogProps {
  isOpen: boolean
  onClose: () => void
  canEdit: boolean
}

const KEY_STYLE =
  'inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded border border-gray-300 bg-gray-50 text-[11px] font-medium text-gray-700'

/** Macかどうかで修飾キーの表記を変える（表示のみ。動作は両対応） */
function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

export function ShortcutHelpDialog({ isOpen, onClose, canEdit }: ShortcutHelpDialogProps) {
  const mac = isMacLike()
  const mod = mac ? '⌘' : 'Ctrl'

  const shortcuts: Array<{ keys: string[]; description: string; editOnly?: boolean }> = [
    { keys: [mod, 'K'], description: '人物を検索' },
    { keys: ['F'], description: '家系図全体を表示' },
    { keys: ['Esc'], description: '選択を解除・ダイアログを閉じる' },
    { keys: [mod, 'Z'], description: '元に戻す', editOnly: true },
    { keys: mac ? [mod, '⇧', 'Z'] : ['Ctrl', 'Y'], description: 'やり直し', editOnly: true },
    { keys: [mod, 'S'], description: '保存', editOnly: true },
    { keys: ['N'], description: '新しい人物を追加', editOnly: true },
    { keys: ['E'], description: '選択中の人物を編集', editOnly: true },
    { keys: [mac ? 'Delete' : 'Del'], description: '選択中の人物を削除（Backspaceも可）', editOnly: true },
    { keys: ['?'], description: 'このヘルプを表示' },
  ]

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>キーボードショートカット</DialogTitle>
          <DialogDescription>
            文字を入力しているときはショートカットは動作しません。
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-gray-100">
          {shortcuts
            .filter(shortcut => canEdit || !shortcut.editOnly)
            .map(shortcut => (
              <div key={shortcut.description} className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-700">{shortcut.description}</span>
                <span className="flex items-center gap-1">
                  {shortcut.keys.map(key => (
                    <kbd key={key} className={KEY_STYLE}>{key}</kbd>
                  ))}
                </span>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
