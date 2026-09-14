-- ============================================================================
-- 同時編集の配信が有効かを、画面から確かめられるようにする。
--
-- Realtime が無効でも**保存は動く**ため、設定漏れに気づきにくい。
-- 「他の人の変更が入ってこない」という形でしか現れず、しかもそれは
-- 「誰も編集していないだけ」と見分けがつかない。
--
-- /api/health から真偽値で確認できるようにして、公開前の確認項目にする。
-- 返すのは設定の有無だけで、データは一切含まない。
-- ============================================================================

create or replace function public.realtime_enabled_for_trees()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tree_revisions'
  )
$$;

-- ヘルスチェックは未ログインでも叩けるようにしている（設定漏れの確認用）
grant execute on function public.realtime_enabled_for_trees() to anon, authenticated;
