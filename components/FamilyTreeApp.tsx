"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Upload,
  Save,
  Download,
  Search,
  Edit3,
  Plus,
  Trash2,
  Merge,
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
import { MergePersonsDialog } from "./MergePersonsDialog"
import { SettingsDialog } from "./SettingsDialog"
import { useFamilyData, SaveStatus } from "../hooks/useFamilyData"
import { useZoomSettings } from "../hooks/useZoomSettings"
import { useKosekiFiles } from "../hooks/useKosekiFiles"
import { KosekiFile, createKosekiFileUrl, canOpenKosekiFile } from "../lib/db/kosekiFiles"
import { fetchOrgContext, OrgContext } from "../lib/db/org"
import { useProjectCollaboration } from "../hooks/useProjectCollaboration"
import { useConfirm } from "../hooks/useConfirm"
import { ShortcutHelpDialog } from "./ShortcutHelpDialog"
import { IssuesPanel } from "./IssuesPanel"
import { RegistriesPanel } from "./RegistriesPanel"
import { JsonImportDialog } from "./JsonImportDialog"
import { PdfExportDialog } from "./PdfExportDialog"
import { PdfExportOptions } from "../utils/pdfLayout"
import { measureTreePdf, buildTreeSvg } from "../utils/exportPdf"
import { fetchProject, ProjectSummary } from "../lib/db/projects"
import { UNREADABLE_FIELD_LABELS, ProcessedPerson, searchPersons, FamilyTreeData, isValidFamilyTreeData } from "../utils/familyDataProcessor"
import { formatKyonen } from "../utils/age"
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
  offline: 'オフライン（未送信）',
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
    issues,
    registries,
    isLoading,
    error,
    saveStatus,
    savedVersion,
    canEdit,
    addPerson,
    updatePerson,
    deletePerson,
    addFamily,
    updateFamily,
    deleteFamily,
    mergePersons,
    mergeCandidates,
    importFamilyTreeData,
    exportFamilyTreeData,
    saveNow,
    canUndo,
    canRedo,
    undo,
    redo,
    refreshData
  } = useFamilyData(projectId)

  // ログイン中の利用者と役割（保管期間の判定・同時編集の表示に使う）
  const [orgContext, setOrgContext] = useState<OrgContext | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchOrgContext()
      .then(ctx => { if (!cancelled) setOrgContext(ctx) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const isAdmin = orgContext?.role === 'admin'

  // 案件情報（表示名と、メンバー操作に必要な組織ID）
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

  // 保存できなかったときだけ一度通知する。
  // 同時編集そのものは通知しない（毎回出ると作業の邪魔になる）
  const saveErrorNotifiedRef = useRef(false)
  useEffect(() => {
    if (saveStatus === 'error' && !saveErrorNotifiedRef.current) {
      saveErrorNotifiedRef.current = true
      toast.error('保存に失敗しました。通信の状態をご確認のうえ、もう一度編集してください。')
    }
    if (saveStatus !== 'error') {
      saveErrorNotifiedRef.current = false
    }
  }, [saveStatus])

  // いま同じ案件を開いている利用者と、保存前の編集のやり取り（要件v1.1 4.5）
  const collaborator = useMemo(
    () =>
      orgContext
        ? {
            userId: orgContext.userId,
            label: orgContext.email.split('@')[0] || orgContext.email,
            canEdit,
          }
        : null,
    [orgContext, canEdit]
  )
  const {
    editors: otherEditors,
    liveEdits,
    publishLiveEdit,
    finishLiveEdit,
    setEditingPersonId,
  } = useProjectCollaboration(projectId, collaborator)

  // ドラッグ中の位置を流す（離したら消す）
  const handleLiveMove = useCallback(
    (personId: string, position: { x: number; y: number } | null) => {
      if (position) publishLiveEdit(personId, { position })
      else finishLiveEdit(personId)
    },
    [publishLiveEdit, finishLiveEdit]
  )


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
  const personPanelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    // 指摘・検索から別の人物へ移ったとき、前の人のスクロール位置を持ち越さない。
    if (personPanelRef.current) personPanelRef.current.scrollTop = 0
  }, [selectedPersonId])
  const selectedPerson = selectedPersonId
    ? persons.find(p => p.id === selectedPersonId) ?? null
    : null

  // 選択中の人物の出典（読み取り元の戸籍ファイル）
  const selectedPersonSources = useMemo(() => {
    const ids = selectedPerson?.source_file_ids ?? []
    return ids
      .map(id => kosekiFiles.find(file => file.id === id))
      .filter((file): file is KosekiFile => file !== undefined)
  }, [selectedPerson, kosekiFiles])

  const handleOpenSource = useCallback(async (file: KosekiFile) => {
    try {
      const url = await createKosekiFileUrl(file)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ファイルを開けませんでした')
    }
  }, [])

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

  // 編集ダイアログの開閉を、他の利用者へ知らせる
  useEffect(() => {
    if (!isPersonEditOpen || !selectedPersonId) {
      setEditingPersonId(null)
      return
    }
    setEditingPersonId(selectedPersonId)
    return () => setEditingPersonId(null)
  }, [isPersonEditOpen, selectedPersonId, setEditingPersonId])
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false)
  const [isMergePersonsOpen, setIsMergePersonsOpen] = useState(false)

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
  // 結果に合わせて伝える。未送信・失敗なのに「保存しました」と出すと、
  // 利用者は保存できたと思って閉じてしまう
  const handleManualSave = async () => {
    const status = await saveNow()
    if (status === 'saved') toast.success('保存しました')
    else if (status === 'offline') toast.info('通信がつながっていないため、端末に保持しました（つながると自動で送ります）')
    else if (status === 'error') toast.error('保存できませんでした。通信を確認して、もう一度お試しください')
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
      exportExcelFile(persons, families, exportBaseName(), registries)
      toast.success('Excelファイルを書き出しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Excel書き出しに失敗しました')
    }
  }

  // PDF書き出し。用紙と収め方はダイアログで選ぶ（大きい家系図は1枚だと読めなくなるため）
  const handleExportPdf = () => setIsPdfDialogOpen(true)

  const runPdfExport = async (options: PdfExportOptions) => {
    try {
      const { exportTreePdf } = await import("../utils/exportPdf")
      await exportTreePdf(persons, families, project?.name || '家系図', exportBaseName(), options)
      toast.success('PDFファイルを書き出しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF書き出しに失敗しました')
    }
  }

  // ダイアログでページ数・倍率を計算するため、実際の描画サイズを求める
  const pdfContentSize = useMemo(
    () => measureTreePdf(persons, families),
    [persons, families]
  )

  const pdfPreviewSvg = useMemo(
    () => isPdfDialogOpen ? buildTreeSvg(persons, families, project?.name || '家系図').svg : undefined,
    [isPdfDialogOpen, persons, families, project?.name]
  )

  const [pendingImport, setPendingImport] = useState<FamilyTreeData | null>(null)

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

      setPendingImport(data)
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
          <p className="text-muted-foreground">家系図データを読み込み中...</p>
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
          <h2 className="text-xl font-semibold text-foreground mb-2">データの読み込みに失敗しました</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={refreshData}>
            再試行
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace-shell h-dvh min-h-0 flex flex-col bg-muted">
      {/* ヘッダー */}
      {/* data-* は実機確認（docs/QA_CHECKLIST.md）を自動で流すための目印。
          表示は文言で行うが、文言はいつ変わってもよいものなので、
          確認する側はこちらを見る */}
      <header
        className="workspace-header bg-white border-b border-border px-4 sm:px-6 py-3"
        data-app-header
        data-save-status={saveStatus}
        data-save-version={savedVersion}
        data-can-edit={canEdit ? 'true' : 'false'}
        data-other-editors={otherEditors.length}
      >
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
            <h1 className="text-xl font-bold text-foreground truncate">
              {project?.name || '家系図'}
            </h1>
            {canEdit ? (
              <span
                className={`text-sm whitespace-nowrap ${
                  saveStatus === 'error'
                    ? 'text-red-600 font-medium'
                    : 'rounded bg-secondary px-2 py-1 text-xs text-primary'
                }`}
              >
                {SAVE_STATUS_LABELS[saveStatus]}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
                <Eye className="w-4 h-4" />
                閲覧のみ
              </span>
            )}
            {saveStatus === 'error' && (
              <Button variant="outline" size="sm" onClick={refreshData}>
                <RefreshCw className="w-4 h-4 mr-1" />
                再読み込み
              </Button>
            )}
            {saveStatus === 'offline' && (
              <span className="text-sm text-amber-700 whitespace-nowrap" title="通信が戻ると自動で送信します">
                未保存の変更を端末に保持しています
              </span>
            )}
            {otherEditors.length > 0 && (
              <span
                className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap"
                title={otherEditors
                  .map(editor => {
                    const target = editor.editingPersonId
                      ? persons.find(person => person.id === editor.editingPersonId)?.displayName
                      : null
                    if (target) return `${editor.label}（${target} を編集中）`
                    return `${editor.label}（${editor.canEdit ? '編集できます' : '閲覧のみ'}）`
                  })
                  .join('\n')}
              >
                <Users className="w-4 h-4 text-blue-500" />
                {otherEditors.length === 1
                  ? `${otherEditors[0].label}さんも開いています`
                  : `他${otherEditors.length}人が開いています`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* PDFダイアログへ移る際にメニューの操作ロックを残さない */}
            <DropdownMenu modal={false}>
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

      <div className="workspace-toolbar">
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="font-medium text-primary">家系図</span><span>人物 {persons.length}人 / 家族関係 {families.length}件</span></div>
        <div className="workspace-toolbar-actions">
            {canEdit && (
              <>
                {/* アンドゥ・リドゥボタン */}
                <div className="flex items-center gap-1 border-r border-border pr-3 mr-3">
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

          {canEdit && <Button size="sm" onClick={() => setIsAddPersonOpen(true)}><Plus size={16} />新しい人物を追加</Button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 flex overflow-hidden">
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
          className={`workspace-panel bg-white border-r border-border flex flex-col overflow-y-auto
            max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:shadow-xl max-lg:transition-transform
            ${isLeftPanelOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border lg:hidden">
            <span className="text-sm font-medium text-foreground">資料</span>
            <Button variant="ghost" size="sm" onClick={() => setIsLeftPanelOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="p-5">
            <h2 className="mb-5 flex items-center gap-2 text-base font-bold"><GitBranch size={18} />戸籍・資料 <span className="rounded bg-secondary px-2 text-xs text-primary">{kosekiFiles.length}</span></h2>
            {canEdit && <Button data-open-koseki-upload onClick={() => setIsKosekiUploadOpen(true)}><Upload size={16} />戸籍を取り込む</Button>}
            <p className="mt-4 text-xs leading-5 text-muted-foreground">PDF・画像を取り込み、人物と家族関係を読み取ります。</p>
          </div>

          <KosekiFilesPanel
            projectId={projectId}
            files={kosekiFiles}
            isLoading={isLoadingKosekiFiles}
            canEdit={canEdit}
            isAdmin={isAdmin}
            onRemove={removeKosekiFile}
            onRefresh={refreshKosekiFiles}
            onDataExtracted={handleKosekiDataExtracted}
          />


          <div className="p-5 text-xs leading-6 text-muted-foreground">
            <h3 className="mb-3 text-sm font-medium text-foreground">確認の進め方</h3>
            <ol className="list-inside list-decimal"><li>戸籍を取り込む</li><li>原文と読み取り結果を確認</li><li>人物・関係を整える</li><li>PDFなどに書き出す</li></ol>
            <p className="mt-5">編集内容は自動保存されます。同じ箇所を同時に直した場合は、あとからの保存が残ります。</p>
            <p className="mt-8">原本には保管期限があります。期限後も家系図は保持されます。</p>
          </div>
        </aside>

        {/* 中央エリア - 家系図描画エリア */}
        <main className="flex-1 min-w-0 relative bg-muted">
          <FamilyTree
            persons={persons}
            families={families}
            selectedPerson={selectedPerson}
            onPersonSelect={handlePersonSelect}
            onPersonEdit={canEdit ? handlePersonEdit : undefined}
            liveEdits={liveEdits}
            editors={otherEditors}
            onLiveMove={canEdit ? handleLiveMove : undefined}
            onPersonPositionUpdate={handlePersonPositionUpdate}
            focusPerson={focusPerson}
            zoomSettings={zoomSettings}
            onAddPerson={canEdit ? () => setIsAddPersonOpen(true) : undefined}
            onUploadKoseki={canEdit ? () => setIsKosekiUploadOpen(true) : undefined}
          />
        </main>

        {/* 右サイドバー - 情報表示・検索 */}
        <aside
          ref={personPanelRef}
          data-person-panel
          style={{ width: UI_CONFIG.rightSidebarWidth }}
          className={`workspace-panel workspace-panel-right bg-white border-l border-border flex flex-col
            max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-xl max-lg:transition-transform
            ${isRightPanelOpen ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full'}`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border lg:hidden">
            <span className="text-sm font-medium text-foreground">人物</span>
            <Button variant="ghost" size="sm" onClick={() => setIsRightPanelOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* 検索機能 */}
          <div className="shrink-0 p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  検索結果 ({searchResults.length}件)
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {searchResults.map((person) => (
                    <div
                      key={person.id}
                      className="p-2 border border-border rounded cursor-pointer hover:bg-muted"
                      onClick={() => {
                        handleSearchResultSelect(person)
                        setIsRightPanelOpen(true)
                      }}
                    >
                      <div className="text-sm font-medium">{person.displayName}</div>
                      <div className="text-xs text-muted-foreground">第{person.generation}世代</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {persons.some(person => person.unreadable?.length) && <div data-review-queue className="shrink-0 border-b bg-amber-50 px-4 py-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-amber-900">読み取り未完了 {persons.filter(person => person.unreadable?.length).length}人</p><Button data-review-next size="sm" variant="outline" onClick={() => {
            const pending = persons.filter(person => person.unreadable?.length)
            const index = pending.findIndex(person => person.id === selectedPersonId)
            handleSearchResultSelect(pending[(index + 1) % pending.length])
          }}>{selectedPerson?.unreadable?.length ? '次の人物' : '確認を始める'}</Button></div><p className="mt-1 text-xs text-amber-800">原本と照合し、読めなかった項目から修正できます。</p></div>}
          {/* 選択中ノードの情報表示 */}
          <div data-person-details className="shrink-0 border-b p-4">
            {selectedPerson ? (
              <div className="h-full flex flex-col">
                <div className="flex flex-col items-start gap-3 mb-4">
                  <div><p className="text-xs text-muted-foreground">人物情報</p><h3 data-person-detail-name className="mt-1 break-words text-lg font-semibold text-foreground">{selectedPerson.displayName}</h3></div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
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
                        variant="outline"
                        title="別人として残った同一人物を1人にまとめる"
                        onClick={() => setIsMergePersonsOpen(true)}
                      >
                        <Merge className="w-4 h-4 mr-1" />
                        統合
                        {mergeCandidates.length > 0 && (
                          <span className="ml-1 text-xs text-primary">
                            {mergeCandidates.length}
                          </span>
                        )}
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

                <div>
                  <div className="space-y-3">
                    {!!selectedPerson.unreadable?.length && <div data-person-unreadable className="rounded-lg border border-red-200 bg-red-50 p-3"><p className="text-sm font-semibold text-red-800">読み取れなかった項目</p><p className="mt-1 text-xs text-red-700">{selectedPerson.unreadable.map(key => UNREADABLE_FIELD_LABELS[key]).join('・')}</p>{canEdit && <Button data-review-edit size="sm" className="mt-2" onClick={() => setIsPersonEditOpen(true)}>原本を確認して修正</Button>}</div>}

                    <div data-person-vitals className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">生年月日</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {selectedPerson.unreadable?.includes('birth_date') ? '読み取り失敗' : selectedPerson.birth?.date || '記載なし'}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">没年月日</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {selectedPerson.unreadable?.includes('death_date') ? '読み取り失敗' : selectedPerson.death?.date || '記載なし'}
                        </div>
                      </div>
                    </div>

                    {selectedPersonSources.length > 0 && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">出典（読み取り元の書類）</label>
                        <div className="mt-1 space-y-1">
                          {selectedPersonSources.map(file => (
                            <button
                              key={file.id}
                              data-person-source={file.id}
                              type="button"
                              onClick={() => handleOpenSource(file)}
                              disabled={!canOpenKosekiFile(file, isAdmin)}
                              className="w-full text-left p-2 bg-muted border border-border rounded text-sm
                                         hover:bg-muted disabled:opacity-60 disabled:hover:bg-muted
                                         disabled:cursor-not-allowed truncate"
                              title={
                                canOpenKosekiFile(file, isAdmin)
                                  ? `${file.fileName} を開く`
                                  : '保管期間を過ぎているため開けません'
                              }
                            >
                              {file.fileName}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <details data-person-more><summary className="cursor-pointer py-2 text-sm font-medium text-primary">続柄・性別・原文などの詳細</summary><div className="space-y-3 pt-2">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">世代</label>
                      <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                        第{selectedPerson.generation}世代
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-muted-foreground">性別</label>
                      <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                        {selectedPerson.sex === 'male' ? '男性' : selectedPerson.sex === 'female' ? '女性' : '不明'}
                      </div>
                    </div>

                    {formatKyonen(selectedPerson.birth?.date, selectedPerson.death?.date) && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">享年</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {formatKyonen(selectedPerson.birth?.date, selectedPerson.death?.date)}
                        </div>
                      </div>
                    )}

                    {selectedPerson.name_original && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">氏名（戸籍の原文）</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {selectedPerson.name_original}
                        </div>
                      </div>
                    )}

                    {selectedPerson.relation_to_family_head && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">続柄（戸籍上の表記）</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {selectedPerson.relation_to_family_head}
                        </div>
                      </div>
                    )}

                    {selectedPerson.birth?.place && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">出生地</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {selectedPerson.birth.place}
                        </div>
                      </div>
                    )}

                    {selectedPerson.death?.place && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">没地</label>
                        <div className="mt-1 p-2 bg-muted border border-border rounded text-sm">
                          {selectedPerson.death.place}
                        </div>
                      </div>
                    )}
                    </div></details>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Search className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="font-medium">人物を選択してください</p><p className="mt-3 text-xs leading-6">家系図のカードを選ぶと、<br />人物情報や関係を確認できます。</p>
                </div>
              </div>
            )}
          </div>
          {/* 要確認の指摘一覧（論理矛盾・2モデル照合の食い違い） */}
          <IssuesPanel
            issues={issues}
            persons={persons}
            onFocusPerson={(person: ProcessedPerson) => {
              handleSearchResultSelect(person)
              setIsRightPanelOpen(true)
            }}
          />

          {/* 読み取った戸籍（本籍・筆頭者） */}
          <RegistriesPanel
            registries={registries}
            persons={persons}
            onFocusPerson={(person: ProcessedPerson) => {
              handleSearchResultSelect(person)
              setIsRightPanelOpen(true)
            }}
          />


        </aside>
      </div>

      {pendingImport && <JsonImportDialog count={pendingImport.people.length} onClose={() => setPendingImport(null)} onImport={mode => {
        const { mergedPersonCount, addedPersonCount } = importFamilyTreeData(pendingImport, mode)
        setPendingImport(null)
        toast.success(`${addedPersonCount}人を追加、${mergedPersonCount}人を統合しました`)
      }} />}

      {/* 編集ダイアログ */}
      <MergePersonsDialog
        isOpen={isMergePersonsOpen}
        onClose={() => setIsMergePersonsOpen(false)}
        persons={persons}
        candidates={mergeCandidates}
        basePerson={selectedPerson ?? null}
        onMerge={(keepId, dropId) => {
          mergePersons(keepId, dropId)
          setSelectedPersonId(keepId)
          toast.success('2人を1人にまとめました')
        }}
      />

      <PersonEditDialog
        sourceActions={selectedPersonSources.length ? selectedPersonSources.map(file => <Button key={file.id} size="sm" variant="outline" className="max-w-full" disabled={!canOpenKosekiFile(file, isAdmin)} title={canOpenKosekiFile(file, isAdmin) ? file.fileName : '保管期間を過ぎているため開けません'} onClick={() => handleOpenSource(file)}><span className="truncate">{file.fileName}</span></Button>) : undefined}
        onLiveDraft={canEdit ? (personId, draft) => publishLiveEdit(personId, { draft }) : undefined}
        editingBy={
          otherEditors.find(editor => editor.editingPersonId === selectedPersonId)?.label ?? null
        }
        person={selectedPerson}
        isOpen={isPersonEditOpen}
        onClose={() => {
          // 開いたまま流していた下書きを消す（閉じたのに相手の画面に残らないように）
          if (selectedPersonId) finishLiveEdit(selectedPersonId)
          setIsPersonEditOpen(false)
        }}
        onSave={(personId, updates) => {
          // selectedPersonはpersonsから導出しているため、更新すれば表示も自動で追従する
          updatePerson(personId, updates)
          finishLiveEdit(personId)
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

      <PdfExportDialog
        open={isPdfDialogOpen}
        onOpenChange={setIsPdfDialogOpen}
        contentSize={pdfContentSize}
        previewSvg={pdfPreviewSvg}
        onExport={runPdfExport}
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
