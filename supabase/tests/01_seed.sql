\set ON_ERROR_STOP on
-- ============================================================
-- 検証用のデータ。2つの事務所と3人の利用者。
-- A事務所には2案件あり、worker-a は片方だけを担当している。
-- ============================================
-- 招待制トリガは検証データの投入を妨げるため外す（本トリガ自体は別途検証する）
drop trigger if exists before_auth_user_created_enforce_invite on auth.users;

-- Supabaseが既定で付与する権限
grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant usage on schema auth to authenticated;
grant select on auth.users to authenticated;
-- 2つの事務所と3人の利用者を用意
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin-a@example.com'),
  ('22222222-2222-2222-2222-222222222222','worker-a@example.com'),
  ('33333333-3333-3333-3333-333333333333','admin-b@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin-a@example.com'),
  ('22222222-2222-2222-2222-222222222222','worker-a@example.com'),
  ('33333333-3333-3333-3333-333333333333','admin-b@example.com')
on conflict do nothing;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','A事務所'),
  ('bbbbbbbb-0000-0000-0000-000000000002','B事務所');
insert into public.memberships (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','admin'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','worker'),
  ('bbbbbbbb-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333','admin');

-- A事務所に2案件。worker-a は project1 のみ担当
insert into public.projects (id, org_id, name, created_by) values
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','担当あり案件','11111111-1111-1111-1111-111111111111'),
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','担当なし案件','11111111-1111-1111-1111-111111111111');
insert into public.project_members (project_id, user_id) values
  ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

-- 案件の作成時にトリガが空の家系図を作るため、ここでは値を揃えるだけにする
update public.tree_revisions
   set data = '{"people":[],"families":[]}'::jsonb, version = 1
 where project_id in (
   'cccccccc-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002'
 );
