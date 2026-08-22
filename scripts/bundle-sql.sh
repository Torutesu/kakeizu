#!/usr/bin/env bash
# supabase/migrations/*.sql を番号順に結合して supabase/setup_all.sql を生成する。
# マイグレーションを追加・変更したら `pnpm db:bundle` で再生成すること。
set -euo pipefail
cd "$(dirname "$0")/.."
out="supabase/setup_all.sql"
{
  echo "-- ============================================================================"
  echo "-- 自動生成ファイル: supabase/migrations/*.sql を番号順に結合したもの。"
  echo "-- 新規Supabaseプロジェクトのセットアップ時に、SQL Editorへこのファイルを"
  echo "-- 1回貼り付けて実行する。個別のマイグレーションを編集したら pnpm db:bundle で再生成。"
  echo "-- ============================================================================"
  for f in supabase/migrations/*.sql; do
    echo ""
    echo "-- ----- ${f} -----"
    cat "$f"
  done
} > "$out"
echo "generated: $out"
