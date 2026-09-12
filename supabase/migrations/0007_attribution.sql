-- Anything the agent wrote, a teacher can rewrite — and when they do, the
-- student should be told whose words they are reading. A correction carrying a
-- name is worth more to a student than an anonymous one, and it keeps the
-- teacher accountable for what goes out under their name.

alter table public.marks
  add column if not exists edited_by uuid references auth.users(id),
  add column if not exists edited_at timestamptz;

alter table public.submissions
  add column if not exists feedback            text,   -- already present; no-op if so
  add column if not exists feedback_edited_by  uuid references auth.users(id),
  add column if not exists feedback_edited_at  timestamptz,
  add column if not exists ai_feedback         text;

-- Preserve what the agent wrote before anyone rewrites it.
update public.submissions
   set ai_feedback = coalesce(ai_feedback, feedback)
 where ai_feedback is null and feedback is not null;

comment on column public.marks.edited_by is
  'The teacher who last rewrote this part''s wording. Shown to the student.';
comment on column public.submissions.ai_feedback is
  'What the agent wrote overall. `feedback` is the live text a student reads.';
