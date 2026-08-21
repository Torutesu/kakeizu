-- ============================================================================
-- 戸籍ファイルの保存（Supabase Storage + メタデータテーブル）
--
-- 戸籍PDFは案件に紐づけてプライベートバケットに保存し、閲覧は署名付きURLで行う。
-- ストレージのパスは {project_id}/{file_id}.pdf 形式とし、RLSで案件の
-- can_view_project / can_edit_project を適用してテナント・権限を強制する。
-- ============================================================================

-- パスから取り出した文字列がUUIDでない場合にポリシー評価を失敗させないための安全なキャスト
create or replace function public.try_cast_uuid(p text)
returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create table public.koseki_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  file_size integer not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  -- pending: 未解析 / success: 解析成功 / failed: 解析失敗
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'success', 'failed')),
  analysis_error text,
  analyzed_at timestamptz,
  person_count integer,
  family_count integer,
  created_at timestamptz not null default now()
);

create index koseki_files_project_idx on public.koseki_files (project_id, created_at desc);

alter table public.koseki_files enable row level security;

create policy "koseki files are visible to project viewers"
  on public.koseki_files for select
  using (public.can_view_project(project_id));

create policy "editors can add koseki files"
  on public.koseki_files for insert
  with check (public.can_edit_project(project_id));

create policy "editors can update koseki files"
  on public.koseki_files for update
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy "editors can delete koseki files"
  on public.koseki_files for delete
  using (public.can_edit_project(project_id));

-- ---------------------------------------------------------------------------
-- ストレージバケット（非公開・PDFのみ・20MB上限）
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('koseki', 'koseki', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy "koseki objects are readable by project viewers"
  on storage.objects for select
  using (
    bucket_id = 'koseki'
    and public.can_view_project(public.try_cast_uuid((storage.foldername(name))[1]))
  );

create policy "koseki objects are writable by project editors"
  on storage.objects for insert
  with check (
    bucket_id = 'koseki'
    and public.can_edit_project(public.try_cast_uuid((storage.foldername(name))[1]))
  );

create policy "koseki objects are deletable by project editors"
  on storage.objects for delete
  using (
    bucket_id = 'koseki'
    and public.can_edit_project(public.try_cast_uuid((storage.foldername(name))[1]))
  );

-- ---------------------------------------------------------------------------
-- 監査ログの操作者をprofilesと結合できるようにする（監査ログ閲覧UI用）
-- ---------------------------------------------------------------------------

alter table public.audit_logs
  add constraint audit_logs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
