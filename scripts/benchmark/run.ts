/* eslint-disable no-console */
// ============================================================================
// 戸籍解析モデルのベンチマークCLI。
//
// 使い方（詳細な運用手順は docs/BENCHMARK_GUIDE.md）:
//   pnpm benchmark                              # testdata/ を全設定済みプロバイダで
//   pnpm benchmark -- --dir testdata/basic      # 対象ディレクトリ指定
//   pnpm benchmark -- --candidates gemini:gemini-3.1-pro,anthropic:claude-opus-5
//
// テストデータ（機微情報）はリポジトリにコミットされない（.gitignore対象）。
// ============================================================================

import fs from 'fs'
import path from 'path'
import { geminiProvider } from '../../lib/analysis/providers/gemini'
import { anthropicProvider } from '../../lib/analysis/providers/anthropic'
import { openaiProvider } from '../../lib/analysis/providers/openai'
import { DEFAULT_MODELS } from '../../lib/analysis/chain'
import { kosekiResultSchema } from '../../lib/analysis/schema'
import { sanitizeFamilyTreeData } from '../../lib/analysis/sanitize'
import {
  AnalysisProvider,
  AnalysisProviderName,
  ProviderCandidate,
  TokenUsage,
} from '../../lib/analysis/types'
import { FamilyTreeData, isValidFamilyTreeData } from '../../utils/familyDataProcessor'
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
}

// 実測トークンから原価を出すための単価（USD / 100万トークン、2026年9月時点）。
// 未知のモデルは概算できないため原価欄を空にする。
const PRICING: Record<string, { input: number; output: number; cachedInput: number }> = {
  'gemini-3.1-pro':   { input: 2.0,   output: 12.0, cachedInput: 0.2 },
  'gemini-2.5-pro':   { input: 1.25,  output: 10.0, cachedInput: 0.125 },
  'claude-opus-5':    { input: 5.0,   output: 25.0, cachedInput: 0.5 },
  'claude-sonnet-5':  { input: 2.0,   output: 10.0, cachedInput: 0.2 },
  'claude-haiku-4-5': { input: 1.0,   output: 5.0,  cachedInput: 0.1 },
  'gpt-5.2':          { input: 0.875, output: 7.0,  cachedInput: 0.0875 },
}
const USD_TO_JPY = Number(process.env.BENCHMARK_USD_JPY ?? 150)

/** 実測トークンから1ページあたりの原価（円）を求める。単価未登録ならnull */
function estimateYen(model: string, usage: TokenUsage | null | undefined): number | null {
  if (!usage) return null
  const price = PRICING[model]
  if (!price) return null
  const cached = usage.cachedInputTokens ?? 0
  const uncachedInput = Math.max(0, (usage.inputTokens ?? 0) - cached)
  const usd =
    (uncachedInput * price.input + cached * price.cachedInput + (usage.outputTokens ?? 0) * price.output) / 1e6
  return usd * USD_TO_JPY
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

function parseArgs(argv: string[]): { dir: string; candidates: ProviderCandidate[] } {
  let dir = 'testdata'
  let candidatesArg: string | null = null

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i]
    else if (argv[i] === '--candidates' && argv[i + 1]) candidatesArg = argv[++i]
  }

  let candidates: ProviderCandidate[]
  if (candidatesArg) {
    candidates = candidatesArg.split(',').map(entry => {
      const [provider, model] = entry.trim().split(':')
      if (!(provider in PROVIDERS)) {
        throw new Error(`不明なプロバイダ: ${provider}（gemini / anthropic / openai）`)
      }
      const p = provider as AnalysisProviderName
      return { provider: p, model: model || DEFAULT_MODELS[p] }
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

  const files = fs
    .readdirSync(dir)
    .filter(f => MIME_BY_EXT[path.extname(f).toLowerCase()])
    .sort()
    .map(f => path.join(dir, f))

  if (files.length === 0) {
    console.error(`${dir} に対象ファイル（PDF/JPEG/PNG/WebP）がありません`)
    process.exit(1)
  }

  console.log(`対象ファイル: ${files.length}件 / 候補モデル: ${candidates.map(c => `${c.provider}:${c.model}`).join(', ')}`)
  console.log('')

  const results: FileResult[] = []

  for (const file of files) {
    const mimeType = MIME_BY_EXT[path.extname(file).toLowerCase()]
    const base64Data = fs.readFileSync(file).toString('base64')
    const expected = loadExpected(file)

    for (const candidate of candidates) {
      const label = `${candidate.provider}:${candidate.model}`
      process.stdout.write(`▶ ${path.basename(file)} × ${label} ... `)
      const startedAt = Date.now()

      try {
        const { raw, usage } = await PROVIDERS[candidate.provider].analyze({ base64Data, mimeType }, candidate.model)
        const parsed = kosekiResultSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error(`スキーマ不一致: ${parsed.error.issues[0]?.message ?? ''}`)
        }
        const data = sanitizeFamilyTreeData(parsed.data as FamilyTreeData)
        const durationSeconds = (Date.now() - startedAt) / 1000

        const result: FileResult = {
          file: path.basename(file),
          candidate: label,
          ok: true,
          durationSeconds,
          personCount: data.people.length,
          familyCount: data.families.length,
          data,
          usage,
        }
        if (expected) {
          result.score = scoreResult(expected, data)
          const { missing, extra } = matchPeople(expected.people, data.people)
          result.missingNames = missing.map(displayName)
          result.extraNames = extra.map(displayName)
        }
        results.push(result)
        console.log(`OK ${data.people.length}人 / ${data.families.length}家族 (${durationSeconds.toFixed(1)}s)` +
          (result.score ? ` F1=${formatPercent(result.score.f1)}` : ''))
      } catch (error) {
        const durationSeconds = (Date.now() - startedAt) / 1000
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          file: path.basename(file),
          candidate: label,
          ok: false,
          error: message,
          durationSeconds,
          personCount: 0,
          familyCount: 0,
        })
        console.log(`失敗 (${durationSeconds.toFixed(1)}s): ${message}`)
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
  lines.push(`- 対象: ${dir}（${files.length}ファイル）`)
  lines.push(`- 候補: ${candidates.map(c => `${c.provider}:${c.model}`).join(', ')}`)
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
  lines.push('| モデル | 成功/試行 | 平均F1 | 平均再現率 | 平均適合率 | 平均生年一致 | 平均所要 | 平均入力tok | キャッシュ率 | 平均原価/枚 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const candidate of candidates) {
    const label = `${candidate.provider}:${candidate.model}`
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
        .map(r => estimateYen(candidate.model, r.usage))
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
