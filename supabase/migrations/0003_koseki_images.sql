-- ============================================================================
-- 戸籍書類の画像対応（JPEG / PNG / WebP）
--
-- 複数枚の画像に分かれた戸籍（スマホ撮影など）をアップロードできるようにする。
-- ============================================================================

-- ファイルのMIMEタイプを保持する（解析時にGeminiへ正しい形式を伝えるため）
alter table public.koseki_files
  add column mime_type text not null default 'application/pdf'
  check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'));

-- ストレージバケットの許可タイプを拡張する
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id = 'koseki';
