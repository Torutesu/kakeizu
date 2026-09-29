#!/usr/bin/env bash
# ============================================================================
# マイグレーションの適用とアクセス制御（RLS）の検証。
#
# 本番へ出す前に、マイグレーションが実際に通ること、および
# 担当外・他事務所のデータへ到達できないことを確かめる。
#
# 使い方:
#   scripts/verify-db.sh                      # 一時的なPostgresを起動して検証
#   DATABASE_URL=postgres://... scripts/verify-db.sh   # 既存のDBに対して検証
#
# 環境変数:
#   DATABASE_URL  接続先。未指定なら一時的なPostgresを起動する
#   PG_BIN        Postgresのbinディレクトリ（既定: /usr/lib/postgresql/16/bin）
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${PG_BIN:-}" ]; then
  if command -v pg_config >/dev/null 2>&1; then
    PG_BIN="$(pg_config --bindir)"
  elif command -v brew >/dev/null 2>&1 && [ -d "$(brew --prefix postgresql@16 2>/dev/null)/bin" ]; then
    PG_BIN="$(brew --prefix postgresql@16)/bin"
  else
    PG_BIN="/usr/lib/postgresql/16/bin"
  fi
fi
export PATH="$PG_BIN:$PATH"
# Linuxのroot環境だけユーザーを切り替える。macOS等では現在の利用者で起動する。
run_pg() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}
TEMP_PG=""

cleanup() {
  if [ -n "$TEMP_PG" ] && [ -d "$TEMP_PG" ]; then
    run_pg "$PG_BIN/pg_ctl" -D "$TEMP_PG" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$TEMP_PG"
  fi
}
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  echo "▶ 一時的なPostgresを起動します"
  TEMP_PG="$(mktemp -d /var/tmp/kakeizu-pg-XXXXXX)"
  PORT="${PGPORT:-55432}"
  # postgresはrootで起動できないため、postgresユーザーで実行する
  if [ "$(id -u)" -eq 0 ]; then chown postgres:postgres "$TEMP_PG"; fi
  chmod 700 "$TEMP_PG"
  run_pg "$PG_BIN/initdb" -D "$TEMP_PG" -U postgres --auth=trust >/dev/null
  run_pg "$PG_BIN/pg_ctl" -D "$TEMP_PG" -o "-p $PORT -k $TEMP_PG -h 127.0.0.1" -l "$TEMP_PG/server.log" start >/dev/null
  # 起動完了を待つ
  for _ in $(seq 1 30); do
    if psql -h "$TEMP_PG" -p "$PORT" -U postgres -c 'select 1' >/dev/null 2>&1; then break; fi
    sleep 1
  done
  psql -h "$TEMP_PG" -p "$PORT" -U postgres -q -c 'create database kakeizu_verify;'
  DATABASE_URL="postgres://postgres@localhost:$PORT/kakeizu_verify?host=$TEMP_PG"
fi

run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

echo "▶ setup_all.sql が最新か確認します"
# 初回セットアップではこのファイルをSQL Editorに貼って実行するため、
# マイグレーションから外れていると「古いスキーマで構築される」ことになる
before="$(cat "$ROOT/supabase/setup_all.sql" 2>/dev/null || true)"
bash "$ROOT/scripts/bundle-sql.sh" >/dev/null
if [ "$before" != "$(cat "$ROOT/supabase/setup_all.sql")" ]; then
  echo "   ❌ setup_all.sql がマイグレーションと一致していません。pnpm db:bundle で再生成してコミットしてください"
  exit 1
fi
echo "   OK（マイグレーションと一致）"

echo "▶ Supabase相当のスキーマを用意します"
run -f "$ROOT/supabase/tests/00_supabase_stub.sql"

echo "▶ マイグレーションを適用します"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '   %s ... ' "$(basename "$f")"
  run -f "$f"
  echo "OK"
done

echo "▶ 検証データを投入します"
run -f "$ROOT/supabase/tests/01_seed.sql"

echo "▶ アクセス制御を検証します"
psql "$DATABASE_URL" -f "$ROOT/supabase/tests/02_rls.sql"

echo "▶ setup_all.sql を単体で適用できるか確認します"
# 個別のマイグレーションが通っても、結合したファイルが通るとは限らない
# （順序や重複定義の問題が結合時にだけ出ることがある）
BUNDLE_URL="${DATABASE_URL/kakeizu_verify/kakeizu_bundle}"
if [ "$BUNDLE_URL" != "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" -q -c 'create database kakeizu_bundle;' >/dev/null 2>&1 || true
  psql "$BUNDLE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_stub.sql"
  psql "$BUNDLE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/setup_all.sql"
  echo "   OK"
else
  echo "   スキップ（既存DBへの接続時）"
fi

echo ""
echo "✅ マイグレーションとアクセス制御の検証に成功しました"
