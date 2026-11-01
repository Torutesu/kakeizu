-- ============================================================================
-- 戸籍解析の費用の記録と、月の予算の判定
--
-- 解析はGeminiのAPIで行い、費用はGoogleのサブスク枠のクレジット等の
-- 決まった月額の中に収めたい。そのため解析1回ごとの消費トークンと見積もり原価を記録し、
-- 当月の合計が予算（環境変数 ANALYSIS_MONTHLY_BUDGET_USD）に達したら解析を止める。
--
-- 記録と集計はサーバー（解析API）だけが行う。テーブルにはポリシーを作らず、
-- 下の関数もサービスロールにしか実行を許さない。
-- 利用者が呼べると、架空の高額な記録で全事務所の解析を止めたり（予算の枯渇）、
-- 他事務所を含む利用額を覗いたりできてしまうため。
-- 予算は配備全体で1つ（解析に使うGoogleアカウントのクレジットが1つのため）。
-- ============================================================================

create table if not exists public.analysis_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  file_id uuid references public.koseki_files(id) on delete set null,
  -- 'primary'（解析）または 'cross_check'（照合のための2つ目の読み取り）
  role text not null check (role in ('primary', 'cross_check')),
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  -- 見積もり原価（USD）。単価が分からないモデルは null（合計には含まれない）
  cost_usd numeric(12, 6)
);

create index if not exists analysis_usage_created_at_idx on public.analysis_usage (created_at);

alter table public.analysis_usage enable row level security;
-- ポリシーは意図的に作らない → APIから直接読み書きできない。

-- このマイグレーションの初版にあった、利用者から呼べる版（引数8個）が残っていれば消す。
-- 引数が変わると create or replace は別の関数を作るため、残すと利用者が記録を偽造できてしまう
drop function if exists public.record_analysis_usage(uuid, uuid, text, text, integer, integer, integer, numeric);

-- 解析1回分の消費を記録する（サーバーのみ）
create or replace function public.record_analysis_usage(
  p_user uuid,
  p_project uuid,
  p_file uuid,
  p_role text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_cost_usd numeric
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_cost_usd is not null and p_cost_usd < 0 then
    raise exception 'cost must not be negative';
  end if;
  insert into public.analysis_usage
    (user_id, project_id, file_id, role, model, input_tokens, output_tokens, cached_input_tokens, cost_usd)
  values
    (p_user, p_project, p_file, p_role, p_model, p_input_tokens, p_output_tokens, p_cached_input_tokens, p_cost_usd);
end;
$$;

-- 当月（日本時間）の見積もり原価の合計（USD）。月の予算の判定に使う（サーバーのみ）
create or replace function public.analysis_cost_this_month()
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0)
  from public.analysis_usage
  where created_at >= (date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo');
$$;

revoke all on function public.record_analysis_usage(uuid, uuid, uuid, text, text, integer, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.analysis_cost_this_month() from public, anon, authenticated;
grant execute on function public.record_analysis_usage(uuid, uuid, uuid, text, text, integer, integer, integer, numeric) to service_role;
grant execute on function public.analysis_cost_this_month() to service_role;
