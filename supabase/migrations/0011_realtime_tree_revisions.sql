-- ============================================================================
-- 家系図の同時編集（要件v1.1 4.5）
--
-- 他の利用者の保存を画面へ自動反映するため、tree_revisions の変更を
-- Realtime で配信できるようにする。publication に入れないと購読しても何も届かない。
--
-- 配信内容にもRLSが適用されるため、担当外の案件の更新は届かない
-- （Supabase の Realtime は購読者の権限で行を評価する）。
-- ============================================================================

do $$
begin
  -- supabase_realtime はSupabaseが用意する publication。
  -- 検証用のPostgresには存在しないため、無い場合は何もしない
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime が無いため、Realtimeの設定をスキップします';
    return;
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tree_revisions'
  ) then
    return;
  end if;

  alter publication supabase_realtime add table public.tree_revisions;
end $$;
