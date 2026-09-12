-- Teacher-drawn annotations on the script image.
--
-- These are drawn by a human, not produced by the reader, so they do not depend
-- on the OCR engine reporting bounding boxes. Coordinates are normalised 0..1
-- against the page they sit on, so they survive any zoom or display size.
create table if not exists public.annotations (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  page          int  not null default 0,
  x0 numeric not null check (x0 >= 0 and x0 <= 1),
  y0 numeric not null check (y0 >= 0 and y0 <= 1),
  x1 numeric not null check (x1 >= 0 and x1 <= 1),
  y1 numeric not null check (y1 >= 0 and y1 <= 1),
  note       text,
  colour     text not null default 'red' check (colour in ('red', 'green', 'amber')),
  author_id  uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists annotations_submission_idx
  on public.annotations (submission_id, page, created_at);

alter table public.annotations enable row level security;

drop policy if exists annotations_select on public.annotations;
create policy annotations_select on public.annotations
  for select using (public.owns_submission(submission_id) or public.is_teacher());

drop policy if exists annotations_write_teacher on public.annotations;
create policy annotations_write_teacher on public.annotations
  for all using (public.is_teacher()) with check (public.is_teacher());
