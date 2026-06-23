# 团队排期总控台

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
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_ANON_KEY=你的Publishable或Anon Key
```

不要在前端配置`service_role`密钥。

## 本地构建

```bash
SUPABASE_URL="https://你的项目.supabase.co" \
SUPABASE_ANON_KEY="你的公开Key" \
npm run build
```

然后使用任意静态服务器打开`dist`目录。

## PWA安装

- iPhone：Safari → 分享 → 添加到主屏幕
- Android/Chrome：菜单 → 安装应用
- macOS/Windows：Chrome地址栏 → 安装
