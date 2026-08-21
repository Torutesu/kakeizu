import { useCallback, useEffect, useState } from 'react'
import {
  fetchKosekiFiles,
  deleteKosekiFile,
  KosekiFile,
} from '../lib/db/kosekiFiles'

interface UseKosekiFilesReturn {
  files: KosekiFile[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  remove: (file: KosekiFile) => Promise<void>
}

/**
 * 案件に紐づく戸籍ファイルの一覧を管理するフック。
 * orgIdは監査ログの記録に必要なため、案件情報の読み込み完了まで空文字を許容する。
 */
export function useKosekiFiles(projectId: string, orgId: string): UseKosekiFilesReturn {
  const [files, setFiles] = useState<KosekiFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      setFiles(await fetchKosekiFiles(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = useCallback(async (file: KosekiFile) => {
    await deleteKosekiFile(orgId, file)
    setFiles(prev => prev.filter(f => f.id !== file.id))
  }, [orgId])

  return { files, isLoading, error, refresh, remove }
}
