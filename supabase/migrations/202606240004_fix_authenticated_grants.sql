-- Fix "permission denied for table profiles" after successful login.
-- RLS policies control which rows are available; these grants allow the
-- authenticated role to reach the tables in the first place.

grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;

grant select on public.teams to authenticated;
grant update on public.teams to authenticated;

grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

grant select on public.event_audit_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_team_id() to authenticated;
grant execute on function public.save_schedule(
  uuid, uuid, uuid, text, timestamp without time zone, timestamp without time zone,
  text, text, text, text, text
) to authenticated;
grant execute on function public.delete_schedule(uuid) to authenticated;
grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_update_account(uuid, uuid, public.app_role) to authenticated;
grant execute on function public.get_schedule_system_status() to authenticated;

select
  'K-Loud authenticated grants installed' as result,
  has_table_privilege('authenticated', 'public.profiles', 'select') as profiles_select,
  has_table_privilege('authenticated', 'public.members', 'select') as members_select,
  has_table_privilege('authenticated', 'public.projects', 'select') as projects_select,
  has_table_privilege('authenticated', 'public.assignments', 'select') as assignments_select;
