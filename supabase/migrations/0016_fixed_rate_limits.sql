-- ============================================================================
-- 回数制限の上限と時間幅を、呼び出し側から変えられないようにする
--
-- 0008 の check_rate_limit は上限（p_max_requests）と時間幅（p_window_seconds）を
-- 引数で受け取っていた。RPC は利用者が直接呼べるため、
--   rpc/check_rate_limit {"p_action":"invitation","p_max_requests":1000000,"p_window_seconds":1}
-- を投げると、1秒幅の新しい窓が作られ、同時に「古い窓の掃除」で本来の1時間幅の
-- カウンタが消えた。招待メール・解析の回数制限を、利用者が自分で戻せたことになる。
--
-- 上限と時間幅は操作の種類ごとにDB側で固定し、引数は互換のために受け取るだけで使わない
-- （アプリの呼び出し lib/security/rateLimit.ts を変えずに済ませるため）。
-- 値は lib/security/rateLimit.ts の定数と同じにする。変えるときは両方を直すこと。
-- 知らない種類は例外にする（任意の種類名で、制限のかからない窓を作らせないため）。
-- ============================================================================

create or replace function public.rate_limit_config(p_action text)
returns table (max_requests integer, window_seconds integer)
language sql immutable as $$
  select config.max_requests, config.window_seconds from (values
    ('analysis',   20, 600),
    ('invitation', 10, 3600)
  ) as config(action, max_requests, window_seconds)
  where config.action = p_action
$$;

create or replace function public.check_rate_limit(
  p_action text,
  p_max_requests integer default null,
  p_window_seconds integer default null
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_max integer;
  v_window integer;
  v_window_start timestamptz;
  v_count integer;
begin
  -- 引数の上限・時間幅は使わない（上の説明のとおり）
  select c.max_requests, c.window_seconds into v_max, v_window
    from public.rate_limit_config(p_action) c;
  if v_max is null then
    raise exception 'unknown rate limit action: %', p_action;
  end if;

  if v_user is null then
    return query select false, v_window;
    return;
  end if;

  -- 現在時刻をウィンドウ幅で切り捨て（例: 3600秒なら1時間刻みの境界）
  v_window_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  insert into rate_limits as rl (user_id, action, window_start, request_count)
  values (v_user, p_action, v_window_start, 1)
  on conflict (user_id, action, window_start)
  do update set request_count = rl.request_count + 1
  returning rl.request_count into v_count;

  -- 自分の古いウィンドウを掃除（テーブルの肥大化防止）。時間幅が固定なので、
  -- 掃除で消えるのは本当に終わった窓だけになる
  delete from rate_limits
   where user_id = v_user and action = p_action and window_start < v_window_start;

  if v_count > v_max then
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from (v_window_start + make_interval(secs => v_window) - now())))::integer
      );
  else
    return query select true, 0;
  end if;
end $$;

-- 旧版（引数3つ・既定値なし）と同じ型の並びなので create or replace で置き換わる。
-- 解析用のラッパも、引数を渡さない形にしておく（値は上の設定が正）
create or replace function public.check_analysis_rate_limit(
  p_max_requests integer default 20,
  p_window_seconds integer default 600
)
returns table (allowed boolean, retry_after_seconds integer)
language sql security definer set search_path = public as $$
  select * from public.check_rate_limit('analysis');
$$;
