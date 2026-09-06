-- ============================================================================
-- レート制限を解析以外にも使えるように一般化する
--
-- 招待メールの送信にも回数制限が要るため、操作の種類（action）を持たせた
-- 汎用のテーブルへ移行する。方式は 0006 と同じ固定ウィンドウ＋原子的UPSERT。
--
-- 解析用の check_analysis_rate_limit は呼び出し側（lib/security/rateLimit.ts）が
-- 使い続けるため、汎用関数へ委譲する薄いラッパとして残す。
-- ============================================================================

create table public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 操作の種類。'analysis' / 'invitation' など
  action text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.rate_limits enable row level security;
-- ポリシーは意図的に作らない → APIから直接読み書きできない。
-- 更新は下のsecurity definer関数経由のみ（利用者がカウンタを消せないようにする）。

create or replace function public.check_rate_limit(
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
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
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'action is required';
  end if;
  if p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit parameters';
  end if;

  -- 現在時刻をウィンドウ幅で切り捨て（例: 3600秒なら1時間刻みの境界）
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits as rl (user_id, action, window_start, request_count)
  values (v_user, p_action, v_window_start, 1)
  on conflict (user_id, action, window_start)
  do update set request_count = rl.request_count + 1
  returning rl.request_count into v_count;

  -- 自分の古いウィンドウを掃除（テーブルの肥大化防止）
  delete from rate_limits
   where user_id = v_user and action = p_action and window_start < v_window_start;

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

-- ---------------------------------------------------------------------------
-- 解析用は汎用関数への委譲に置き換える（呼び出し側の変更は不要）
-- ---------------------------------------------------------------------------
create or replace function public.check_analysis_rate_limit(
  p_max_requests integer default 20,
  p_window_seconds integer default 600
)
returns table (allowed boolean, retry_after_seconds integer)
language sql security definer set search_path = public as $$
  select * from public.check_rate_limit('analysis', p_max_requests, p_window_seconds);
$$;

-- 旧テーブルは不要になる。カウンタは短命（ウィンドウ幅の間だけ）なので移行しない
drop table if exists public.analysis_rate_limits;
