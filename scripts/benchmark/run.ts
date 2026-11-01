/* eslint-disable no-console */
// ============================================================================
// 戸籍解析モデルのベンチマークCLI。
//
// 使い方（詳細な運用手順は docs/BENCHMARK_GUIDE.md）:
//   pnpm benchmark                              # testdata/ を全設定済みプロバイダで
//   pnpm benchmark -- --dir testdata/basic      # 対象ディレクトリ指定
//   pnpm benchmark -- --candidates gemini:gemini-4-argon,gemini:gemini-3.1-pro-preview
//   pnpm benchmark -- --candidates gemini:gemini-4-argon@medium,gemini:gemini-4-argon@high  # 読み取り解像度の比較
//
// 対象は2種類:
//   - 1ファイル単位: <名前>.pdf と <名前>.expected.json を並べて置く
//   - 案件単位: サブディレクトリに複数の戸籍書類と expected.json を置く。
//     各書類を解析してアプリと同じ名寄せで統合し、統合した家系図を正解と比べる
//     （複数の戸籍をまたいだ名寄せ・世代の誤りはここでしか測れない）
//
// テストデータ（機微情報）はリポジトリにコミットされない（.gitignore対象）。
// ============================================================================

import fs from 'fs'
import path from 'path'
import { geminiProvider } from '../../lib/analysis/providers/gemini'
import { anthropicProvider } from '../../lib/analysis/providers/anthropic'
import { openaiProvider } from '../../lib/analysis/providers/openai'
import { DEFAULT_MODELS } from '../../lib/analysis/chain'
import { estimateCostUsd } from '../../lib/analysis/pricing'
import { mergeFamilyTreeData } from '../../utils/mergeFamilyData'
import { kosekiResultSchema } from '../../lib/analysis/schema'
import { sanitizeFamilyTreeData } from '../../lib/analysis/sanitize'
import {
  AnalysisProvider,
  AnalysisProviderName,
  ProviderCandidate,
  TokenUsage,
} from '../../lib/analysis/types'
import { FamilyTreeData, isValidFamilyTreeData, processFamilyData, toFamilyTreeData } from '../../utils/familyDataProcessor'
import { scoreResult, matchPeople, formatPercent, BenchmarkScore } from './metrics'

const PROVIDERS: Record<AnalysisProviderName, AnalysisProvider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
}

const API_KEY_ENV: Record<AnalysisProviderName, string> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

interface FileResult {
  file: string
  candidate: string
  ok: boolean
  error?: string
  durationSeconds: number
  personCount: number
  familyCount: number
  score?: BenchmarkScore
  missingNames?: string[]
  extraNames?: string[]
  data?: FamilyTreeData
  usage?: TokenUsage | null
  /** 見積もり原価（円）。単価が分からない場合は null */
  costYen?: number | null
}

/** 採点の単位。1ファイル、または複数ファイルを統合する案件 */
interface BenchmarkItem {
  name: string
  files: string[]
  expected: FamilyTreeData | null
}

/** 候補の指定。Geminiは「@解像度」を付けると読み取り解像度を変えて比べられる */
interface BenchmarkCandidate extends ProviderCandidate {
  resolution?: string
}

const labelOf = (c: BenchmarkCandidate) => `${c.provider}:${c.model}${c.resolution ? `@${c.resolution}` : ''}`

const USD_TO_JPY = Number(process.env.BENCHMARK_USD_JPY ?? 150)

/** 実測トークンから原価（円）を求める。単価は lib/analysis/pricing.ts と共通。未登録ならnull */
function estimateYen(model: string, usage: TokenUsage | null | undefined): number | null {
  const usd = estimateCostUsd(model, usage)
  return usd === null ? null : usd * USD_TO_JPY
}

// ---- .env.local の読み込み（Next外のNode実行のため簡易パーサで読む） ----
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

function parseArgs(argv: string[]): { dir: string; candidates: BenchmarkCandidate[] } {
  let dir = 'testdata'
  let candidatesArg: string | null = null

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i]
    else if (argv[i] === '--candidates' && argv[i + 1]) candidatesArg = argv[++i]
  }

  let candidates: BenchmarkCandidate[]
  if (candidatesArg) {
    candidates = candidatesArg.split(',').map(entry => {
      const [spec, resolution] = entry.trim().split('@')
      const [provider, model] = spec.split(':')
      if (!(provider in PROVIDERS)) {
        throw new Error(`不明なプロバイダ: ${provider}（gemini / anthropic / openai）`)
      }
      const p = provider as AnalysisProviderName
      if (resolution && (p !== 'gemini' || !['low', 'medium', 'high', 'ultra_high'].includes(resolution))) {
        throw new Error(`解像度の指定「@${resolution}」は Gemini の low / medium / high / ultra_high のみ使えます（${entry.trim()}）`)
      }
      return { provider: p, model: model || DEFAULT_MODELS[p], ...(resolution ? { resolution } : {}) }
    })
  } else {
    // 既定: APIキーが設定されている全プロバイダを既定モデルで
    candidates = (Object.keys(PROVIDERS) as AnalysisProviderName[])
      .filter(p => Boolean(process.env[API_KEY_ENV[p]]))
      .map(p => ({ provider: p, model: DEFAULT_MODELS[p] }))
  }

  // キー未設定の候補を除外（明示指定時は警告する）
  candidates = candidates.filter(c => {
    if (!process.env[API_KEY_ENV[c.provider]]) {
      console.warn(`⚠ ${c.provider} はAPIキー（${API_KEY_ENV[c.provider]}）が未設定のためスキップします`)
      return false
    }
    return true
  })

  return { dir, candidates }
}

function loadExpected(filePath: string): FamilyTreeData | null {
  const base = filePath.replace(/\.[^.]+$/, '')
  const expectedPath = `${base}.expected.json`
  if (!fs.existsSync(expectedPath)) return null
  const parsed = JSON.parse(fs.readFileSync(expectedPath, 'utf8'))
  if (!isValidFamilyTreeData(parsed)) {
    throw new Error(`${expectedPath} がFamilyTreeData形式（people/families配列）ではありません`)
  }
  return parsed
}

function displayName(p: { name: { surname: string; given_name: string } }): string {
  return `${p.name.surname} ${p.name.given_name}`.trim()
}

async function main() {
  loadEnvLocal()
  const { dir, candidates } = parseArgs(process.argv.slice(2))

  if (candidates.length === 0) {
    console.error('実行できる候補がありません。GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY のいずれかを .env.local に設定してください。')
    process.exit(1)
  }
  if (!fs.existsSync(dir)) {
    console.error(`テストデータディレクトリが見つかりません: ${dir}`)
    console.error('docs/BENCHMARK_GUIDE.md の手順に従って testdata/ に戸籍書類を配置してください。')
    process.exit(1)
  }

  const isSource = (f: string) => Boolean(MIME_BY_EXT[path.extname(f).toLowerCase()])
  const items: BenchmarkItem[] = []
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry)
    // 書き出し途中（benchmark:export が中断した）のディレクトリは対象にしない
    if (entry.includes('.partial-')) continue
    if (fs.statSync(full).isDirectory()) {
      // 案件単位: 複数の戸籍書類と expected.json
      const sources = fs.readdirSync(full).filter(isSource).sort().map(f => path.join(full, f))
      const expectedPath = path.join(full, 'expected.json')
      if (sources.length === 0) continue
      let expected: FamilyTreeData | null = null
      if (fs.existsSync(expectedPath)) {
        const parsed = JSON.parse(fs.readFileSync(expectedPath, 'utf8'))
        if (!isValidFamilyTreeData(parsed)) {
          throw new Error(`${expectedPath} がFamilyTreeData形式（people/families配列）ではありません`)
        }
        expected = parsed
      }
      items.push({ name: `${entry}/（${sources.length}ファイルを統合）`, files: sources, expected })
    } else if (isSource(entry)) {
      items.push({ name: entry, files: [full], expected: loadExpected(full) })
    }
  }

  if (items.length === 0) {
    console.error(`${dir} に対象ファイル（PDF/JPEG/PNG/WebP）がありません`)
    process.exit(1)
  }

  console.log(`対象: ${items.length}件 / 候補モデル: ${candidates.map(labelOf).join(', ')}`)
  console.log('')

  const results: FileResult[] = []

  for (const item of items) {
    for (const candidate of candidates) {
      const label = labelOf(candidate)
      process.stdout.write(`▶ ${item.name} × ${label} ... `)
      const startedAt = Date.now()
      // 読み取り解像度の比較（Geminiのみ有効）。プロバイダは環境変数を見るため、呼び出しの間だけ差し替える
      const previousResolution = process.env.GEMINI_MEDIA_RESOLUTION
      if (candidate.resolution) process.env.GEMINI_MEDIA_RESOLUTION = candidate.resolution

      try {
        // 書類ごとに解析し、アプリの読み込みと同じ名寄せで1つの家系図に統合する
        let merged: FamilyTreeData = { people: [], families: [] }
        const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
        let costYen: number | null = 0
        for (const file of item.files) {
          const mimeType = MIME_BY_EXT[path.extname(file).toLowerCase()]
          const base64Data = fs.readFileSync(file).toString('base64')
          const { raw, usage: fileUsage } = await PROVIDERS[candidate.provider].analyze({ base64Data, mimeType }, candidate.model)
          const parsed = kosekiResultSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error(`${path.basename(file)}: スキーマ不一致: ${parsed.error.issues[0]?.message ?? ''}`)
          }
          const data = sanitizeFamilyTreeData(parsed.data as FamilyTreeData)
          // アプリの読み込み（useFamilyData の importFamilyTreeData）と同じく、
          // 名寄せで統合したあと画面のデータ形式を一度通す（正規化の差で結果がずれないように）
          const mergedRaw = mergeFamilyTreeData(merged, data).data
          const processed = processFamilyData(mergedRaw)
          merged = toFamilyTreeData(processed.persons, processed.families, mergedRaw.crossCheckIssues, mergedRaw.registries)
          usage.inputTokens! += fileUsage?.inputTokens ?? 0
          usage.outputTokens! += fileUsage?.outputTokens ?? 0
          usage.cachedInputTokens! += fileUsage?.cachedInputTokens ?? 0
          const fileYen = estimateYen(candidate.model, fileUsage)
          costYen = costYen === null || fileYen === null ? null : costYen + fileYen
        }
        const durationSeconds = (Date.now() - startedAt) / 1000

        const result: FileResult = {
          file: item.name,
          candidate: label,
          ok: true,
          durationSeconds,
          personCount: merged.people.length,
          familyCount: merged.families.length,
          data: merged,
          usage,
          costYen,
        }
        if (item.expected) {
          result.score = scoreResult(item.expected, merged)
          const { missing, extra } = matchPeople(item.expected.people, merged.people)
          result.missingNames = missing.map(displayName)
          result.extraNames = extra.map(displayName)
        }
        results.push(result)
        console.log(`OK ${merged.people.length}人 / ${merged.families.length}家族 (${durationSeconds.toFixed(1)}s)` +
          (result.score ? ` F1=${formatPercent(result.score.f1)}` : ''))
      } catch (error) {
        const durationSeconds = (Date.now() - startedAt) / 1000
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          file: item.name,
          candidate: label,
          ok: false,
          error: message,
          durationSeconds,
          personCount: 0,
          familyCount: 0,
        })
        console.log(`失敗 (${durationSeconds.toFixed(1)}s): ${message}`)
      } finally {
        if (previousResolution === undefined) delete process.env.GEMINI_MEDIA_RESOLUTION
        else process.env.GEMINI_MEDIA_RESOLUTION = previousResolution
      }
    }
  }

  // ---- レポート出力 ----
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join('benchmark-results', timestamp)
  fs.mkdirSync(outDir, { recursive: true })

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))

  const lines: string[] = []
  lines.push(`# 戸籍解析ベンチマーク結果`)
  lines.push('')
  lines.push(`- 実行日時: ${new Date().toLocaleString('ja-JP')}`)
  lines.push(`- 対象: ${dir}（${items.length}件）`)
  lines.push(`- 候補: ${candidates.map(labelOf).join(', ')}`)
  lines.push('')

  lines.push('## ファイル別の結果')
  lines.push('')
  lines.push('| ファイル | モデル | 結果 | 人数 | 家族 | 所要 | 再現率 | 適合率 | F1 | 生年一致 | 没年一致 | 性別一致 | 続柄一致 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const s = r.score
    lines.push(
      `| ${r.file} | ${r.candidate} | ${r.ok ? 'OK' : '失敗'} | ${r.personCount} | ${r.familyCount} | ${r.durationSeconds.toFixed(1)}s | ` +
      `${s ? formatPercent(s.recall) : '-'} | ${s ? formatPercent(s.precision) : '-'} | ${s ? formatPercent(s.f1) : '-'} | ` +
      `${s ? formatPercent(s.birthDateAccuracy) : '-'} | ${s ? formatPercent(s.deathDateAccuracy) : '-'} | ` +
      `${s ? formatPercent(s.sexAccuracy) : '-'} | ${s ? formatPercent(s.relationAccuracy) : '-'} |`
    )
  }
  lines.push('')

  // 候補別の集計（正解データがあるファイルのみ）
  lines.push('## モデル別の集計（正解データのあるファイルのみ）')
  lines.push('')
  lines.push('| モデル | 成功/試行 | 平均F1 | 平均再現率 | 平均適合率 | 平均生年一致 | 平均所要 | 平均入力tok | キャッシュ率 | 平均原価/件 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const candidate of candidates) {
    const label = labelOf(candidate)
    const all = results.filter(r => r.candidate === label)
    const scored = all.filter(r => r.ok && r.score)
    const avg = (pick: (s: BenchmarkScore) => number | null): number | null => {
      const values = scored
        .map(r => pick(r.score!))
        .filter((v): v is number => v !== null)
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
    }
    const avgDuration = all.length === 0 ? 0 : all.reduce((a, r) => a + r.durationSeconds, 0) / all.length
    // トークンと原価の実測（usageを返したファイルのみ）
    const withUsage = all.filter(r => r.ok && r.usage)
    const mean = (values: number[]): number | null =>
      values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
    const avgInput = mean(withUsage.map(r => r.usage!.inputTokens ?? 0).filter(v => v > 0))
    const totalInput = withUsage.reduce((a, r) => a + (r.usage!.inputTokens ?? 0), 0)
    const totalCached = withUsage.reduce((a, r) => a + (r.usage!.cachedInputTokens ?? 0), 0)
    const cacheRate = totalInput > 0 ? totalCached / totalInput : null
    const avgYen = mean(
      withUsage
        .map(r => r.costYen ?? null)
        .filter((v): v is number => v !== null)
    )
    lines.push(
      `| ${label} | ${all.filter(r => r.ok).length}/${all.length} | ${formatPercent(avg(s => s.f1))} | ` +
      `${formatPercent(avg(s => s.recall))} | ${formatPercent(avg(s => s.precision))} | ` +
      `${formatPercent(avg(s => s.birthDateAccuracy))} | ${avgDuration.toFixed(1)}s | ` +
      `${avgInput === null ? '-' : Math.round(avgInput).toLocaleString()} | ` +
      `${cacheRate === null ? '-' : formatPercent(cacheRate)} | ` +
      `${avgYen === null ? '-' : '¥' + avgYen.toFixed(2)} |`
    )
  }
  lines.push('')

  // 取りこぼし・幻覚の内訳
  const withDiffs = results.filter(r => (r.missingNames?.length || r.extraNames?.length))
  if (withDiffs.length > 0) {
    lines.push('## 差分の内訳（取りこぼし・過剰抽出）')
    lines.push('')
    for (const r of withDiffs) {
      lines.push(`### ${r.file} × ${r.candidate}`)
      if (r.missingNames?.length) lines.push(`- 取りこぼし: ${r.missingNames.join('、')}`)
      if (r.extraNames?.length) lines.push(`- 正解にない抽出: ${r.extraNames.join('、')}`)
      lines.push('')
    }
  }

  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'))

  console.log('')
  console.log(`✅ 完了: レポートを ${outDir}/report.md に書き出しました`)
  console.log(`   （生データ: ${outDir}/results.json）`)

  const failures = results.filter(r => !r.ok).length
  if (failures > 0) {
    console.log(`⚠ ${failures}件の試行が失敗しています。report.mdとエラーメッセージを確認してください。`)
  }
}

main().catch(error => {
  console.error('ベンチマーク実行エラー:', error)
  process.exit(1)
})
