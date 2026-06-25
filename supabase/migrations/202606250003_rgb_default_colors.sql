-- K-Loud v1.7.0: assign default schedule colors in RGB order.
-- Existing manually selected colors are preserved. Only the old default blue
-- is redistributed across red, green and blue.

alter table public.assignments
  add column if not exists color text not null default '#4778f5';

with default_colored as (
  select
    id,
    row_number() over (partition by team_id order by start_at, created_at, id) as color_index
  from public.assignments
  where color = '#4778f5'
)
update public.assignments a
set color = case ((d.color_index - 1) % 3)
  when 0 then '#ef4444'
  when 1 then '#22c55e'
  else '#3b82f6'
end
from default_colored d
where a.id = d.id;

alter table public.assignments alter column color set default '#ef4444';

select
  'K-Loud RGB default colors installed' as result,
  count(*) filter (where color = '#ef4444') as red_blocks,
  count(*) filter (where color = '#22c55e') as green_blocks,
  count(*) filter (where color = '#3b82f6') as blue_blocks
from public.assignments;
