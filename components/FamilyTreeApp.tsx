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
import { fetchProject, ProjectSummary } from "../lib/db/projects"
import { ProcessedPerson, searchPersons, FamilyTreeData, isValidFamilyTreeData } from "../utils/familyDataProcessor"
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

  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextInputTarget(e.target)) return
      if (!canEdit) return

      // Command+Z (Mac) または Ctrl+Z (Windows/Linux) でアンドゥ
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo) {
          undo()
        }
      }

      // Command+Shift+Z (Mac) または Ctrl+Y (Windows/Linux) でリドゥ
      if (((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) ||
          ((e.ctrlKey) && e.key === 'y')) {
        e.preventDefault()
        if (canRedo) {
          redo()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo, canRedo, undo, redo, canEdit])

  // 人物選択ハンドラー
  const handlePersonSelect = useCallback((person: ProcessedPerson) => {
    setSelectedPersonId(person.id)
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

  // 戸籍データ抽出ハンドラー（解析結果を既存データへマージし、1回の更新で反映する）
  const handleKosekiDataExtracted = (data: FamilyTreeData) => {
    importFamilyTreeData(data, 'merge')
    setIsKosekiUploadOpen(false)
    toast.success(`戸籍データを取り込みました（${data.people.length}人）`)
  }

  // 手動保存ハンドラー
  const handleManualSave = async () => {
    await saveNow()
    toast.success('保存しました')
  }

  // JSON書き出しハンドラー
  const handleExport = () => {
    const data = exportFamilyTreeData()
    const jsonString = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `family-tree_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('JSONファイルを書き出しました')
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

      const shouldReplace = confirm(
        '現在の家系図を、読み込むファイルの内容で置き換えますか？\n' +
        '「キャンセル」を選ぶと、既存のデータに追加でマージされます。'
      )
      importFamilyTreeData(data, shouldReplace ? 'replace' : 'merge')
      toast.success(`ファイルを読み込みました（${data.people.length}人）`)
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
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/projects">
              <Button variant="ghost" size="sm" title="案件一覧に戻る">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
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
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Upload className="w-4 h-4 mr-2" />
              書き出し
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSettingsOpen(true)}
              title="設定（ズーム・ピンチ感度など）"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左サイドバー */}
        <aside
          style={{ width: UI_CONFIG.leftSidebarWidth }}
          className="bg-white border-r border-gray-200 flex flex-col overflow-y-auto"
        >
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
            onPersonPositionUpdate={handlePersonPositionUpdate}
            focusPerson={focusPerson}
            zoomSettings={zoomSettings}
          />
        </main>

        {/* 右サイドバー - 情報表示・検索 */}
        <aside style={{ width: UI_CONFIG.rightSidebarWidth }} className="bg-white border-l border-gray-200 flex flex-col">
          {/* 検索機能 */}
          <div className="p-6 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="人物を検索..."
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
                      onClick={() => handleSearchResultSelect(person)}
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
                        onClick={() => {
                          if (confirm(`${selectedPerson.displayName}を削除してもよろしいですか？`)) {
                            deletePerson(selectedPerson.id)
                            setSelectedPersonId(null)
                          }
                        }}
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
