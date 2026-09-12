-- Per-part improvement guidance: what the student should write to earn the
-- marks they missed. A reason explains the score; this tells them what to do.
alter table public.marks
  add column if not exists improvement text;

comment on column public.marks.improvement is
  'Actionable, part-specific guidance in Bangla. Empty when the part scored full marks.';
