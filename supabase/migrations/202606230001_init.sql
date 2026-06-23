create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'editor', 'viewer');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.groups (
  name text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id text primary key,
  name text not null,
  role text not null,
  group_name text not null references public.groups(name) on update cascade on delete restrict,
  color text not null default '#4778f5',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'viewer',
  person_id text references public.people(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key,
  title text not null,
  owner_id text not null references public.people(id) on update cascade on delete restrict,
  start_at timestamp without time zone not null,
  end_at timestamp without time zone not null,
  status text not null check (status in ('confirmed', 'pending', 'progress', 'draft')),
  city text not null default '',
  business_type text not null default '未分类',
  venue text not null default '',
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_order check (end_at > start_at)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists people_set_updated_at on public.people;
create trigger people_set_updated_at before update on public.people
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer'::public.app_role);
$$;

alter table public.groups enable row level security;
alter table public.people enable row level security;
alter table public.profiles enable row level security;
alter table public.events enable row level security;

drop policy if exists "authenticated read groups" on public.groups;
create policy "authenticated read groups" on public.groups for select to authenticated using (true);
drop policy if exists "admins manage groups" on public.groups;
create policy "admins manage groups" on public.groups for all to authenticated
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

drop policy if exists "authenticated read people" on public.people;
create policy "authenticated read people" on public.people for select to authenticated using (true);
drop policy if exists "admins manage people" on public.people;
create policy "admins manage people" on public.people for all to authenticated
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select to authenticated
using (id = auth.uid() or public.current_app_role() = 'admin');
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles" on public.profiles for update to authenticated
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

drop policy if exists "authenticated read events" on public.events;
create policy "authenticated read events" on public.events for select to authenticated using (true);
drop policy if exists "editors create events" on public.events;
create policy "editors create events" on public.events for insert to authenticated
with check (public.current_app_role() in ('admin', 'editor'));
drop policy if exists "editors update events" on public.events;
create policy "editors update events" on public.events for update to authenticated
using (public.current_app_role() in ('admin', 'editor'))
with check (public.current_app_role() in ('admin', 'editor'));
drop policy if exists "editors delete events" on public.events;
create policy "editors delete events" on public.events for delete to authenticated
using (public.current_app_role() in ('admin', 'editor'));

do $$ begin
  alter publication supabase_realtime add table public.groups;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.people;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $$;

insert into public.groups (name) values
  ('业务一组'), ('业务二组'), ('演出组'), ('内容组'), ('商务组')
on conflict do nothing;

insert into public.people (id, name, role, group_name, color) values
  ('p1','李涛','项目负责人','业务一组','#4778f5'),
  ('p2','安琪','项目执行','业务一组','#ee6a8a'),
  ('p3','董山','项目负责人','业务二组','#8b5cf6'),
  ('p4','许勇','项目执行','业务二组','#16a085'),
  ('p5','黄家明','统筹','演出组','#f59e0b'),
  ('p6','刘洋','项目负责人','演出组','#12a36d'),
  ('p7','王冬','项目执行','演出组','#3b82f6'),
  ('p8','马文钊','项目执行','业务二组','#e879f9'),
  ('p9','石头','现场执行','演出组','#64748b'),
  ('p10','海宝','拍摄执行','内容组','#ef4444'),
  ('p11','耿伊扬','现场执行','演出组','#06b6d4'),
  ('p12','李沛','商务统筹','商务组','#7c3aed'),
  ('p13','大彬彬','项目执行','内容组','#f97316'),
  ('p14','许景','项目执行','商务组','#0891b2'),
  ('p15','马文倒','现场执行','演出组','#4f46e5')
on conflict (id) do nothing;

insert into public.events
  (id,title,owner_id,start_at,end_at,status,city,business_type,venue,notes)
values
  ('e1','品牌直播彩排','p1','2026-06-23 10:00','2026-06-24 18:00','progress','北京','直播','朝阳摄影棚',''),
  ('e2','品牌直播彩排','p2','2026-06-23 10:00','2026-06-24 18:00','progress','北京','直播','朝阳摄影棚',''),
  ('e3','商业活动','p3','2026-06-25 09:00','2026-06-25 19:00','pending','成都','商演','高新区会展中心','等待客户最终流程'),
  ('e4','音乐节演出','p5','2026-06-24 14:00','2026-06-24 23:00','confirmed','上海','音乐节','浦东户外舞台',''),
  ('e5','巡演重庆站','p6','2026-06-26 12:00','2026-06-28 23:00','confirmed','重庆','演唱会','华熙LIVE','含进场和彩排'),
  ('e6','巡演重庆站','p7','2026-06-26 12:00','2026-06-28 23:00','confirmed','重庆','演唱会','华熙LIVE',''),
  ('e7','短视频拍摄','p4','2026-06-28 08:00','2026-06-28 20:00','draft','厦门','拍摄','环岛路摄影基地',''),
  ('e8','商务晚宴','p2','2026-06-29 18:00','2026-06-29 22:00','confirmed','深圳','商务','福田会展中心',''),
  ('e9','品牌发布会','p1','2026-06-26 15:00','2026-06-26 21:00','confirmed','杭州','发布会','国际博览中心',''),
  ('e10','音乐节联排','p5','2026-06-30 13:00','2026-06-30 19:00','pending','沈阳','音乐节','奥体中心','')
on conflict (id) do nothing;

-- Bootstrap the first administrator.
-- The user must already exist under Supabase Authentication > Users.
do $$
declare
  admin_user_id uuid;
begin
  select id
    into admin_user_id
    from auth.users
   where lower(email) = lower('nickh1ph0@gmail.com')
   limit 1;

  if admin_user_id is null then
    raise exception
      'Administrator user nickh1ph0@gmail.com was not found. Create this user in Authentication > Users, then run this script again.';
  end if;

  insert into public.profiles (id, full_name, role)
  values (admin_user_id, '管理员', 'admin')
  on conflict (id) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        updated_at = now();
end
$$;

-- Keep a permanent audit trail for every schedule creation, edit and deletion.
create table if not exists public.event_audit_logs (
  id bigint generated by default as identity primary key,
  event_id text not null,
  event_title text not null default '',
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '系统',
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists event_audit_logs_created_at_idx
  on public.event_audit_logs (created_at desc);
create index if not exists event_audit_logs_event_id_idx
  on public.event_audit_logs (event_id);

alter table public.event_audit_logs enable row level security;
drop policy if exists "authenticated read event audit logs" on public.event_audit_logs;
create policy "authenticated read event audit logs"
  on public.event_audit_logs for select to authenticated using (true);

create or replace function public.audit_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_label text;
  target_id text;
  target_title text;
begin
  select coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), '系统')
    into actor_label
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = auth.uid();

  target_id := case when tg_op = 'DELETE' then old.id else new.id end;
  target_title := case when tg_op = 'DELETE' then old.title else new.title end;

  insert into public.event_audit_logs (
    event_id, event_title, action, actor_id, actor_name, old_data, new_data
  )
  values (
    target_id, target_title, lower(tg_op), auth.uid(), coalesce(actor_label, '系统'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists events_audit_change on public.events;
create trigger events_audit_change
after insert or update or delete on public.events
for each row execute function public.audit_event_change();

do $$ begin
  alter publication supabase_realtime add table public.event_audit_logs;
exception when duplicate_object then null;
end $$;
