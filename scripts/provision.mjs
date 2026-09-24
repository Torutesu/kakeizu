/* eslint-disable no-console */
// ============================================================================
// 本番環境の全自動プロビジョニング。
//
// Supabaseプロジェクトの作成 → スキーマ適用 → Vercelデプロイ → 認証URL設定 →
// 疎通確認までを一括で行う。冪等（既存の同名プロジェクトがあれば再利用）なので、
// 途中で失敗しても再実行すればよい。
//
// 前提の構成: Vercel Pro ＋ Supabase Pro（どちらも東京）。docs/DEPLOY.md「構成と費用」
//   - Vercel Hobby は規約で商用利用不可。事務所の業務で使う以上 Pro（個人アカウントのまま Pro にできる）
//   - Supabase Free は1週間使わないと停止し、自動バックアップも無い
//   どちらも無料枠のままなら**作り始める前に止める**（確認用の環境だけ ALLOW_FREE_PLAN=true で通す）
//
// 必要な環境変数:
//   SUPABASE_ACCESS_TOKEN  https://supabase.com/dashboard/account/tokens で発行
//   VERCEL_TOKEN           https://vercel.com/account/settings/tokens で発行
//   VERCEL_TEAM_ID         Vercel Pro のチームID（省略時は個人アカウントの既定チーム。個人で Pro 契約ならそれでよい）
//   GEMINI_API_KEY         解析AI（1つ以上。ANTHROPIC_API_KEY / OPENAI_API_KEY も可）
//
// 実行:
//   SUPABASE_ACCESS_TOKEN=... VERCEL_TOKEN=... GEMINI_API_KEY=... node scripts/provision.mjs
//
// オプション環境変数:
//   PROJECT_NAME           プロジェクト名（既定: kakeizu）
//   SUPABASE_REGION        リージョン（既定: ap-northeast-1 = 東京）
//   SUPABASE_ORG_ID        複数組織がある場合に指定（省略時は最初の組織）
//   VERCEL_CLI_VERSION     使用するVercel CLIのバージョン（既定: 48）
//   ALLOW_FREE_PLAN        true で無料枠のまま続行する（確認用の環境に限る）
//
// 招待メールの送信元（本番では実質必須。未指定だと招待メールが事務所の人に届かない）:
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
//   SMTP_SENDER_EMAIL      送信元アドレス（例: no-reply@example.jp）
//   SMTP_SENDER_NAME       送信者名（既定: 家系図システム）
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
const ALLOW_FREE_PLAN = process.env.ALLOW_FREE_PLAN === 'true'
// サーバー処理を置く場所。vercel.json の regions と揃えること（Supabaseの東京に寄せる）
const VERCEL_REGION = 'hnd1'

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
// 0. プランの確認
//
// 作ってから「無料枠だった」と気づくと、停止・バックアップ無しの環境に戸籍が
// 入ってしまう。**何も作らないうちに止める。**
// ---------------------------------------------------------------------------
function requirePaidPlan(service, plan, hint) {
  if (plan && !['free', 'hobby'].includes(String(plan).toLowerCase())) {
    console.log(`  ${service}: ${plan}`)
    return
  }
  if (!plan) {
    console.log(`  ⚠ ${service}: プランを確認できませんでした。${hint}`)
    return
  }
  if (ALLOW_FREE_PLAN) {
    console.log(`  ⚠ ${service}: 無料枠（${plan}）のまま続行します（ALLOW_FREE_PLAN=true）。確認用の環境に限ってください`)
    return
  }
  fail(`${service} が無料枠（${plan}）です。${hint}\n` +
    '  確認用の環境として無料枠のまま作る場合のみ ALLOW_FREE_PLAN=true を付けて再実行してください。')
}

async function checkPlans() {
  step('プランを確認（Vercel Pro ＋ Supabase Pro の前提）')

  const orgs = await supa('/v1/organizations')
  const orgId = process.env.SUPABASE_ORG_ID || orgs?.[0]?.id
  let supabasePlan = null
  if (orgId) {
    try {
      supabasePlan = (await supa(`/v1/organizations/${orgId}`))?.plan ?? null
    } catch { /* 確認できない場合は警告だけにする */ }
  }
  requirePaidPlan(
    'Supabase',
    supabasePlan,
    'プランは組織単位です。ダッシュボードの Organization → Billing で Pro にしてください' +
      '（Freeは1週間使わないと停止し、自動バックアップもありません）。'
  )

  // 個人アカウントも内部では「既定のチーム」になっており、それを Pro にすれば個人で契約できる。
  // VERCEL_TEAM_ID が無ければ、デプロイ先になる既定のチームのプランを見る
  let teamId = VERCEL_TEAM_ID
  if (!teamId) {
    try {
      teamId = (await api(VERCEL_API, vercelToken, '/v2/user'))?.user?.defaultTeamId ?? ''
    } catch { /* 確認できない場合は警告だけにする */ }
  }
  let vercelPlan = null
  if (teamId) {
    try {
      const team = await api(VERCEL_API, vercelToken, `/v2/teams/${teamId}`)
      vercelPlan = team?.billing?.plan ?? null
    } catch (error) {
      if (VERCEL_TEAM_ID) {
        fail(`VERCEL_TEAM_ID=${VERCEL_TEAM_ID} のチームにアクセスできません（${error.message}）。` +
          'トークンのスコープにこのチームが含まれているか確認してください。')
      }
    }
  }
  requirePaidPlan(
    'Vercel',
    vercelPlan,
    'Settings → Billing で Pro にしてください（Hobbyは規約で商用利用不可。' +
      '個人アカウントのまま Pro にできる。別のチームに置く場合は VERCEL_TEAM_ID を指定）。'
  )
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

  step('Supabase: APIキーを取得')
  const keys = await supa(`/v1/projects/${ref}/api-keys?reveal=true`)
  // 旧APIキー（name=anon/service_role）と新APIキー（type=publishable/secret）の両方に対応する
  const anonKey =
    keys.find(k => k.name === 'anon')?.api_key ??
    keys.find(k => k.type === 'publishable')?.api_key ??
    keys.find(k => /publishable|anon/i.test(k.name ?? ''))?.api_key
  if (!anonKey) fail('anon/publishableキーが取得できませんでした。ダッシュボードのSettings → APIから手動で取得してください。')

  // 招待メールの送信に必要（ブラウザには送らず、サーバー側のルートでのみ使う）。
  // これが無いと招待レコードは作られるがメールが一通も飛ばない
  const serviceRoleKey =
    keys.find(k => k.name === 'service_role')?.api_key ??
    keys.find(k => k.type === 'secret')?.api_key ??
    keys.find(k => /service_role|secret/i.test(k.name ?? ''))?.api_key
  if (!serviceRoleKey) {
    console.log('  ⚠ service_roleキーが取得できませんでした。招待メールは送信されません')
    console.log('     ダッシュボードのSettings → APIから取得し、VercelにSUPABASE_SERVICE_ROLE_KEYとして設定してください')
  } else {
    console.log('  anon / service_role の両方を取得しました')
  }

  return { ref, url: `https://${ref}.supabase.co`, anonKey, serviceRoleKey }
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
    // ⚠ NEXT_PUBLIC_ を付けないこと。RLSを完全に迂回するキーで、付けるとブラウザに露出する
    ['SUPABASE_SERVICE_ROLE_KEY', supabase.serviceRoleKey],
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
  if (!supabase.serviceRoleKey) {
    console.log('  ⚠ SUPABASE_SERVICE_ROLE_KEY が未設定です。招待は作成されますがメールは届きません')
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
  let currentSmtpHost = ''
  try {
    const current = await supa(`/v1/projects/${supabase.ref}/config/auth`)
    existing = (current?.uri_allow_list ?? '').split(',').map(s => s.trim()).filter(Boolean)
    currentSmtpHost = current?.smtp_host ?? ''
  } catch { /* 取得失敗時は新規設定として続行 */ }

  const merged = Array.from(new Set([...existing, callback, localCallback]))

  await supa(`/v1/projects/${supabase.ref}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify({
      site_url: productionUrl,
      uri_allow_list: merged.join(','),
      // なりすまし登録を防ぐため、メール確認を必須にする
      mailer_autoconfirm: false,
      ...smtpConfig(),
    }),
  })
  console.log(`  Site URL: ${productionUrl}`)
  console.log(`  許可リスト: ${merged.join(', ')}`)
  console.log('  メール確認: 必須（mailer_autoconfirm=false）')

  if (smtpConfig().smtp_host) {
    console.log(`  招待メールの送信元: ${process.env.SMTP_SENDER_EMAIL}（${process.env.SMTP_HOST}）`)
  } else if (!currentSmtpHost) {
    // Supabase標準の送信は、Supabaseのチームメンバー宛てにしか届かず件数も絞られる。
    // **事務所の人に招待メールが届かない**ため、本番では送信元の設定が要る
    console.log('  ⚠ 招待メールの送信元（SMTP）が未設定です。このままでは事務所の人に招待メールが届きません')
    console.log('     SMTP_HOST 等を付けて再実行するか、Authentication → Emails → SMTP Settings で設定してください')
    console.log('     （docs/DEPLOY.md「招待メールの送信元」）')
  }
}

/** 招待メールの送信元。すべてそろっているときだけ設定する（一部だけ入れると送信が壊れる） */
function smtpConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SENDER_EMAIL } = process.env
  if (!SMTP_HOST) return {}
  const lack = Object.entries({ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SENDER_EMAIL })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (lack.length > 0) fail(`SMTP_HOST を指定する場合は ${lack.join(', ')} も必要です`)
  return {
    smtp_host: SMTP_HOST,
    smtp_port: String(SMTP_PORT),
    smtp_user: SMTP_USER,
    smtp_pass: SMTP_PASS,
    smtp_admin_email: SMTP_SENDER_EMAIL,
    smtp_sender_name: process.env.SMTP_SENDER_NAME || '家系図システム',
  }
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
        if (health.region && health.region !== VERCEL_REGION) {
          console.log(`  ⚠ サーバー処理が ${health.region} で動いています（想定は ${VERCEL_REGION}＝東京）。` +
            'vercel.json の regions が反映されているか確認してください')
        } else if (health.region === VERCEL_REGION) {
          console.log('  サーバー処理の場所: 東京（hnd1）')
        }
        if (health.realtimeEnabled !== true) {
          console.log('  ⚠ realtimeEnabled が true ではありません。Database → Replication で tree_revisions を有効にしてください')
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

  // 送信元の指定漏れは、作り始めてからではなく最初に止める
  smtpConfig()
  await checkPlans()
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
  console.log('  2. Supabaseダッシュボード → Authentication → Providers で Google が無効であることを確認')
  console.log('     （メールアドレスのみの運用にしているため。有効だと認可エンドポイント経由で認証が成立しうる）')
  console.log('  3. 使い終わったらSUPABASE_ACCESS_TOKENとVERCEL_TOKENを失効させる')
  console.log('  3b. 請求の上限: Vercel は Settings → Billing → Spend Management で上限を設定、')
  console.log('      Supabase は Spend Cap を有効のままにする（想定外の請求を止めるため）')
  console.log('  4. mainへのマージで自動デプロイしたい場合はVercelダッシュボードでGitHub連携を有効化')
  console.log('  5. 動作確認は docs/RELEASE_CHECKLIST.md 「4. 手動での動作確認」に従う')
}

main().catch(error => {
  console.error('\n❌ プロビジョニング失敗:', error.message)
  console.error('再実行すれば途中から続行できます（作成済みリソースは再利用されます）。')
  process.exit(1)
})
