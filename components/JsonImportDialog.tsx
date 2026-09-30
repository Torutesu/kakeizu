'use client'

import React, { useState } from 'react'
import { GitMerge, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'

/** 閉じる操作と「追加」を区別し、確認を取り消したときはデータを変更しない。 */
export function JsonImportDialog({ count, onImport, onClose }: {
  count: number
  onImport: (mode: 'merge' | 'replace') => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="max-w-[720px]">
      <DialogHeader><DialogTitle>読み込み方法を選んでください</DialogTitle><DialogDescription>{count}人分のデータを読み込みます。現在の家系図への反映方法を選んでください。</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2" role="group" aria-label="読み込み方法">
        {([
          { value: 'merge', label: '追加でマージ', description: '同じ人物は統合し、新しい人物を追加します。', Icon: GitMerge },
          { value: 'replace', label: '置き換える', description: '現在の家系図を消して、ファイルの内容にします。', Icon: RefreshCw },
        ] as const).map(({ value, label, description, Icon }) => <button key={value} type="button" aria-pressed={mode === value} data-import-mode={value} onClick={() => setMode(value)} className={`rounded-xl border p-5 text-left focus-visible:outline-primary ${mode === value ? 'border-primary bg-secondary' : 'border-border'}`}>
          <Icon size={24} className="mb-4 text-primary" /><span className="block font-bold">{label}</span><span className="mt-2 block text-sm text-muted-foreground">{description}</span>
        </button>)}
      </div>
      {mode === 'replace' && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">現在の家系図を残したい場合は、先にJSONで書き出してバックアップしてください。</p>}
      <DialogFooter><Button variant="outline" onClick={onClose}>キャンセル</Button><Button data-confirm-import onClick={() => onImport(mode)}>読み込む</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
