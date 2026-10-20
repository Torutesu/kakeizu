-- ============================================================================
-- Realtime のチャンネルを、案件を見られる人だけが購読できるようにする
--
-- 同時編集の在席表示と入力中の下書き（hooks/useProjectCollaboration.ts）は
-- broadcast / presence で流している。broadcast はテーブルを経由しないため RLS が
-- かからず、公開チャンネルのままだと、公開されている anon キーと案件ID
-- （URLに出る）さえあれば、ログインしていない人でも入力中の氏名・本籍などを
-- 受け取れる経路になっていた。
--
-- Supabase の Realtime Authorization（private チャンネル）を使い、
-- realtime.messages のポリシーで購読・送信を判定する。
--   collab:project:{案件ID}  … 購読と在席は案件を見られる人、下書きの送信は編集できる人
--   tree_revisions:{案件ID}  … 購読は案件を見られる人（中身は tree_revisions の RLS でも絞られる）
--
-- 公開チャンネルを残すと、同じ名前の公開チャンネルで盗み聞きできる余地が残るため、
-- 適用後に Supabase のダッシュボードで Realtime の「Allow public access」を切ること
-- （docs/DEPLOY.md）。
--
-- realtime スキーマは Supabase が用意する。無い環境（素の Postgres）では何もしない。
-- ============================================================================

-- チャンネル名から案件IDを取り出す。形が違えば null（どのポリシーも通らない）
create or replace function public.realtime_topic_project(p_topic text, p_prefix text)
returns uuid language sql immutable as $$
  select case
    when p_topic like p_prefix || '%' then public.try_cast_uuid(substr(p_topic, length(p_prefix) + 1))
  end
$$;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages が無いため、Realtime の権限設定をスキップします';
    return;
  end if;

  execute 'drop policy if exists "project viewers can receive realtime" on realtime.messages';
  execute $p$
    create policy "project viewers can receive realtime"
      on realtime.messages for select to authenticated
      using (
        public.can_view_project(public.realtime_topic_project(realtime.topic(), 'collab:project:'))
        or public.can_view_project(public.realtime_topic_project(realtime.topic(), 'tree_revisions:'))
      )
  $p$;

  execute 'drop policy if exists "project members can send realtime" on realtime.messages';
  execute $p$
    create policy "project members can send realtime"
      on realtime.messages for insert to authenticated
      with check (
        (realtime.messages.extension = 'presence'
          and public.can_view_project(public.realtime_topic_project(realtime.topic(), 'collab:project:')))
        or (realtime.messages.extension = 'broadcast'
          and public.can_edit_project(public.realtime_topic_project(realtime.topic(), 'collab:project:')))
      )
  $p$;
end $$;
