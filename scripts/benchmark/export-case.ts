/* eslint-disable no-console */
// ============================================================================
// アプリの案件から、ベンチマークの「案件単位」のテストデータを書き出す（読み取りのみ）。
//
//   pnpm benchmark:export -- --source テスト --expected テスト1
//
// - --source:   戸籍書類（PDF・画像）を取り出す案件（AIが読み取った元の案件）
// - --expected: 正解として使う案件（人が直した家系図）。書類を持たない場合は、書類は --source から取る
// - --out:      書き出し先（省略時は testdata/<--expected の案件名>）。testdata/ はgitignore済み
// - 案件名が複数の事務所で重なる場合は、案件ID（UUID）で指定する
//
// 本番のSupabaseを読むため、.env.local に NEXT_PUBLIC_SUPABASE_URL と
// SUPABASE_SERVICE_ROLE_KEY が必要。データの変更・削除は一切行わない
// （select と storage の download だけを使う）。
// 書き出したファイルは実在の戸籍（機微情報）なので、アクセス制限された場所で扱い、コミットしないこと。
// ============================================================================

import fs from 'fs'
import path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { isValidFamilyTreeData } from '../../utils/familyDataProcessor'

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findProject(supabase: SupabaseClient, nameOrId: string): Promise<{ id: string; name: string }> {
  const query = supabase.from('projects').select('id, name')
  const { data, error } = await (UUID.test(nameOrId) ? query.eq('id', nameOrId) : query.eq('name', nameOrId))
  if (error) throw new Error(`案件を検索できませんでした: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`案件「${nameOrId}」が見つかりません`)
  if (data.length > 1) {
    throw new Error(
      `案件「${nameOrId}」が${data.length}件あります。案件IDで指定してください: ` +
        data.map(p => `${p.id}（${p.name}）`).join('、')
    )
  }
  return data[0]
}

/** 案件の戸籍書類を書き出す。書き出した件数を返す */
async function downloadKosekiFiles(supabase: SupabaseClient, projectId: string, outDir: string): Promise<number> {
  const { data: files, error } = await supabase
    .from('koseki_files')
    .select('storage_path, file_name, mime_type, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`戸籍書類の一覧を取得できませんでした: ${error.message}`)

  let index = 0
  for (const file of files ?? []) {
    const { data: blob, error: downloadError } = await supabase.storage.from('koseki').download(file.storage_path)
    if (downloadError || !blob) {
      throw new Error(`${file.file_name} をダウンロードできませんでした: ${downloadError?.message ?? ''}`)
    }
    index++
    // 読み込んだ順に統合するため、アップロード順の番号を先頭に付ける。
    // ベンチマークは拡張子で書類を見分けるので、元のファイル名に関係なく形式から拡張子を付ける
    const extension = EXTENSION_BY_MIME[String(file.mime_type)]
    if (!extension) throw new Error(`${file.file_name}: 対応していない形式です（${file.mime_type}）`)
    const baseName = String(file.file_name).replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '_')
    const target = path.join(outDir, `${String(index).padStart(3, '0')}_${baseName}${extension}`)
    fs.writeFileSync(target, Buffer.from(await blob.arrayBuffer()))
    console.log(`  書類: ${path.basename(target)}`)
  }
  return index
}

async function main() {
  loadEnvLocal()
  const argv = process.argv.slice(2)
  const source = argValue(argv, '--source')
  const expected = argValue(argv, '--expected')
  if (!source || !expected) {
    console.error('使い方: pnpm benchmark:export -- --source <AIが読み取った案件> --expected <人が直した案件> [--out <書き出し先>]')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    console.error('.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください')
    process.exit(1)
  }
  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const sourceProject = await findProject(supabase, source)
  const expectedProject = await findProject(supabase, expected)
  const outDir = argValue(argv, '--out') ?? path.join('testdata', expectedProject.name.replace(/[\\/:*?"<>|]/g, '_'))
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    console.error(`${outDir} は空ではありません。上書きしないよう、別の --out を指定するか中身を確認してください`)
    process.exit(1)
  }
  // 途中で失敗したときに書きかけの案件が残らないよう、一時ディレクトリに書いてから最後に移す
  const workDir = `${outDir}.partial-${process.pid}`
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  try {
    await exportCase(supabase, sourceProject, expectedProject, workDir)
    fs.rmSync(outDir, { recursive: true, force: true }) // 空であることは上で確かめている
    fs.renameSync(workDir, outDir)
  } catch (error) {
    fs.rmSync(workDir, { recursive: true, force: true })
    throw error
  }

  console.log('')
  console.log(`✅ ${outDir} に書き出しました`)
  console.log(`   次に: pnpm benchmark -- --dir ${path.dirname(outDir)} --candidates gemini:gemini-4-argon,gemini:gemini-3.1-pro-preview`)
  console.log('   ⚠ 実在の戸籍です。コミットせず、使い終わったら削除してください（testdata/ はgitignore済み）')
}

async function exportCase(
  supabase: SupabaseClient,
  sourceProject: { id: string; name: string },
  expectedProject: { id: string; name: string },
  outDir: string
) {
  console.log(`正解: ${expectedProject.name}（${expectedProject.id}）`)
  const { data: revision, error: revisionError } = await supabase
    .from('tree_revisions')
    .select('data')
    .eq('project_id', expectedProject.id)
    .maybeSingle()
  if (revisionError || !revision) throw new Error(`「${expectedProject.name}」の家系図を取得できませんでした`)
  if (!isValidFamilyTreeData(revision.data)) throw new Error(`「${expectedProject.name}」の家系図の形式が不正です`)
  fs.writeFileSync(path.join(outDir, 'expected.json'), JSON.stringify(revision.data, null, 2))
  console.log(`  正解の家系図: ${revision.data.people.length}人・${revision.data.families.length}家族`)

  console.log(`書類: ${sourceProject.name}（${sourceProject.id}）`)
  let count = await downloadKosekiFiles(supabase, sourceProject.id, outDir)
  if (count === 0 && expectedProject.id !== sourceProject.id) {
    console.log(`  「${sourceProject.name}」に書類が無いため、「${expectedProject.name}」の書類を使います`)
    count = await downloadKosekiFiles(supabase, expectedProject.id, outDir)
  }
  if (count === 0) throw new Error('戸籍書類が1件もありません')
  console.log(`  書類${count}件＋expected.json`)
}

main().catch(error => {
  console.error('書き出しに失敗しました:', error instanceof Error ? error.message : error)
  process.exit(1)
})
