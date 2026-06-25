# K-Loud

## 云端数据架构

业务数据只保存在 Supabase：

- `teams`：团队与小组配置
- `members`：团队成员
- `projects`：项目资料
- `assignments`：成员排班

浏览器本地不保存业务数据，也不会在云端连接失败时回退到示例数据。

现有项目升级时，在 Supabase SQL Editor 完整执行：

`supabase/migrations/202606240003_cloud_data_model.sql`

基于Cloudflare Pages与Supabase的团队实时排期PWA。

## 架构

- Cloudflare Pages：前端托管、HTTPS和自动部署
- Supabase Auth：邮箱密码登录
- Supabase PostgreSQL：日程、成员、小组和权限
- Supabase Realtime：跨设备实时同步
- Row Level Security：服务端强制权限

## 权限

- `admin`：管理日程、成员、小组和账号权限
- `editor`：查看和编辑日程
- `viewer`：只读

## v1.5.0 安全与恢复升级

部署前，在 Supabase SQL Editor 完整执行：

`supabase/migrations/202606240005_security_recovery_conflicts.sql`

升级后提供：

- 最后一个管理员保护与 RLS 权限自检
- 日程软删除、最近删除恢复
- 云端数据快照、JSON 下载及快照恢复
- 撞期和跨城赶场预警

## v1.6.0 日程展示与导出

部署前，在 Supabase SQL Editor 完整执行：

`supabase/migrations/202606250001_schedule_colors.sql`

升级后支持：

- 每条日程独立选择色块颜色
- 排期色块直接显示备注
- 当前筛选结果导出 CSV
- 生成横向打印页并保存为 PDF

## Supabase初始化

按照 [supabase/README.md](supabase/README.md) 执行数据库迁移，并创建第一个管理员账号。

## Cloudflare Pages

在Cloudflare Pages中连接本GitHub仓库：

- Framework preset：None
- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：留空

增加环境变量：

```text
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的Publishable或Anon Key
```

不要在前端配置`service_role`密钥。

## 本地构建

```bash
VITE_SUPABASE_URL="https://你的项目.supabase.co" \
VITE_SUPABASE_ANON_KEY="你的公开Key" \
npm run build
```

然后使用任意静态服务器打开`dist`目录。

## PWA安装

- iPhone：Safari → 分享 → 添加到主屏幕
- Android/Chrome：菜单 → 安装应用
- macOS/Windows：Chrome地址栏 → 安装
