-- Teacher panel: keep what the agent proposed, record who reviewed, and make it
-- impossible to publish a score computed from a transcript that has since changed.

alter table public.marks
  add column if not exists ai_awarded int;

comment on column public.marks.ai_awarded is
  'What the grader proposed, kept when a teacher overrides so the panel can show
   "AI proposed 2 → teacher 3" without replaying the override history.';

-- Backfill: for marks never overridden, the current value is the AI value. For
-- overridden ones, take the oldest recorded old_awarded.
update public.marks m
   set ai_awarded = coalesce(
         (select o.old_awarded from public.overrides o
           where o.submission_id = m.submission_id and o.part = m.part
           order by o.created_at asc limit 1),
         m.awarded)
 where m.ai_awarded is null;

alter table public.submissions
  add column if not exists teacher_feedback text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists marks_stale boolean not null default false;

comment on column public.submissions.teacher_feedback is
  'The teacher''s own note to the student, shown alongside the agent''s feedback.';
comment on column public.submissions.marks_stale is
  'Set when the transcript is edited after grading. Release is blocked until the
   script is marked again, so a published score always matches the text it came from.';

create index if not exists submissions_teacher_panel_idx
  on public.submissions (status, created_at desc);

-- Teachers may write feedback and clear the review fields.
drop policy if exists marks_update_teacher on public.marks;
create policy marks_update_teacher on public.marks
  for update using (public.is_teacher()) with check (public.is_teacher());
