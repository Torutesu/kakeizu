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
//   VERCEL_TEAM_ID         Vercelのチーム配下に作る場合に指定
//   VERCEL_CLI_VERSION     使用するVercel CLIのバージョン（既定: 48）
// ============================================================================

import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const SUPABASE_API = 'https://api.supabase.com'
const VERCEL_API = 'https://api.vercel.com'

const PROJECT_NAME = process.env.PROJECT_NAME || 'kakeizu'
const SUPABASE_REGION = process.env.SUPABASE_REGION || 'ap-northeast-1'
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || ''
// 出力・フラグの互換性を固定するためVercel CLIのバージョンをピン留めする
const VERCEL_CLI_VERSION = process.env.VERCEL_CLI_VERSION || '48'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
const vercelToken = process.env.VERCEL_TOKEN

function fail(message) {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

function step(message) {
  console.log(`\n▶ ${message}`)
}

// Vercel APIはチームスコープを ?teamId= で受ける
function vercelPath(path) {
  if (!VERCEL_TEAM_ID) return path
  return path + (path.includes('?') ? '&' : '?') + `teamId=${VERCEL_TEAM_ID}`
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
    error.body = json
    throw error
  }
  return json
}

const supa = (path, options) => api(SUPABASE_API, supabaseToken, path, options)
const vercel = (path, options) => api(VERCEL_API, vercelToken, vercelPath(path), options)

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
  if (!orgs.some(o => o.id === orgId)) {
    fail(`SUPABASE_ORG_ID=${orgId} はこのトークンでアクセスできる組織にありません。`)
  }
  console.log(`  組織: ${orgs.find(o => o.id === orgId)?.name ?? orgId}`)

  step(`Supabase: プロジェクト「${PROJECT_NAME}」を作成（同一組織内に既存なら再利用）`)
  const projects = await supa('/v1/projects')
  // 別組織の同名プロジェクトを誤って再利用しないよう、必ず組織IDで絞り込む
  let project = projects.find(p => p.name === PROJECT_NAME && p.organization_id === orgId)
  let created = false
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
    created = true
    console.log(`  作成しました: ${project.id}`)
    console.log(`  ⚠ DBパスワード（直接DB接続時のみ必要。安全な場所に保管してください）: ${dbPassword}`)
  }
  const ref = project.id

  step('Supabase: プロジェクトの状態を確認')
  let status = (await supa(`/v1/projects/${ref}`)).status
  // 一時停止（無料枠の自動ポーズ等）は待っても復帰しないので、復元を試みる
  if (status === 'INACTIVE' || status === 'PAUSED') {
    console.log(`  一時停止中（${status}）のため復元を試みます`)
    try {
      await supa(`/v1/projects/${ref}/restore`, { method: 'POST', body: JSON.stringify({}) })
    } catch (error) {
      fail(`プロジェクトが一時停止しており自動復元に失敗しました（${error.message}）。` +
        `\n  ダッシュボード（https://supabase.com/dashboard/project/${ref}）で「Restore」してから再実行してください。`)
    }
  }
  process.stdout.write('  起動待機')
  for (let i = 0; i < 60; i++) {
    status = (await supa(`/v1/projects/${ref}`)).status
    if (status === 'ACTIVE_HEALTHY') break
    if (status === 'INACTIVE' || status === 'PAUSED') {
      fail(`プロジェクトが一時停止状態のままです（${status}）。ダッシュボードでRestoreしてください。`)
    }
    if (i === 59) fail(`プロジェクトが起動しません（status=${status}）。時間をおいて再実行してください。`)
    process.stdout.write('.')
    await sleep(10_000)
  }
  console.log(' 起動済み')

  // スキーマ適用は「新規作成時のみ」。再利用時は既存スキーマを壊さないためスキップし、
  // 新しいマイグレーションがある場合は手動適用を案内する（成功偽装を避ける）。
  if (created) {
    step('Supabase: スキーマ（supabase/setup_all.sql）を適用')
    const sql = fs.readFileSync('supabase/setup_all.sql', 'utf8')
    await supa(`/v1/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: sql }),
    })
    console.log('  適用しました')
  } else {
    step('Supabase: スキーマ適用をスキップ（既存プロジェクト）')
    console.log('  ⚠ 新しいマイグレーションを追加している場合は、ダッシュボードのSQL Editorで')
    console.log(`     supabase/migrations/ の未適用分を手動実行してください（project: ${ref}）`)
  }

  step('Supabase: anonキー（publishableキー）を取得')
  const keys = await supa(`/v1/projects/${ref}/api-keys?reveal=true`)
  // 旧APIキー（name=anon）と新APIキー（type=publishable）の両方に対応する
  const anonKey =
    keys.find(k => k.name === 'anon')?.api_key ??
    keys.find(k => k.type === 'publishable')?.api_key ??
    keys.find(k => /publishable|anon/i.test(k.name ?? ''))?.api_key
  if (!anonKey) fail('anon/publishableキーが取得できませんでした。ダッシュボードのSettings → APIから手動で取得してください。')

  return { ref, url: `https://${ref}.supabase.co`, anonKey }
}

// ---------------------------------------------------------------------------
// 2. Vercel
// ---------------------------------------------------------------------------
function vercelCli(args) {
  const fullArgs = [`vercel@${VERCEL_CLI_VERSION}`, ...args, '--token', vercelToken]
  if (VERCEL_TEAM_ID) fullArgs.push('--scope', VERCEL_TEAM_ID)
  try {
    return execFileSync('npx', ['-y', ...fullArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(`vercel ${args.join(' ')} が失敗:\n${error.stderr ?? error.message}`)
  }
}

async function getProductionUrl() {
  // プロジェクトの本番エイリアス（固定URL）を取得する。取得できなければnull。
  try {
    const info = await vercel(`/v9/projects/${PROJECT_NAME}`)
    const productionAlias = (info?.alias ?? []).find(
      a => a.target === 'PRODUCTION' || a.environment === 'production'
    )
    if (productionAlias?.domain) return `https://${productionAlias.domain}`
    // フォールバック: 最新の本番デプロイのURL
    const latest = (info?.latestDeployments ?? [])[0]
    if (latest?.url) return `https://${latest.url}`
  } catch { /* 取得失敗時はnull */ }
  return null
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
    // 学習不使用の確認フラグ（本番ではこれが無いと解析が停止する）
    ['AI_NO_TRAINING_CONFIRMED', process.env.AI_NO_TRAINING_CONFIRMED],
  ].filter(([, value]) => Boolean(value))

  const hasAiKey = envVars.some(([key]) =>
    ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].includes(key)
  )
  if (!hasAiKey) {
    console.log('  ⚠ 解析AIのAPIキーが未指定です（解析機能は動きません。後から追加可能）')
  }
  if (process.env.AI_NO_TRAINING_CONFIRMED !== 'true') {
    console.log('  ⚠ AI_NO_TRAINING_CONFIRMED が未設定です。本番では解析が停止します')
    console.log('     docs/AI_DATA_POLICY.md の要件を満たした上で true を設定してください')
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

  step('Vercel: プロジェクトへリンク')
  // linkが失敗すると deploy が別プロジェクトを勝手に作ってしまうため、ここで失敗させる
  vercelCli(['link', '--yes', '--project', PROJECT_NAME])
  console.log('  リンク完了')

  step('Vercel: 本番デプロイ（ソースをアップロードしてリモートビルド。数分かかります）')
  const deployOutput = vercelCli(['deploy', '--prod', '--yes'])
  const deployUrl = (deployOutput.match(/https:\/\/[^\s]+\.vercel\.app/g) ?? []).at(-1)
  if (!deployUrl) fail(`デプロイURLを取得できませんでした。出力:\n${deployOutput}`)
  console.log(`  デプロイ完了: ${deployUrl}`)

  // 認証Site URLには「固定の本番エイリアス」を使う。デプロイ毎URLを固定URLに使うと
  // 次のデプロイで陳腐化し、OAuth/確認メールのリダイレクトが壊れるため。
  const productionUrl = (await getProductionUrl()) ?? deployUrl
  if (productionUrl === deployUrl) {
    console.log('  ⚠ 固定の本番エイリアスを取得できず、デプロイURLを使います。' +
      '独自ドメイン設定後は手順3のURL設定を更新してください。')
  } else {
    console.log(`  本番URL（固定エイリアス）: ${productionUrl}`)
  }

  return { productionUrl }
}

// ---------------------------------------------------------------------------
// 3. 認証リダイレクトURLと疎通確認
// ---------------------------------------------------------------------------
async function configureAuth(supabase, productionUrl) {
  step('Supabase: 認証のSite URLとリダイレクトURLを設定')
  const callback = `${productionUrl}/auth/callback`
  const localCallback = 'http://localhost:3000/auth/callback'

  // 既存の許可リストを保持したまま、必要なURLを追加する（再実行で独自ドメイン等を消さない）
  let existing = []
  try {
    const current = await supa(`/v1/projects/${supabase.ref}/config/auth`)
    existing = (current?.uri_allow_list ?? '').split(',').map(s => s.trim()).filter(Boolean)
  } catch { /* 取得失敗時は新規設定として続行 */ }

  const merged = Array.from(new Set([...existing, callback, localCallback]))

  await supa(`/v1/projects/${supabase.ref}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify({
      site_url: productionUrl,
      uri_allow_list: merged.join(','),
      // なりすまし登録を防ぐため、メール確認を必須にする
      mailer_autoconfirm: false,
    }),
  })
  console.log(`  Site URL: ${productionUrl}`)
  console.log(`  許可リスト: ${merged.join(', ')}`)
  console.log('  メール確認: 必須（mailer_autoconfirm=false）')
}

async function smokeTest(productionUrl) {
  step('疎通確認: /api/health')
  for (let i = 0; i < 18; i++) {
    try {
      const response = await fetch(`${productionUrl}/api/health`)
      if (response.ok) {
        const health = await response.json()
        console.log(`  ${JSON.stringify(health)}`)
        if (!health.supabaseConfigured) {
          console.log('  ⚠ supabaseConfigured=false: 環境変数設定後の再デプロイが必要な可能性があります')
        }
        return true
      }
      // Vercelの保護（Standard Protection）が有効だと401になる
      if (response.status === 401) {
        console.log('  ⚠ 401: VercelのDeployment Protectionが有効な可能性があります' +
          '（Project Settings → Deployment Protection で本番を公開に）')
      }
    } catch { /* リトライ */ }
    await sleep(10_000)
  }
  console.log('  ⚠ ヘルスチェックに到達できませんでした。デプロイ状態をVercelダッシュボードで確認してください。')
  return false
}

// ---------------------------------------------------------------------------
async function main() {
  if (!supabaseToken) fail('SUPABASE_ACCESS_TOKEN が未設定です（https://supabase.com/dashboard/account/tokens で発行）')
  if (!vercelToken) fail('VERCEL_TOKEN が未設定です（https://vercel.com/account/settings/tokens で発行）')
  if (!fs.existsSync('supabase/setup_all.sql')) fail('supabase/setup_all.sql がありません（pnpm db:bundle で生成）')

  const supabase = await provisionSupabase()
  const { productionUrl } = await provisionVercel(supabase)
  await configureAuth(supabase, productionUrl)
  const healthy = await smokeTest(productionUrl)

  console.log('\n============================================================')
  console.log(`${healthy ? '✅ 完了' : '⚠ デプロイは実行しましたが疎通確認が未完了'}: ${productionUrl}`)
  console.log('============================================================')
  console.log('次にやること:')
  console.log('  1. 【最優先】上記URLで最初のアカウントを作成し、組織を作る')
  console.log('     招待制のため、組織を作った時点で以降は招待された人しか登録できなくなります')
  console.log('     （組織が無い間は誰でも登録できるので、デプロイ後すぐに実施してください）')
  console.log('  2. Googleログインを使う場合はSupabaseダッシュボードでProvider設定（docs/SUPABASE_SETUP.md 手順3）')
  console.log('  3. 使い終わったらSUPABASE_ACCESS_TOKENとVERCEL_TOKENを失効させる')
  console.log('  4. mainへのマージで自動デプロイしたい場合はVercelダッシュボードでGitHub連携を有効化')
}

main().catch(error => {
  console.error('\n❌ プロビジョニング失敗:', error.message)
  console.error('再実行すれば途中から続行できます（作成済みリソースは再利用されます）。')
  process.exit(1)
})
