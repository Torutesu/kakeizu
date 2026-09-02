"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Upload,
  Save,
  Download,
  Search,
  Edit3,
  Plus,
  Trash2,
  Undo,
  Redo,
  Users,
  GitBranch,
  Settings,
  ArrowLeft,
  Eye,
  RefreshCw,
  PanelLeft,
  PanelRight,
  X,
  Keyboard,
} from "lucide-react"

import { FamilyTree, FocusPersonRequest } from "./FamilyTree"
import { PersonEditDialog } from "./PersonEditDialog"
import { RelationshipEditDialog } from "./RelationshipEditDialog"
import { AddPersonDialog } from "./AddPersonDialog"
import { KosekiUploadDialog } from "./KosekiUploadDialog"
import { KosekiFilesPanel } from "./KosekiFilesPanel"
import { SettingsDialog } from "./SettingsDialog"
import { useFamilyData, SaveStatus } from "../hooks/useFamilyData"
import { useZoomSettings } from "../hooks/useZoomSettings"
import { useKosekiFiles } from "../hooks/useKosekiFiles"
import { useConfirm } from "../hooks/useConfirm"
import { ShortcutHelpDialog } from "./ShortcutHelpDialog"
import { fetchProject, ProjectSummary } from "../lib/db/projects"
import { ProcessedPerson, searchPersons, FamilyTreeData, isValidFamilyTreeData } from "../utils/familyDataProcessor"
import { formatKazoeAge } from "../utils/age"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UI_CONFIG } from "../constants/config"

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  saved: '保存済み',
  saving: '保存中...',
  conflict: '競合が発生しました',
  error: '保存エラー',
}

// キーボードショートカットをテキスト入力中に発火させないためのガード
// （Input内のCmd+Zは文字入力の取り消しであって、家系図のアンドゥではない）
function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

interface FamilyTreeAppProps {
  projectId: string
}

export default function FamilyTreeApp({ projectId }: FamilyTreeAppProps) {
  // データ管理フック
  const {
    persons,
    families,
    isLoading,
    error,
    saveStatus,
    canEdit,
    addPerson,
    updatePerson,
    deletePerson,
    addFamily,
    updateFamily,
    deleteFamily,
    importFamilyTreeData,
    exportFamilyTreeData,
    saveNow,
    canUndo,
    canRedo,
    undo,
    redo,
    refreshData
  } = useFamilyData(projectId)

  // 案件情報（表示名と、監査ログに必要な組織ID）
  const [project, setProject] = useState<ProjectSummary | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchProject(projectId)
      .then(fetched => {
        if (!cancelled && fetched) setProject(fetched)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

  // 案件に保存された戸籍ファイル
  const {
    files: kosekiFiles,
    isLoading: isLoadingKosekiFiles,
    refresh: refreshKosekiFiles,
    remove: removeKosekiFile,
  } = useKosekiFiles(projectId, project?.orgId ?? '')

  // 競合発生時は一度だけ通知する
  const conflictNotifiedRef = useRef(false)
  useEffect(() => {
    if (saveStatus === 'conflict' && !conflictNotifiedRef.current) {
      conflictNotifiedRef.current = true
      toast.error('他のユーザーが先に保存しました。「再読み込み」で最新の状態を取得してください。')
    }
    if (saveStatus !== 'conflict') {
      conflictNotifiedRef.current = false
    }
  }, [saveStatus])

  // ズーム・ピンチ感度の設定
  const {
    zoomSettings,
    setWheelSensitivity,
    setButtonZoomStep,
    setAlwaysShowGenerationGuides,
    resetZoomSettings
  } = useZoomSettings()

  // UI状態管理
  // 選択はIDで保持し、表示用の人物データは常に最新のpersonsから引く。
  // （人物オブジェクトを直接保持すると、編集・アンドゥ後にサイドバーの表示が古いままになる）
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const selectedPerson = selectedPersonId
    ? persons.find(p => p.id === selectedPersonId) ?? null
    : null

  const [searchQuery, setSearchQuery] = useState("")
  const [focusPerson, setFocusPerson] = useState<FocusPersonRequest | null>(null)
  const focusRequestCounter = useRef(0)
  const loadFileInputRef = useRef<HTMLInputElement>(null)

  // 編集ダイアログの状態
  const [isPersonEditOpen, setIsPersonEditOpen] = useState(false)
  const [isRelationshipEditOpen, setIsRelationshipEditOpen] = useState(false)
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false)
  const [isKosekiUploadOpen, setIsKosekiUploadOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false)

  // 画面が狭いときのサイドバー開閉（広い画面では常時表示）
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)

  // 確認ダイアログ（ブラウザ標準のconfirmを使わない）
  const { confirm, confirmDialog } = useConfirm()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // キーボードショートカット（一覧は「?」キーのヘルプで確認できる）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = e.metaKey || e.ctrlKey

      // 検索はテキスト入力中でも開けるようにする（ブラウザ既定の検索を置き換える）
      if (modifier && e.key === 'k') {
        e.preventDefault()
        setIsRightPanelOpen(true)
        // パネルの表示を待ってからフォーカスする
        requestAnimationFrame(() => searchInputRef.current?.focus())
        return
      }

      if (isTextInputTarget(e.target)) return

      // Escで選択解除・パネルを閉じる（閲覧のみでも有効）
      if (e.key === 'Escape') {
        setSelectedPersonId(null)
        setIsLeftPanelOpen(false)
        setIsRightPanelOpen(false)
        return
      }

      // ショートカット一覧
      if (e.key === '?') {
        e.preventDefault()
        setIsShortcutHelpOpen(true)
        return
      }

      // 全体表示（キャンバス側で処理するためイベントを送る）
      if (e.key === 'f' && !modifier) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('family-tree:fit-to-view'))
        return
      }

      if (!canEdit) return

      // Command+Z (Mac) または Ctrl+Z (Windows/Linux) でアンドゥ
      if (modifier && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo) undo()
        return
      }

      // Command+Shift+Z (Mac) または Ctrl+Y (Windows/Linux) でリドゥ
      if ((modifier && e.key === 'z' && e.shiftKey) || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault()
        if (canRedo) redo()
        return
      }

      // 保存
      if (modifier && e.key === 's') {
        e.preventDefault()
        void handleManualSave()
        return
      }

      if (modifier) return

      // 単独キーの操作
      if (e.key === 'n') {
        e.preventDefault()
        setIsAddPersonOpen(true)
      } else if (e.key === 'e' && selectedPersonId) {
        e.preventDefault()
        setIsPersonEditOpen(true)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPersonId) {
        e.preventDefault()
        void handleDeleteSelectedPerson()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, undo, redo, canEdit, selectedPersonId])

  // 人物選択ハンドラー
  const handlePersonSelect = useCallback((person: ProcessedPerson) => {
    setSelectedPersonId(person.id)
  }, [])

  // ダブルクリックで選択＋編集ダイアログを開く
  const handlePersonEdit = useCallback((person: ProcessedPerson) => {
    setSelectedPersonId(person.id)
    setIsPersonEditOpen(true)
  }, [])

  // 検索結果クリック: 選択した上で、その人物へ画面をパンする
  const handleSearchResultSelect = useCallback((person: ProcessedPerson) => {
    setSelectedPersonId(person.id)
    focusRequestCounter.current += 1
    setFocusPerson({ id: person.id, requestId: focusRequestCounter.current })
  }, [])

  // 人物位置更新ハンドラー（ドラッグ確定時に位置・世代をまとめて1つのUndo単位で反映）
  const handlePersonPositionUpdate = useCallback((id: string, x: number, y: number, generation: number) => {
    if (!canEdit) return
    updatePerson(id, { x, y, generation, manualPosition: true })
  }, [updatePerson, canEdit])

  // 戸籍データ抽出ハンドラー（名寄せ付きマージ: 複数書類間の同一人物は単一ノードに統合される）
  const handleKosekiDataExtracted = (data: FamilyTreeData) => {
    const { mergedPersonCount, addedPersonCount } = importFamilyTreeData(data, 'merge')
    toast.success(
      mergedPersonCount > 0
        ? `戸籍データを取り込みました（追加${addedPersonCount}人・既存と統合${mergedPersonCount}人）`
        : `戸籍データを取り込みました（${addedPersonCount}人）`
    )
  }

  // 選択中の人物を削除（確認あり）
  const handleDeleteSelectedPerson = useCallback(async () => {
    if (!canEdit || !selectedPerson) return
    const confirmed = await confirm({
      title: `${selectedPerson.displayName}を削除しますか？`,
      description: 'この人物と、関係する家族のつながりも削除されます。元に戻す（Cmd+Z）で取り消せます。',
      confirmLabel: '削除する',
      destructive: true,
    })
    if (!confirmed) return
    deletePerson(selectedPerson.id)
    setSelectedPersonId(null)
    toast.success('人物を削除しました')
  }, [canEdit, selectedPerson, confirm, deletePerson])

  // 手動保存ハンドラー
  const handleManualSave = async () => {
    await saveNow()
    toast.success('保存しました')
  }

  // 書き出しファイル名のベース（案件名_日付）
  const exportBaseName = () =>
    `${project?.name || 'family-tree'}_${new Date().toISOString().slice(0, 10)}`

  // JSON書き出し（再インポート用の完全なデータ）
  const handleExportJson = () => {
    const data = exportFamilyTreeData()
    const jsonString = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportBaseName()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('JSONファイルを書き出しました')
  }

  // Excel書き出し（人物一覧・家族関係の2シート）
  // 生成ライブラリはサイズが大きいため、実行時に動的読み込みする
  const handleExportExcel = async () => {
    try {
      const { exportExcelFile } = await import("../utils/exportExcel")
      exportExcelFile(persons, families, exportBaseName())
      toast.success('Excelファイルを書き出しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Excel書き出しに失敗しました')
    }
  }

  // PDF書き出し（家系図をA4に描画）
  const handleExportPdf = async () => {
    try {
      const { exportTreePdf } = await import("../utils/exportPdf")
      await exportTreePdf(persons, families, project?.name || '家系図', exportBaseName())
      toast.success('PDFファイルを書き出しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF書き出しに失敗しました')
    }
  }

  // JSON読み込みハンドラー
  const handleLoadFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!isValidFamilyTreeData(data)) {
        toast.error('不正なファイル形式です（people/families配列が必要です）')
        return
      }

      const shouldReplace = await confirm({
        title: '読み込み方法を選んでください',
        description:
          `${data.people.length}人分のデータを読み込みます。\n\n` +
          '「置き換える」: 現在の家系図を消して、ファイルの内容にします。\n' +
          '「追加でマージ」: 同じ人物は統合し、新しい人物だけ追加します。',
        confirmLabel: '置き換える',
        cancelLabel: '追加でマージ',
      })
      const { mergedPersonCount, addedPersonCount } = importFamilyTreeData(
        data,
        shouldReplace ? 'replace' : 'merge'
      )
      toast.success(
        mergedPersonCount > 0
          ? `ファイルを読み込みました（追加${addedPersonCount}人・既存と統合${mergedPersonCount}人）`
          : `ファイルを読み込みました（${addedPersonCount}人）`
      )
    } catch (err) {
      toast.error(`読み込みエラー: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // 検索結果
  const searchResults = searchQuery.trim()
    ? searchPersons(persons, searchQuery)
    : []

  // ローディング状態
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">家系図データを読み込み中...</p>
        </div>
      </div>
    )
  }

  // エラー状態
  if (error) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">データの読み込みに失敗しました</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={refreshData}>
            再試行
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/projects">
              <Button variant="ghost" size="sm" title="案件一覧に戻る">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              title="資料パネルを開く"
              onClick={() => setIsLeftPanelOpen(true)}
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-xl font-bold text-gray-900 truncate">
              {project?.name || '家系図'}
            </h1>
            {canEdit ? (
              <span
                className={`text-sm whitespace-nowrap ${
                  saveStatus === 'conflict' || saveStatus === 'error'
                    ? 'text-red-600 font-medium'
                    : 'text-gray-400'
                }`}
              >
                {SAVE_STATUS_LABELS[saveStatus]}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-gray-400 whitespace-nowrap">
                <Eye className="w-4 h-4" />
                閲覧のみ
              </span>
            )}
            {saveStatus === 'conflict' && (
              <Button variant="outline" size="sm" onClick={refreshData}>
                <RefreshCw className="w-4 h-4 mr-1" />
                再読み込み
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {canEdit && (
              <>
                {/* アンドゥ・リドゥボタン */}
                <div className="flex items-center gap-1 border-r border-gray-200 pr-3 mr-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={undo}
                    disabled={!canUndo}
                    title="元に戻す (Cmd+Z)"
                  >
                    <Undo className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={redo}
                    disabled={!canRedo}
                    title="やり直し (Cmd+Shift+Z)"
                  >
                    <Redo className="w-4 h-4" />
                  </Button>
                </div>

                <Button variant="outline" size="sm" onClick={handleManualSave}>
                  <Save className="w-4 h-4 mr-2" />
                  保存
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadFileInputRef.current?.click()}>
                  <Download className="w-4 h-4 mr-2" />
                  読み込み
                </Button>
                <input
                  ref={loadFileInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={handleLoadFileSelected}
                />
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Upload className="w-4 h-4 mr-2" />
                  書き出し
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportPdf}>
                  PDF（家系図を印刷用に）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel}>
                  Excel（人物・家族の一覧表）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportJson}>
                  JSON（再インポート用データ）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsShortcutHelpOpen(true)}
              title="キーボードショートカット (?)"
            >
              <Keyboard className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSettingsOpen(true)}
              title="設定（ズーム・ピンチ感度など）"
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              title="人物パネルを開く"
              onClick={() => setIsRightPanelOpen(true)}
            >
              <PanelRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左サイドバー */}
        {/* 画面が狭いときのドロワー用の背景 */}
        {(isLeftPanelOpen || isRightPanelOpen) && (
          <div
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={() => { setIsLeftPanelOpen(false); setIsRightPanelOpen(false) }}
            aria-hidden="true"
          />
        )}

        <aside
          style={{ width: UI_CONFIG.leftSidebarWidth }}
          className={`bg-white border-r border-gray-200 flex flex-col overflow-y-auto
            max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:shadow-xl max-lg:transition-transform
            ${isLeftPanelOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 lg:hidden">
            <span className="text-sm font-medium text-gray-900">資料</span>
            <Button variant="ghost" size="sm" onClick={() => setIsLeftPanelOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          {canEdit && (
            <div className="p-6 border-b border-gray-200">
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
                onClick={() => setIsKosekiUploadOpen(true)}
              >
                <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <p className="text-lg font-medium text-gray-900 mb-2">戸籍PDFをアップロード</p>
                <p className="text-sm text-gray-500">
                  戸籍謄本PDFをAIで解析
                  <br />
                  クリックして開始
                </p>
              </div>
            </div>
          )}

          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-gray-900">データ状況</span>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-800">
                <Users className="w-4 h-4 text-green-600" />
                <span>{persons.length}人の人物</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-green-800">
                <GitBranch className="w-4 h-4 text-green-600" />
                <span>{families.length}件の家族関係</span>
              </div>
            </div>
          </div>

          <KosekiFilesPanel
            projectId={projectId}
            files={kosekiFiles}
            isLoading={isLoadingKosekiFiles}
            canEdit={canEdit}
            onRemove={removeKosekiFile}
            onRefresh={refreshKosekiFiles}
            onDataExtracted={handleKosekiDataExtracted}
          />

          <div className="p-6">
            <h3 className="text-sm font-medium text-gray-900 mb-3">使い方</h3>
            <div className="space-y-3 text-sm text-gray-600">
              <p>・上の「戸籍PDFをアップロード」から戸籍謄本PDFを解析して家系図に取り込めます。</p>
              <p>・編集内容は自動的にサーバーへ保存されます（「保存」ボタンで即時保存も可能）。</p>
              <p>・「書き出し」で家系図をJSONファイルとしてダウンロードし、「読み込み」で再度読み込めます。</p>
              <p>・図の上でドラッグして配置を調整、右側のパネルで人物情報や関係を編集できます。</p>
            </div>
          </div>
        </aside>

        {/* 中央エリア - 家系図描画エリア */}
        <main className="flex-1 relative bg-gray-100">
          <FamilyTree
            persons={persons}
            families={families}
            selectedPerson={selectedPerson}
            onPersonSelect={handlePersonSelect}
            onPersonEdit={canEdit ? handlePersonEdit : undefined}
            onPersonPositionUpdate={handlePersonPositionUpdate}
            focusPerson={focusPerson}
            zoomSettings={zoomSettings}
            onAddPerson={canEdit ? () => setIsAddPersonOpen(true) : undefined}
            onUploadKoseki={canEdit ? () => setIsKosekiUploadOpen(true) : undefined}
          />
        </main>

        {/* 右サイドバー - 情報表示・検索 */}
        <aside
          style={{ width: UI_CONFIG.rightSidebarWidth }}
          className={`bg-white border-l border-gray-200 flex flex-col
            max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-xl max-lg:transition-transform
            ${isRightPanelOpen ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full'}`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 lg:hidden">
            <span className="text-sm font-medium text-gray-900">人物</span>
            <Button variant="ghost" size="sm" onClick={() => setIsRightPanelOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* 検索機能 */}
          <div className="p-6 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                ref={searchInputRef}
                placeholder="人物を検索... (Cmd+K)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* 検索結果 */}
            {searchQuery.trim() && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  検索結果 ({searchResults.length}件)
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {searchResults.map((person) => (
                    <div
                      key={person.id}
                      className="p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"
                      onClick={() => {
                        handleSearchResultSelect(person)
                        setIsRightPanelOpen(false)
                      }}
                    >
                      <div className="text-sm font-medium">{person.displayName}</div>
                      <div className="text-xs text-gray-500">第{person.generation}世代</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 人物追加ボタン */}
          {canEdit && (
            <div className="px-6 py-4 border-b border-gray-200">
              <Button
                onClick={() => setIsAddPersonOpen(true)}
                className="w-full"
                variant="outline"
              >
                <Plus className="w-4 h-4 mr-2" />
                新しい人物を追加
              </Button>
            </div>
          )}

          {/* 選択中ノードの情報表示 */}
          <div className="flex-1 p-6 overflow-hidden">
            {selectedPerson ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">人物情報</h3>
                  {canEdit && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsPersonEditOpen(true)}
                      >
                        <Edit3 className="w-4 h-4 mr-1" />
                        編集
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsRelationshipEditOpen(true)}
                      >
                        関係編集
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        title="削除 (Delete)"
                        onClick={handleDeleteSelectedPerson}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <ScrollArea className="flex-1">
                  <div className="space-y-4 pr-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700">姓</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.name.surname}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">名</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.name.given_name}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700">生年月日</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.birth?.date || '不明'}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700">没年月日</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.death?.date || '存命'}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700">世代</label>
                      <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                        第{selectedPerson.generation}世代
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700">性別</label>
                      <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                        {selectedPerson.sex === 'male' ? '男性' : selectedPerson.sex === 'female' ? '女性' : '不明'}
                      </div>
                    </div>

                    {formatKazoeAge(selectedPerson.birth?.date, selectedPerson.death?.date) && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">年齢（数え）</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {formatKazoeAge(selectedPerson.birth?.date, selectedPerson.death?.date)}
                        </div>
                      </div>
                    )}

                    {selectedPerson.relation_to_family_head && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">続柄（戸籍上の表記）</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.relation_to_family_head}
                        </div>
                      </div>
                    )}

                    {selectedPerson.birth?.place && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">出生地</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.birth.place}
                        </div>
                      </div>
                    )}

                    {selectedPerson.death?.place && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">没地</label>
                        <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm">
                          {selectedPerson.death.place}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Search className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>人物を選択してください</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* 編集ダイアログ */}
      <PersonEditDialog
        person={selectedPerson}
        isOpen={isPersonEditOpen}
        onClose={() => setIsPersonEditOpen(false)}
        onSave={(personId, updates) => {
          // selectedPersonはpersonsから導出しているため、更新すれば表示も自動で追従する
          updatePerson(personId, updates)
        }}
        availablePersons={persons}
      />

      <RelationshipEditDialog
        person={selectedPerson}
        isOpen={isRelationshipEditOpen}
        onClose={() => setIsRelationshipEditOpen(false)}
        availablePersons={persons}
        families={families}
        onAddFamily={addFamily}
        onUpdateFamily={updateFamily}
        onDeleteFamily={deleteFamily}
      />

      <AddPersonDialog
        isOpen={isAddPersonOpen}
        onClose={() => setIsAddPersonOpen(false)}
        onAdd={(personData) => {
          addPerson(personData)
        }}
      />

      <KosekiUploadDialog
        orgId={project?.orgId ?? ''}
        projectId={projectId}
        isOpen={isKosekiUploadOpen}
        onClose={() => setIsKosekiUploadOpen(false)}
        onDataExtracted={handleKosekiDataExtracted}
        onFilesChanged={refreshKosekiFiles}
      />

      <ShortcutHelpDialog
        isOpen={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
        canEdit={canEdit}
      />

      {confirmDialog}

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        zoomSettings={zoomSettings}
        onWheelSensitivityChange={setWheelSensitivity}
        onButtonZoomStepChange={setButtonZoomStep}
        onAlwaysShowGenerationGuidesChange={setAlwaysShowGenerationGuides}
        onReset={resetZoomSettings}
      />
    </div>
  )
}
