-- ============================================================================
-- アクセス制御（RLS）の検証。
--
-- 要件のうち次の2点は「画面で出し分ける」のではなく「DB層で到達できない」ことを
-- 求めている。画面のテストでは確かめられないため、SQLで直接検証する。
--
--   N-01: 担当者として割り当てられていない案件のデータには到達できない
--   N-02: 他の事務所のデータは参照できない
--
-- 1件でも FAIL があれば、このスクリプトは終了コード1で失敗する。
-- ============================================================================

\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

-- 検証結果の集計用。RLSは通常ロールにのみ適用されるため、
-- テーブル所有者（superuser）のままでは何も検証できない点に注意
create temp table rls_results (name text, passed boolean);
-- 検証中はロールを authenticated に切り替えるため、記録先にも権限が要る。
-- ここを忘れると記録だけが失敗し、検証をすり抜けたまま「成功」と出てしまう
grant all on rls_results to authenticated;

-- 実行するはずの検証件数は、末尾のDOブロックに定数として書いている。
-- psqlの変数は $$ 〜 $$ の中で展開されないため、変数にはできない

set role authenticated;

-- ---- 1) 担当している案件は見える（制限しすぎていないこと） ----
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into rls_results
select '作業者は担当案件を閲覧できる', count(*) = 1
  from projects where id = 'cccccccc-0000-0000-0000-000000000001';

-- ---- 2) 担当していない同一事務所の案件は見えない（N-01） ----
insert into rls_results
select '作業者は担当外の案件を閲覧できない', count(*) = 0
  from projects where id = 'cccccccc-0000-0000-0000-000000000002';

-- ---- 3) 担当外の家系図データも読めない（N-01） ----
insert into rls_results
select '作業者は担当外の家系図データを読めない', count(*) = 0
  from tree_revisions where project_id = 'cccccccc-0000-0000-0000-000000000002';

-- ---- 4) 他事務所の案件は一切見えない（N-02） ----
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into rls_results
select '他事務所の案件は閲覧できない', count(*) = 0 from projects;

-- ---- 5) 他事務所のメンバー情報も見えない（N-02） ----
insert into rls_results
select '他事務所のメンバーは閲覧できない', count(*) = 0
  from memberships where org_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---- 6) 他事務所の家系図は書き換えられない（N-02） ----
update tree_revisions set version = 999
 where project_id = 'cccccccc-0000-0000-0000-000000000001';
reset role;
insert into rls_results
select '他事務所の家系図を書き換えられない', version = 1
  from tree_revisions where project_id = 'cccccccc-0000-0000-0000-000000000001';
set role authenticated;

-- ---- 7) 管理者は自事務所の全案件が見える ----
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into rls_results
select '管理者は自事務所の全案件を閲覧できる', count(*) = 2 from projects;

-- ---- 8) 作業者は自分を管理者に昇格できない（権限昇格の防止） ----
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update memberships set role = 'admin'
 where user_id = '22222222-2222-2222-2222-222222222222';
insert into rls_results
select '作業者は自分を管理者に昇格できない', role = 'worker'
  from memberships where user_id = '22222222-2222-2222-2222-222222222222';

-- ---- 9) 作業者は招待を作れない（管理者のみ） ----
insert into invitations (org_id, email, role)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'x@example.com', 'admin');
insert into rls_results
select '作業者は招待を作成できない', count(*) = 0
  from invitations where email = 'x@example.com';

-- ---- 10) レート制限のカウンタは直接触れない ----
-- ポリシーを一切作っていないため、RPC経由以外では読み書きできないはず
insert into rls_results
select 'レート制限のカウンタは直接読めない', count(*) = 0 from rate_limits;

reset role;

-- ---- 結果の出力 ----
\echo ''
\echo '=== RLS 検証結果 ==='
select (case when passed then '  PASS  ' else '  FAIL  ' end) || name from rls_results;
\echo ''

select
  '合計 ' || count(*) || '件 / 成功 ' || count(*) filter (where passed) ||
  ' / 失敗 ' || count(*) filter (where not passed)
from rls_results;

-- 失敗、または記録漏れがあれば異常終了させる（CIで検出できるようにする）
\set ON_ERROR_STOP on
do $$
declare
  -- 上の検証の数と一致させること。検証を増やしたらこの値も更新する
  c_expected constant integer := 10;
  v_failed integer;
  v_total integer;
begin
  select count(*) filter (where not passed), count(*)
    into v_failed, v_total
    from rls_results;

  -- 件数の検証は必須。権限不足などで記録自体が落ちると、
  -- 失敗0件として「成功」に見えてしまう（実際にこれで偽の合格が出た）
  if v_total <> c_expected then
    raise exception
      'RLSの検証件数が想定と異なります（実行 % 件 / 想定 % 件）。記録に失敗した項目がある可能性があります',
      v_total, c_expected;
  end if;
  if v_failed > 0 then
    raise exception 'RLSの検証に失敗しました（% 件）', v_failed;
  end if;
end $$;
