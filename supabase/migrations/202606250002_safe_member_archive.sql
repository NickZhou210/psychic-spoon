-- K-Loud v1.6.1: safely archive members without breaking assignment history.
-- Run this entire file once in Supabase SQL Editor.

alter table public.members add column if not exists deleted_at timestamptz;
alter table public.members add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.assignments add column if not exists deleted_at timestamptz;

create or replace function public.archive_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_team uuid := public.current_team_id();
  member_name text;
  active_assignment_count integer;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can archive members';
  end if;

  select name into member_name
  from public.members
  where id = p_member_id
    and team_id = active_team
    and deleted_at is null;
  if member_name is null then raise exception 'Member does not exist'; end if;

  select count(*) into active_assignment_count
  from public.assignments
  where member_id = p_member_id
    and team_id = active_team
    and deleted_at is null;
  if active_assignment_count > 0 then
    raise exception 'Member still has % active schedules', active_assignment_count;
  end if;

  -- Keep profiles valid, but remove the link to an archived member.
  update public.profiles
     set member_id = null,
         updated_at = now()
   where team_id = active_team
     and member_id = p_member_id;

  update public.members
     set deleted_at = now(),
         deleted_by = auth.uid(),
         updated_at = now()
   where id = p_member_id
     and team_id = active_team
     and deleted_at is null;
end;
$$;

revoke execute on function public.archive_member(uuid) from anon;
grant execute on function public.archive_member(uuid) to authenticated;

select
  'K-Loud safe member archive installed' as result,
  has_function_privilege('authenticated', 'public.archive_member(uuid)', 'execute') as archive_ready;
