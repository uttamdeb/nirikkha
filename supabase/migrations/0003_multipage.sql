-- A CQ answer often runs to more than one sheet. Keep image_path as the first
-- page so existing rows and readers keep working, and hold the full ordered set
-- alongside it.
alter table public.submissions
  add column if not exists image_paths text[] not null default '{}';

update public.submissions
   set image_paths = array[image_path]
 where image_path is not null and cardinality(image_paths) = 0;

comment on column public.submissions.image_paths is
  'Ordered pages of the script. image_path mirrors the first entry.';
