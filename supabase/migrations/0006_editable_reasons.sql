-- A teacher can rewrite what a mark says, not only what it is.
--
-- Same shape as ai_awarded: the live value is what the student reads, and the
-- agent's original is kept beside it so an edit is visible rather than silently
-- replacing the agent's words.
alter table public.marks
  add column if not exists ai_reason      text,
  add column if not exists ai_improvement text;

update public.marks
   set ai_reason      = coalesce(ai_reason, reason),
       ai_improvement = coalesce(ai_improvement, improvement)
 where ai_reason is null or ai_improvement is null;

comment on column public.marks.ai_reason is
  'What the agent wrote. `reason` is the live text; if they differ, a teacher rewrote it.';
