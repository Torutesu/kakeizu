/* eslint-disable no-console */
// ============================================================================
// 本番環境の全自動プロビジョニング。
//
// Supabaseプロジェクトの作成 → スキーマ適用 → Vercelデプロイ → 認証URL設定 →
// 疎通確認までを一括で行う。冪等（既存の同名プロジェクトがあれば再利用）なので、
// 途中で失敗しても再実行すればよい。
//
// 必要な環境変数:
//   SUPABASE_ACCESS_TOKEN  https://supabase.com/dashboard/account/tokens で発行
//   VERCEL_TOKEN           https://vercel.com/account/settings/tokens で発行
//   GEMINI_API_KEY         解析AI（1つ以上。ANTHROPIC_API_KEY / OPENAI_API_KEY も可）
//
// 実行:
//   SUPABASE_ACCESS_TOKEN=... VERCEL_TOKEN=... GEMINI_API_KEY=... node scripts/provision.mjs
//
// オプション環境変数:
//   PROJECT_NAME           プロジェクト名（既定: kakeizu）
//   SUPABASE_REGION        リージョン（既定: ap-northeast-1 = 東京）
//   SUPABASE_ORG_ID        複数組織がある場合に指定（省略時は最初の組織）
// ============================================================================

import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const SUPABASE_API = 'https://api.supabase.com'
const VERCEL_API = 'https://api.vercel.com'

const PROJECT_NAME = process.env.PROJECT_NAME || 'kakeizu'
const SUPABASE_REGION = process.env.SUPABASE_REGION || 'ap-northeast-1'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
const vercelToken = process.env.VERCEL_TOKEN

function fail(message) {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

function step(message) {
  console.log(`\n▶ ${message}`)
}

async function api(base, token, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* テキストのまま扱う */ }
  if (!response.ok) {
    const detail = json?.message ?? json?.error?.message ?? text.slice(0, 500)
    const error = new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${detail}`)
    error.status = response.status
    throw error
  }
  return json
}

const supa = (path, options) => api(SUPABASE_API, supabaseToken, path, options)
const vercel = (path, options) => api(VERCEL_API, vercelToken, path, options)

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// 1. Supabase
// ---------------------------------------------------------------------------
async function provisionSupabase() {
  step('Supabase: 組織を確認')
  const orgs = await supa('/v1/organizations')
  if (!orgs?.length) fail('Supabaseの組織が見つかりません。ダッシュボードで一度ログインして組織を作成してください。')
  const orgId = process.env.SUPABASE_ORG_ID || orgs[0].id
  console.log(`  組織: ${orgs.find(o => o.id === orgId)?.name ?? orgId}`)

  step(`Supabase: プロジェクト「${PROJECT_NAME}」を作成（既存なら再利用）`)
  const projects = await supa('/v1/projects')
  let project = projects.find(p => p.name === PROJECT_NAME)
  if (project) {
    console.log(`  既存プロジェクトを再利用: ${project.id}`)
  } else {
    const dbPassword = crypto.randomBytes(24).toString('base64url')
    project = await supa('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: orgId,
        name: PROJECT_NAME,
        region: SUPABASE_REGION,
        db_pass: dbPassword,
      }),
    })
    console.log(`  作成しました: ${project.id}`)
    console.log(`  ⚠ DBパスワード（直接DB接続時のみ必要。安全な場所に保管してください）: ${dbPassword}`)
  }
  const ref = project.id

  step('Supabase: プロジェクトの起動を待機（数分かかることがあります）')
  for (let i = 0; i < 60; i++) {
    const status = (await supa(`/v1/projects/${ref}`)).status
    if (status === 'ACTIVE_HEALTHY') break
    if (i === 59) fail(`プロジェクトが起動しません（status=${status}）。時間をおいて再実行してください。`)
    process.stdout.write('.')
    await sleep(10_000)
  }
  console.log(' 起動済み')

  step('Supabase: スキーマ（supabase/setup_all.sql）を適用')
  const sql = fs.readFileSync('supabase/setup_all.sql', 'utf8')
  try {
    await supa(`/v1/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: sql }),
    })
    console.log('  適用しました')
  } catch (error) {
    if (/already exists/i.test(String(error.message))) {
      console.log('  一部のオブジェクトが既に存在します（再実行のためスキップ扱い）')
    } else {
      throw error
    }
  }

  step('Supabase: anonキーを取得')
  const keys = await supa(`/v1/projects/${ref}/api-keys`)
  const anonKey = keys.find(k => k.name === 'anon')?.api_key ?? keys.find(k => /publishable|anon/i.test(k.name))?.api_key
  if (!anonKey) fail('anonキーが取得できませんでした。ダッシュボードのSettings → APIから手動で取得してください。')

  return { ref, url: `https://${ref}.supabase.co`, anonKey }
}

// ---------------------------------------------------------------------------
// 2. Vercel
// ---------------------------------------------------------------------------
function vercelCli(args, { allowFail = false } = {}) {
  try {
    return execFileSync('npx', ['vercel', ...args, '--token', vercelToken], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (allowFail) return null
    throw new Error(`vercel ${args.join(' ')} が失敗: ${error.stderr ?? error.message}`)
  }
}

async function provisionVercel(supabase) {
  step(`Vercel: プロジェクト「${PROJECT_NAME}」を作成（既存なら再利用）`)
  try {
    await vercel('/v11/projects', {
      method: 'POST',
      body: JSON.stringify({ name: PROJECT_NAME, framework: 'nextjs' }),
    })
    console.log('  作成しました')
  } catch (error) {
    if (error.status === 409) console.log('  既存プロジェクトを再利用します')
    else throw error
  }

  step('Vercel: 環境変数を設定')
  const envVars = [
    ['NEXT_PUBLIC_SUPABASE_URL', supabase.url],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', supabase.anonKey],
    ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
    ['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY],
    ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
    ['ANALYSIS_PROVIDER', process.env.ANALYSIS_PROVIDER],
  ].filter(([, value]) => Boolean(value))

  if (!envVars.some(([key]) => key === 'GEMINI_API_KEY' || key === 'ANTHROPIC_API_KEY' || key === 'OPENAI_API_KEY')) {
    console.log('  ⚠ 解析AIのAPIキーが未指定です（後からVercelダッシュボードで追加できます）')
  }

  await vercel(`/v10/projects/${PROJECT_NAME}/env?upsert=true`, {
    method: 'POST',
    body: JSON.stringify(
      envVars.map(([key, value]) => ({
        key,
        value,
        type: 'encrypted',
        target: ['production', 'preview'],
      }))
    ),
  })
  console.log(`  設定: ${envVars.map(([k]) => k).join(', ')}`)

  step('Vercel: 本番デプロイ（ソースをアップロードしてリモートビルド。数分かかります）')
  vercelCli(['link', '--yes', '--project', PROJECT_NAME], { allowFail: true })
  const deployOutput = vercelCli(['deploy', '--prod', '--yes'])
  const deployUrl = (deployOutput.match(/https:\/\/[^\s]+\.vercel\.app/g) ?? []).at(-1)
  if (!deployUrl) fail(`デプロイURLを取得できませんでした。出力:\n${deployOutput}`)
  console.log(`  デプロイ完了: ${deployUrl}`)

  // 本番エイリアス（プロジェクトの固定URL）を取得。取れなければデプロイURLを使う
  let productionUrl = deployUrl
  try {
    const projectInfo = await vercel(`/v9/projects/${PROJECT_NAME}`)
    const alias = projectInfo?.alias?.find(a => !a.deployment || a.deployment)?.domain ??
      projectInfo?.targets?.production?.alias?.[0]
    if (alias) productionUrl = `https://${alias}`
  } catch { /* エイリアス取得は必須ではない */ }

  return { productionUrl }
}

// ---------------------------------------------------------------------------
// 3. 認証リダイレクトURLと疎通確認
// ---------------------------------------------------------------------------
async function configureAuth(supabase, productionUrl) {
  step('Supabase: 認証のSite URLとリダイレクトURLを設定')
  await supa(`/v1/projects/${supabase.ref}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify({
      site_url: productionUrl,
      uri_allow_list: `${productionUrl}/auth/callback,http://localhost:3000/auth/callback`,
    }),
  })
  console.log(`  Site URL: ${productionUrl}`)
}

async function smokeTest(productionUrl) {
  step('疎通確認: /api/health')
  for (let i = 0; i < 12; i++) {
    try {
      const response = await fetch(`${productionUrl}/api/health`)
      if (response.ok) {
        const health = await response.json()
        console.log(`  ${JSON.stringify(health)}`)
        if (!health.supabaseConfigured) {
          console.log('  ⚠ supabaseConfigured=false: 環境変数設定後の再デプロイが必要な可能性があります')
        }
        return
      }
    } catch { /* リトライ */ }
    await sleep(10_000)
  }
  console.log('  ⚠ ヘルスチェックに到達できませんでした。デプロイ状態をVercelダッシュボードで確認してください。')
}

// ---------------------------------------------------------------------------
async function main() {
  if (!supabaseToken) fail('SUPABASE_ACCESS_TOKEN が未設定です（https://supabase.com/dashboard/account/tokens で発行）')
  if (!vercelToken) fail('VERCEL_TOKEN が未設定です（https://vercel.com/account/settings/tokens で発行）')
  if (!fs.existsSync('supabase/setup_all.sql')) fail('supabase/setup_all.sql がありません（pnpm db:bundle で生成）')

  const supabase = await provisionSupabase()
  const { productionUrl } = await provisionVercel(supabase)
  await configureAuth(supabase, productionUrl)
  await smokeTest(productionUrl)

  console.log('\n============================================================')
  console.log(`✅ 完了: ${productionUrl}`)
  console.log('============================================================')
  console.log('次にやること:')
  console.log('  1. 上記URLを開いてアカウント作成 → 組織作成（最初の人がadminになります）')
  console.log('  2. Googleログインを使う場合はSupabaseダッシュボードでProvider設定（docs/SUPABASE_SETUP.md 手順3）')
  console.log('  3. 使い終わったらSUPABASE_ACCESS_TOKENとVERCEL_TOKENを失効させる')
  console.log('  4. mainへのマージで自動デプロイしたい場合はVercelダッシュボードでGitHub連携を有効化')
}

main().catch(error => {
  console.error('\n❌ プロビジョニング失敗:', error.message)
  console.error('再実行すれば途中から続行できます（作成済みリソースは再利用されます）。')
  process.exit(1)
})
