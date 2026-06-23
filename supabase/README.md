# Supabase初始化

1. 创建Supabase项目。
2. 打开SQL Editor。
3. 执行 `migrations/202606230001_init.sql`。
4. 在Authentication中创建第一个用户。
5. 执行以下SQL，将第一个用户设为管理员：

```sql
update public.profiles
set role = 'admin', full_name = '管理员', person_id = 'p1'
where id = (
  select id from auth.users
  where email = '你的管理员邮箱'
);
```

后续账号默认是 `viewer`。管理员可以在Table Editor的`profiles`表中调整：

- `admin`：管理日程、成员、小组和账号权限
- `editor`：查看和编辑日程
- `viewer`：只读

将`person_id`设置为对应成员ID后，“我的日程”会显示该成员的排期。
