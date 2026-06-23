-- K-Loud security, recovery and backup hardening.
-- Run this entire file once in Supabase SQL Editor.

alter table public.members add column if not exists deleted_at timestamptz;
alter table public.members add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.projects add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.assignments add column if not exists deleted_at timestamptz;
alter table public.assignments add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists members_active_team_idx
  on public.members(team_id) where deleted_at is null;
create index if not exists projects_active_team_idx
  on public.projects(team_id) where deleted_at is null;
create index if not exists assignments_active_member_time_idx
  on public.assignments(member_id, start_at, end_at) where deleted_at is null;

create table if not exists public.team_backups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists team_backups_team_created_idx
  on public.team_backups(team_id, created_at desc);

alter table public.team_backups enable row level security;

drop policy if exists "admins read team backups" on public.team_backups;
create policy "admins read team backups" on public.team_backups for select to authenticated
using (team_id = public.current_team_id() and public.current_app_role() = 'admin');

drop policy if exists "admins create team backups" on public.team_backups;
create policy "admins create team backups" on public.team_backups for insert to authenticated
with check (team_id = public.current_team_id() and public.current_app_role() = 'admin');

drop policy if exists "admins delete team backups" on public.team_backups;
create policy "admins delete team backups" on public.team_backups for delete to authenticated
using (team_id = public.current_team_id() and public.current_app_role() = 'admin');

drop policy if exists "team users read members" on public.members;
create policy "team users read members" on public.members for select to authenticated
using (team_id = public.current_team_id() and deleted_at is null);

drop policy if exists "admins manage members" on public.members;
create policy "admins manage members" on public.members for all to authenticated
using (team_id = public.current_team_id() and deleted_at is null and public.current_app_role() = 'admin')
with check (team_id = public.current_team_id() and deleted_at is null and public.current_app_role() = 'admin');

drop policy if exists "team users read projects" on public.projects;
create policy "team users read projects" on public.projects for select to authenticated
using (team_id = public.current_team_id() and deleted_at is null);

drop policy if exists "editors manage projects" on public.projects;
create policy "editors manage projects" on public.projects for all to authenticated
using (team_id = public.current_team_id() and deleted_at is null and public.current_app_role() in ('admin','editor'))
with check (team_id = public.current_team_id() and deleted_at is null and public.current_app_role() in ('admin','editor'));

drop policy if exists "team users read assignments" on public.assignments;
create policy "team users read assignments" on public.assignments for select to authenticated
using (team_id = public.current_team_id() and deleted_at is null);

drop policy if exists "editors manage assignments" on public.assignments;
create policy "editors manage assignments" on public.assignments for all to authenticated
using (team_id = public.current_team_id() and deleted_at is null and public.current_app_role() in ('admin','editor'))
with check (team_id = public.current_team_id() and deleted_at is null and public.current_app_role() in ('admin','editor'));

create or replace function public.delete_schedule(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_team uuid := public.current_team_id();
  linked_project uuid;
begin
  if public.current_app_role() not in ('admin','editor') then
    raise exception 'Current account is read-only';
  end if;

  update public.assignments
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_assignment_id and team_id = active_team and deleted_at is null
  returning project_id into linked_project;

  if linked_project is null then raise exception 'Assignment does not exist'; end if;

  if not exists (
    select 1 from public.assignments
    where project_id = linked_project and deleted_at is null
  ) then
    update public.projects
       set deleted_at = now(), deleted_by = auth.uid()
     where id = linked_project and team_id = active_team;
  end if;
end;
$$;

create or replace function public.restore_schedule(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_team uuid := public.current_team_id();
  linked_project uuid;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can restore schedules';
  end if;

  select project_id into linked_project
  from public.assignments
  where id = p_assignment_id and team_id = active_team and deleted_at is not null;

  if linked_project is null then raise exception 'Deleted schedule does not exist'; end if;

  update public.projects
     set deleted_at = null, deleted_by = null
   where id = linked_project and team_id = active_team;

  update public.assignments
     set deleted_at = null, deleted_by = null
   where id = p_assignment_id and team_id = active_team;
end;
$$;

create or replace function public.list_deleted_schedules()
returns table (
  assignment_id uuid,
  project_id uuid,
  title text,
  member_name text,
  start_at timestamp without time zone,
  end_at timestamp without time zone,
  deleted_at timestamptz,
  deleted_by_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can view deleted schedules';
  end if;
  return query
  select
    a.id, p.id, p.title, m.name, a.start_at, a.end_at, a.deleted_at,
    coalesce(nullif(pr.full_name,''), '团队成员')
  from public.assignments a
  join public.projects p on p.id = a.project_id
  join public.members m on m.id = a.member_id
  left join public.profiles pr on pr.id = a.deleted_by
  where a.team_id = public.current_team_id() and a.deleted_at is not null
  order by a.deleted_at desc;
end;
$$;

create or replace function public.create_team_backup(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_team uuid := public.current_team_id();
  backup_id uuid;
  backup_snapshot jsonb;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can create backups';
  end if;

  select jsonb_build_object(
    'version', 1,
    'created_at', now(),
    'team', (select to_jsonb(t) from public.teams t where t.id = active_team),
    'members', coalesce((select jsonb_agg(to_jsonb(m)) from public.members m where m.team_id = active_team), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(to_jsonb(p)) from public.projects p where p.team_id = active_team), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(a)) from public.assignments a where a.team_id = active_team), '[]'::jsonb)
  ) into backup_snapshot;

  insert into public.team_backups(team_id, name, snapshot)
  values (
    active_team,
    coalesce(nullif(trim(p_name),''), '手动备份 ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    backup_snapshot
  )
  returning id into backup_id;

  return backup_id;
end;
$$;

create or replace function public.restore_team_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_team uuid := public.current_team_id();
  payload jsonb;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can restore backups';
  end if;

  select snapshot into payload
  from public.team_backups
  where id = p_backup_id and team_id = active_team;
  if payload is null then raise exception 'Backup does not exist'; end if;

  update public.teams
     set name = coalesce(payload->'team'->>'name', name),
         groups = coalesce(
           array(select jsonb_array_elements_text(payload->'team'->'groups')),
           groups
         )
   where id = active_team;

  insert into public.members(id, team_id, legacy_id, name, role, group_name, color, created_at, updated_at, deleted_at, deleted_by)
  select id, active_team, legacy_id, name, role, group_name, color, created_at, updated_at, deleted_at, deleted_by
  from jsonb_to_recordset(payload->'members') as x(
    id uuid, team_id uuid, legacy_id text, name text, role text, group_name text, color text,
    created_at timestamptz, updated_at timestamptz, deleted_at timestamptz, deleted_by uuid
  )
  on conflict (id) do update set
    name=excluded.name, role=excluded.role, group_name=excluded.group_name, color=excluded.color,
    deleted_at=excluded.deleted_at, deleted_by=excluded.deleted_by, updated_at=now();

  insert into public.projects(id, team_id, legacy_event_id, title, city, business_type, venue, notes, created_by, created_at, updated_at, deleted_at, deleted_by)
  select id, active_team, legacy_event_id, title, city, business_type, venue, notes, created_by, created_at, updated_at, deleted_at, deleted_by
  from jsonb_to_recordset(payload->'projects') as x(
    id uuid, team_id uuid, legacy_event_id text, title text, city text, business_type text,
    venue text, notes text, created_by uuid, created_at timestamptz, updated_at timestamptz,
    deleted_at timestamptz, deleted_by uuid
  )
  on conflict (id) do update set
    title=excluded.title, city=excluded.city, business_type=excluded.business_type,
    venue=excluded.venue, notes=excluded.notes, deleted_at=excluded.deleted_at,
    deleted_by=excluded.deleted_by, updated_at=now();

  insert into public.assignments(id, team_id, project_id, member_id, start_at, end_at, status, created_by, created_at, updated_at, deleted_at, deleted_by)
  select id, active_team, project_id, member_id, start_at, end_at, status, created_by, created_at, updated_at, deleted_at, deleted_by
  from jsonb_to_recordset(payload->'assignments') as x(
    id uuid, team_id uuid, project_id uuid, member_id uuid, start_at timestamp,
    end_at timestamp, status text, created_by uuid, created_at timestamptz,
    updated_at timestamptz, deleted_at timestamptz, deleted_by uuid
  )
  on conflict (id) do update set
    project_id=excluded.project_id, member_id=excluded.member_id, start_at=excluded.start_at,
    end_at=excluded.end_at, status=excluded.status, deleted_at=excluded.deleted_at,
    deleted_by=excluded.deleted_by, updated_at=now();
end;
$$;

create or replace function public.admin_update_account(
  target_user_id uuid,
  target_member_id uuid,
  target_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_name text;
  previous_role public.app_role;
  admin_count integer;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can manage accounts';
  end if;

  select role into previous_role
  from public.profiles
  where id = target_user_id and team_id = public.current_team_id();
  if previous_role is null then raise exception 'Account does not belong to this team'; end if;

  if previous_role = 'admin' and target_role <> 'admin' then
    select count(*) into admin_count
    from public.profiles
    where team_id = public.current_team_id() and role = 'admin';
    if admin_count <= 1 then
      raise exception 'Cannot demote the last administrator';
    end if;
  end if;

  if target_member_id is not null then
    select name into linked_name
    from public.members
    where id = target_member_id
      and team_id = public.current_team_id()
      and deleted_at is null;
    if linked_name is null then raise exception 'Selected member does not belong to this team'; end if;
  end if;

  update public.profiles
     set member_id = target_member_id,
         person_id = null,
         role = target_role,
         full_name = coalesce(linked_name, nullif(full_name,''), '团队成员'),
         updated_at = now()
   where id = target_user_id and team_id = public.current_team_id();
end;
$$;

create or replace function public.get_permission_diagnostics()
returns table (
  role public.app_role,
  can_edit_schedules boolean,
  can_manage_team boolean,
  can_manage_accounts boolean,
  can_restore_data boolean,
  rls_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_app_role(),
    public.current_app_role() in ('admin','editor'),
    public.current_app_role() = 'admin',
    public.current_app_role() = 'admin',
    public.current_app_role() = 'admin',
    coalesce((
      select bool_and(c.relrowsecurity)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public'
        and c.relname in ('teams','members','projects','assignments','team_backups')
    ), false);
$$;

-- Classify soft deletion/restoration correctly in the audit log.
do $$
declare constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  where c.conrelid = 'public.event_audit_logs'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%action%';
  if constraint_name is not null then
    execute format('alter table public.event_audit_logs drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.event_audit_logs
  add constraint event_audit_logs_action_check
  check (action in ('insert','update','delete','restore'));

create or replace function public.audit_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_label text;
  project_title text;
  effective_action text;
  target_project_id uuid;
  target_team_id uuid;
  target_assignment_id uuid;
begin
  if tg_op = 'DELETE' then
    target_project_id := old.project_id;
    target_team_id := old.team_id;
    target_assignment_id := old.id;
  else
    target_project_id := new.project_id;
    target_team_id := new.team_id;
    target_assignment_id := new.id;
  end if;

  select title into project_title
  from public.projects
  where id = target_project_id;

  select coalesce(nullif(p.full_name,''), split_part(u.email,'@',1), '系统')
    into actor_label
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = auth.uid();

  effective_action := lower(tg_op);
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    effective_action := 'delete';
  elsif tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null then
    effective_action := 'restore';
  end if;

  insert into public.event_audit_logs (
    team_id, event_id, event_title, action, actor_id, actor_name, old_data, new_data
  ) values (
    target_team_id,
    target_assignment_id::text,
    coalesce(project_title, '未命名项目'),
    effective_action,
    auth.uid(),
    coalesce(actor_label,'系统'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on public.teams, public.members, public.projects, public.assignments,
  public.profiles, public.event_audit_logs, public.team_backups from anon;
revoke execute on function public.delete_schedule(uuid) from anon;
revoke execute on function public.restore_schedule(uuid) from anon;
revoke execute on function public.list_deleted_schedules() from anon;
revoke execute on function public.create_team_backup(text) from anon;
revoke execute on function public.restore_team_backup(uuid) from anon;
revoke execute on function public.admin_list_accounts() from anon;
revoke execute on function public.admin_update_account(uuid, uuid, public.app_role) from anon;
revoke execute on function public.get_permission_diagnostics() from anon;

grant select, insert, delete on public.team_backups to authenticated;
grant execute on function public.delete_schedule(uuid) to authenticated;
grant execute on function public.restore_schedule(uuid) to authenticated;
grant execute on function public.list_deleted_schedules() to authenticated;
grant execute on function public.create_team_backup(text) to authenticated;
grant execute on function public.restore_team_backup(uuid) to authenticated;
grant execute on function public.admin_update_account(uuid, uuid, public.app_role) to authenticated;
grant execute on function public.get_permission_diagnostics() to authenticated;

do $$ begin alter publication supabase_realtime add table public.team_backups;
exception when duplicate_object then null; end $$;

select
  'K-Loud security and recovery installed' as result,
  has_function_privilege('authenticated', 'public.restore_schedule(uuid)', 'execute') as recovery_ready,
  has_function_privilege('authenticated', 'public.get_permission_diagnostics()', 'execute') as diagnostics_ready,
  (select relrowsecurity from pg_class where oid='public.team_backups'::regclass) as backup_rls_enabled;
