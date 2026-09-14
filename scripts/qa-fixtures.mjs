#!/usr/bin/env node
/* eslint-disable no-console */
// ============================================================================
// 実機確認のための下ごしらえ。
//
// テストで押さえられない挙動（保管期間・同時編集）は、実際に動かさないと
// 確認できない。とくに**保管期間は30日待たないと確かめられない**ため、
// 取り込み日時をさかのぼらせる手段を用意する。
//
// 使い方:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/qa-fixtures.mjs <コマンド>
//
//   list                        案件と戸籍ファイルの一覧（idを確認する）
//   expire <ファイルid>          取り込み日時を31日前にする（保管期間切れを再現）
//   unexpire <ファイルid>        取り込み日時をいまに戻す
//   status                      Realtimeの配信設定を確認する
//
// **サービスロールキーを使う。** RLSを迂回するため、本番の鍵を安易に扱わないこと。
// 確認用の案件に対してだけ使う想定で、データの中身は表示しない（idと件数のみ）。
// ============================================================================

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です')
  process.exit(1)
}

const base = `${url.replace(/\/$/, '')}/rest/v1`
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function rest(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  return text ? JSON.parse(text) : null
}

async function list() {
  const projects = await rest('/projects?select=id,name,org_id&order=created_at.desc&limit=20')
  for (const project of projects) {
    console.log(`\n案件 ${project.name}  ${project.id}`)
    const files = await rest(
      `/koseki_files?select=id,file_name,created_at,document_group_id,page_number,analysis_status` +
        `&project_id=eq.${project.id}&order=created_at.desc&limit=50`
    )
    if (files.length === 0) {
      console.log('  （戸籍ファイルなし）')
      continue
    }
    for (const file of files) {
      const days = Math.floor((Date.now() - new Date(file.created_at).getTime()) / 86_400_000)
      const expired = days >= 30 ? ' ← 保管期間切れ' : ''
      console.log(
        `  ${file.id}  ${file.file_name}  取り込み${days}日前  ` +
          `束${file.document_group_id.slice(0, 8)}/${file.page_number}枚目  ${file.analysis_status}${expired}`
      )
    }
  }
}

async function setCreatedAt(fileId, iso, label) {
  const updated = await rest(`/koseki_files?id=eq.${fileId}&select=id,file_name,created_at`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ created_at: iso }),
  })
  if (!updated || updated.length === 0) {
    console.error(`ファイル ${fileId} が見つかりません`)
    process.exit(1)
  }
  console.log(`${updated[0].file_name} の取り込み日時を${label}にしました（${updated[0].created_at}）`)
}

async function status() {
  const [row] = await rest('/rpc/realtime_enabled_for_trees', { method: 'POST', body: '{}' })
    .then(value => [value])
    .catch(() => [null])
  console.log(`Realtimeの配信（tree_revisions）: ${row === true ? '有効' : row === false ? '無効' : '確認できず'}`)
  if (row !== true) {
    console.log('  → Supabase の Database → Replication で tree_revisions を有効にしてください')
    console.log('     （無効でも保存は動くため、他の人の変更が入らないという形でしか現れません）')
  }
}

const [command, argument] = process.argv.slice(2)

try {
  if (command === 'list') await list()
  else if (command === 'expire') {
    if (!argument) throw new Error('ファイルidを指定してください')
    await setCreatedAt(argument, new Date(Date.now() - 31 * 86_400_000).toISOString(), '31日前')
  } else if (command === 'unexpire') {
    if (!argument) throw new Error('ファイルidを指定してください')
    await setCreatedAt(argument, new Date().toISOString(), 'いま')
  } else if (command === 'status') await status()
  else {
    console.log('使い方: node scripts/qa-fixtures.mjs <list|expire <id>|unexpire <id>|status>')
    process.exit(1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
