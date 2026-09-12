-- Classroom structure: Telegram bot, batches, exams.
-- Submissions may still be free-form (exam_id null) via the web upload path.

do $$ begin
  create type exam_status as enum ('draft', 'published', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type publish_mode as enum ('auto', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_source as enum ('manual', 'generated');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- org settings (singleton)

create table if not exists public.org_settings (
  id                        uuid primary key default gen_random_uuid(),
  telegram_bot_token_enc    text,
  webhook_secret            text,
  bot_username              text,
  bot_connected             boolean not null default false,
  ocr_confidence_threshold  double precision not null default 0.65,
  publish_mode              publish_mode not null default 'admin',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists org_settings_touch_updated_at on public.org_settings;
create trigger org_settings_touch_updated_at
  before update on public.org_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- telegram groups

create table if not exists public.telegram_groups (
  id         uuid primary key default gen_random_uuid(),
  chat_id    text not null unique,
  title      text not null,
  synced_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- batches

create table if not exists public.batches (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  telegram_group_id  uuid references public.telegram_groups(id) on delete set null,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists batches_telegram_group_idx on public.batches (telegram_group_id);

drop trigger if exists batches_touch_updated_at on public.batches;
create trigger batches_touch_updated_at
  before update on public.batches
  for each row execute function public.touch_updated_at();

create table if not exists public.batch_members (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.batches(id) on delete cascade,
  telegram_user_id  text not null,
  display_name      text not null,
  student_number    int,
  is_group_admin    boolean not null default false,
  user_id           uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (batch_id, telegram_user_id),
  unique (batch_id, student_number)
);

create index if not exists batch_members_telegram_idx on public.batch_members (telegram_user_id);
create index if not exists batch_members_batch_idx on public.batch_members (batch_id, student_number);

-- ---------------------------------------------------------------- exams

create table if not exists public.exams (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  exam_code             text unique,
  status                exam_status not null default 'draft',
  publish_mode          publish_mode,
  batch_id              uuid references public.batches(id) on delete set null,
  published_at          timestamptz,
  telegram_message_id   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists exams_status_idx on public.exams (status);
create index if not exists exams_batch_idx on public.exams (batch_id);
create index if not exists exams_code_idx on public.exams (exam_code);

drop trigger if exists exams_touch_updated_at on public.exams;
create trigger exams_touch_updated_at
  before update on public.exams
  for each row execute function public.touch_updated_at();

create table if not exists public.questions (
  id                uuid primary key default gen_random_uuid(),
  exam_id           uuid not null references public.exams(id) on delete cascade,
  type              text not null default 'cq',
  prompt_text       text not null default '',
  probable_answer   text,
  rubric_json       jsonb,
  total_marks       int not null default 10,
  source            question_source not null default 'manual',
  "order"           int not null default 0,
  approved          boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists questions_exam_idx on public.questions (exam_id);

drop trigger if exists questions_touch_updated_at on public.questions;
create trigger questions_touch_updated_at
  before update on public.questions
  for each row execute function public.touch_updated_at();

create table if not exists public.exam_assets (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references public.exams(id) on delete cascade,
  storage_path   text not null,
  mime_type      text not null,
  original_name  text not null,
  created_at     timestamptz not null default now()
);

create index if not exists exam_assets_exam_idx on public.exam_assets (exam_id);

-- ---------------------------------------------------------------- bot sessions

create table if not exists public.bot_sessions (
  id                 uuid primary key default gen_random_uuid(),
  telegram_user_id   text not null unique,
  state              text not null default 'idle',
  exam_id            uuid references public.exams(id) on delete set null,
  payload            jsonb,
  updated_at         timestamptz not null default now()
);

drop trigger if exists bot_sessions_touch_updated_at on public.bot_sessions;
create trigger bot_sessions_touch_updated_at
  before update on public.bot_sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- submissions classroom FKs

alter table public.submissions
  add column if not exists exam_id uuid references public.exams(id) on delete set null;

alter table public.submissions
  add column if not exists batch_member_id uuid references public.batch_members(id) on delete set null;

alter table public.submissions
  add column if not exists telegram_chat_id text;

alter table public.submissions
  add column if not exists telegram_message_id text;

create index if not exists submissions_exam_idx on public.submissions (exam_id);
create index if not exists submissions_batch_member_idx on public.submissions (batch_member_id);

create unique index if not exists submissions_exam_member_uidx
  on public.submissions (exam_id, batch_member_id)
  where exam_id is not null and batch_member_id is not null;

-- ---------------------------------------------------------------- RLS

alter table public.org_settings enable row level security;
alter table public.telegram_groups enable row level security;
alter table public.batches enable row level security;
alter table public.batch_members enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.exam_assets enable row level security;
alter table public.bot_sessions enable row level security;

-- Teachers manage classroom tables; students may read their own membership and published exams.
drop policy if exists org_settings_teacher on public.org_settings;
create policy org_settings_teacher on public.org_settings
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists telegram_groups_teacher on public.telegram_groups;
create policy telegram_groups_teacher on public.telegram_groups
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists batches_teacher on public.batches;
create policy batches_teacher on public.batches
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists batches_select_member on public.batches;
create policy batches_select_member on public.batches
  for select using (
    exists (
      select 1 from public.batch_members m
      where m.batch_id = batches.id and m.user_id = auth.uid()
    )
  );

drop policy if exists batch_members_teacher on public.batch_members;
create policy batch_members_teacher on public.batch_members
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists batch_members_select_own on public.batch_members;
create policy batch_members_select_own on public.batch_members
  for select using (user_id = auth.uid());

drop policy if exists exams_teacher on public.exams;
create policy exams_teacher on public.exams
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists exams_select_published on public.exams;
create policy exams_select_published on public.exams
  for select using (
    status = 'published'
    and exists (
      select 1 from public.batch_members m
      where m.batch_id = exams.batch_id and m.user_id = auth.uid()
    )
  );

drop policy if exists questions_teacher on public.questions;
create policy questions_teacher on public.questions
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists questions_select_published on public.questions;
create policy questions_select_published on public.questions
  for select using (
    exists (
      select 1 from public.exams e
      join public.batch_members m on m.batch_id = e.batch_id
      where e.id = questions.exam_id
        and e.status = 'published'
        and m.user_id = auth.uid()
    )
  );

drop policy if exists exam_assets_teacher on public.exam_assets;
create policy exam_assets_teacher on public.exam_assets
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists bot_sessions_teacher on public.bot_sessions;
create policy bot_sessions_teacher on public.bot_sessions
  for select using (public.is_teacher());
