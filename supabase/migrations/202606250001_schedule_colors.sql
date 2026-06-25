-- K-Loud v1.6.0: custom schedule block colors.
-- Run this entire file once in Supabase SQL Editor.

alter table public.assignments
  add column if not exists color text not null default '#4778f5';

alter table public.assignments
  drop constraint if exists assignments_color_format;
alter table public.assignments
  add constraint assignments_color_format
  check (color ~ '^#[0-9A-Fa-f]{6}$');

drop function if exists public.save_schedule(
  uuid, uuid, uuid, text, timestamp without time zone, timestamp without time zone,
  text, text, text, text, text
);

create or replace function public.save_schedule(
  p_assignment_id uuid,
  p_project_id uuid,
  p_member_id uuid,
  p_title text,
  p_start_at timestamp without time zone,
  p_end_at timestamp without time zone,
  p_status text,
  p_city text,
  p_business_type text,
  p_venue text,
  p_notes text,
  p_color text
)
returns table (assignment_id uuid, project_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  active_team uuid := public.current_team_id();
  saved_project_id uuid;
  saved_assignment_id uuid;
  safe_color text := case
    when coalesce(p_color, '') ~ '^#[0-9A-Fa-f]{6}$' then p_color
    else '#4778f5'
  end;
begin
  if public.current_app_role() not in ('admin','editor') then
    raise exception 'Current account is read-only';
  end if;
  if active_team is null then raise exception 'Account is not assigned to a team'; end if;
  if not exists (
    select 1 from public.members
    where id = p_member_id and team_id = active_team and deleted_at is null
  ) then
    raise exception 'Selected member does not belong to this team';
  end if;

  if p_project_id is null then
    insert into public.projects (team_id, title, city, business_type, venue, notes)
    values (
      active_team, p_title, coalesce(p_city,''), coalesce(p_business_type,'未分类'),
      coalesce(p_venue,''), coalesce(p_notes,'')
    )
    returning id into saved_project_id;
  else
    update public.projects
       set title = p_title,
           city = coalesce(p_city,''),
           business_type = coalesce(p_business_type,'未分类'),
           venue = coalesce(p_venue,''),
           notes = coalesce(p_notes,'')
     where id = p_project_id and team_id = active_team and deleted_at is null
     returning id into saved_project_id;
    if saved_project_id is null then raise exception 'Project does not exist'; end if;
  end if;

  if p_assignment_id is null then
    insert into public.assignments (
      team_id, project_id, member_id, start_at, end_at, status, color
    )
    values (
      active_team, saved_project_id, p_member_id, p_start_at, p_end_at, p_status, safe_color
    )
    returning id into saved_assignment_id;
  else
    update public.assignments
       set member_id = p_member_id,
           start_at = p_start_at,
           end_at = p_end_at,
           status = p_status,
           color = safe_color
     where id = p_assignment_id and team_id = active_team and deleted_at is null
     returning id into saved_assignment_id;
    if saved_assignment_id is null then raise exception 'Assignment does not exist'; end if;
  end if;

  return query select saved_assignment_id, saved_project_id;
end;
$$;

grant execute on function public.save_schedule(
  uuid, uuid, uuid, text, timestamp without time zone, timestamp without time zone,
  text, text, text, text, text, text
) to authenticated;

select
  'K-Loud schedule colors installed' as result,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='assignments' and column_name='color'
  ) as color_ready;
