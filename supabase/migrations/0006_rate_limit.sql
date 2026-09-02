-- ============================================================================
-- 解析APIのレート制限（分散対応）
--
-- 従来はNode.jsプロセス内のメモリで数えていたため、Vercelのようにインスタンスが
-- 複数起動する環境では実質すり抜けられた。カウンタをPostgresに置くことで、
-- どのインスタンスから来ても同一の上限が効くようにする（新しい外部サービス不要）。
--
-- 方式は固定ウィンドウ。現在時刻をウィンドウ幅で切り捨てたものをキーにして、
-- UPSERTで原子的にインクリメントする（同時実行でも数え漏れが起きない）。
-- ============================================================================

create table public.analysis_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, window_start)
);

alter table public.analysis_rate_limits enable row level security;
-- ポリシーは意図的に作らない → APIから直接読み書きできない。
-- 更新は下のsecurity definer関数経由のみ（利用者がカウンタを消せないようにする）。

create or replace function public.check_analysis_rate_limit(
  p_max_requests integer default 20,
  p_window_seconds integer default 600
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_window_start timestamptz;
  v_count integer;
begin
  if v_user is null then
    return query select false, p_window_seconds;
    return;
  end if;
  if p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit parameters';
  end if;

  -- 現在時刻をウィンドウ幅で切り捨て（例: 600秒なら10分刻みの境界）
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into analysis_rate_limits as arl (user_id, window_start, request_count)
  values (v_user, v_window_start, 1)
  on conflict (user_id, window_start)
  do update set request_count = arl.request_count + 1
  returning arl.request_count into v_count;

  -- 自分の古いウィンドウを掃除（テーブルの肥大化防止）
  delete from analysis_rate_limits
   where user_id = v_user and window_start < v_window_start;

  if v_count > p_max_requests then
    return query select
      false,
      greatest(
        1,
        ceil(
          extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now()))
        )::integer
      );
  else
    return query select true, 0;
  end if;
end $$;
