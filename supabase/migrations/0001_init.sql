-- Nirikkha — initial schema
-- Marking pipeline for handwritten Bangla CQ (সৃজনশীল প্রশ্ন) answer scripts.
--
-- Lifecycle, driven by submissions.status:
--   received → ocr_running → [awaiting_student] → grading → awaiting_teacher → released
-- Any stage may land in `failed` with submissions.error set.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

do $$ begin
  create type submission_status as enum (
    'received',
    'ocr_running',
    'awaiting_student',   -- low-legibility lines sent back for clarification
    'grading',
    'awaiting_teacher',   -- graded, waiting on human release
    'released',
    'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cq_part as enum ('ka', 'kha', 'ga', 'gha');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

comment on column public.profiles.role is
  'student sees only their own submissions; teacher sees the review queue and may override marks.';

-- Mirror new auth users into profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- submissions

create table if not exists public.submissions (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references auth.users(id) on delete cascade,

  question_text      text not null default '',
  subject            text,
  image_path         text,                       -- key in the `scripts` storage bucket

  status             submission_status not null default 'received',
  error              text,

  needs_human_review boolean not null default false,
  review_reason      text,                       -- low_legibility | grader_uncertain | student_requested

  total_awarded      int,
  total_max          int not null default 10,
  feedback           text,

  ocr_engine         text,                       -- provenance: which adapter produced the lines
  grader_model       text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  released_at        timestamptz,

  constraint total_awarded_in_range
    check (total_awarded is null or (total_awarded >= 0 and total_awarded <= total_max))
);

create index if not exists submissions_student_created_idx
  on public.submissions (student_id, created_at desc);
create index if not exists submissions_status_created_idx
  on public.submissions (status, created_at desc);
create index if not exists submissions_review_queue_idx
  on public.submissions (needs_human_review, created_at desc)
  where status = 'awaiting_teacher';

-- ---------------------------------------------------------------- ocr_lines

create table if not exists public.ocr_lines (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions(id) on delete cascade,
  line_index      int  not null,

  text            text not null default '',
  legibility      numeric check (legibility is null or (legibility >= 0 and legibility <= 1)),
  is_guess        boolean not null default false,
  bbox            jsonb,                          -- {x0,y0,x1,y1} normalised 0..1, origin top-left

  clarified_text  text,                           -- what the student typed when asked
  clarified_at    timestamptz,

  unique (submission_id, line_index)
);

create index if not exists ocr_lines_submission_idx
  on public.ocr_lines (submission_id, line_index);

comment on column public.ocr_lines.legibility is
  '0..1. Engine confidence where the provider reports it, else the model''s self-reported legibility. Compare against LEGIBILITY_THRESHOLD.';
comment on column public.ocr_lines.clarified_text is
  'Set when a human resolved an illegible line. Grading reads coalesce(clarified_text, text).';

-- ---------------------------------------------------------------- marks

create table if not exists public.marks (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  part           cq_part not null,
  max_marks      int  not null,
  awarded        int  not null,
  reason         text,
  evidence_lines jsonb not null default '[]'::jsonb,   -- line_index values backing the decision

  unique (submission_id, part),
  constraint awarded_within_max check (awarded >= 0 and awarded <= max_marks)
);

create index if not exists marks_submission_idx on public.marks (submission_id);

comment on table public.marks is
  'Current mark per CQ part. ক=1 খ=2 গ=3 ঘ=4, total 10. Updated in place by teacher overrides; the audit trail lives in public.overrides.';

-- ---------------------------------------------------------------- overrides (append-only)

create table if not exists public.overrides (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  part          cq_part not null,
  teacher_id    uuid not null references auth.users(id),
  old_awarded   int  not null,
  new_awarded   int  not null,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists overrides_submission_idx
  on public.overrides (submission_id, created_at desc);

comment on table public.overrides is
  'Append-only. Never update or delete a row here — every time a human corrected the agent is evidence of the human-in-the-loop working.';

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists submissions_touch_updated_at on public.submissions;
create trigger submissions_touch_updated_at
  before update on public.submissions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helpers

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher'
  );
$$;

create or replace function public.owns_submission(sub uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.submissions
    where id = sub and student_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------- RLS

alter table public.profiles    enable row level security;
alter table public.submissions enable row level security;
alter table public.ocr_lines   enable row level security;
alter table public.marks       enable row level security;
alter table public.overrides   enable row level security;

-- profiles
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_teacher());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- submissions
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select using (student_id = auth.uid() or public.is_teacher());

drop policy if exists submissions_insert_own on public.submissions;
create policy submissions_insert_own on public.submissions
  for insert with check (student_id = auth.uid());

drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions
  for update using (student_id = auth.uid() or public.is_teacher());

-- ocr_lines
drop policy if exists ocr_lines_select on public.ocr_lines;
create policy ocr_lines_select on public.ocr_lines
  for select using (public.owns_submission(submission_id) or public.is_teacher());

-- The student answering "this line says X" is the only write they may make here.
drop policy if exists ocr_lines_clarify on public.ocr_lines;
create policy ocr_lines_clarify on public.ocr_lines
  for update using (public.owns_submission(submission_id) or public.is_teacher());

-- marks
drop policy if exists marks_select on public.marks;
create policy marks_select on public.marks
  for select using (public.owns_submission(submission_id) or public.is_teacher());

drop policy if exists marks_update_teacher on public.marks;
create policy marks_update_teacher on public.marks
  for update using (public.is_teacher()) with check (public.is_teacher());

-- overrides
drop policy if exists overrides_select on public.overrides;
create policy overrides_select on public.overrides
  for select using (public.owns_submission(submission_id) or public.is_teacher());

drop policy if exists overrides_insert_teacher on public.overrides;
create policy overrides_insert_teacher on public.overrides
  for insert with check (public.is_teacher() and teacher_id = auth.uid());

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scripts', 'scripts', false, 20971520,       -- 20 MB, matching Telegram's getFile cap
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Scripts are filed under <user-id>/<submission-id>.<ext>, so the first path
-- segment is the owner and teachers may read the whole bucket.
drop policy if exists scripts_insert_own on storage.objects;
create policy scripts_insert_own on storage.objects
  for insert with check (
    bucket_id = 'scripts' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists scripts_select on storage.objects;
create policy scripts_select on storage.objects
  for select using (
    bucket_id = 'scripts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher())
  );

drop policy if exists scripts_delete_own on storage.objects;
create policy scripts_delete_own on storage.objects
  for delete using (
    bucket_id = 'scripts' and (storage.foldername(name))[1] = auth.uid()::text
  );
