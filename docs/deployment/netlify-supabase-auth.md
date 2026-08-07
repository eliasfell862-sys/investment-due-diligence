# Netlify + Supabase 证券账户部署

本说明用于部署第一批多用户证券账户基础：邮箱注册、邮箱验证、登录、密码重置和证券路由保护。基金数据修复及证券个人数据迁移不属于本批次。

## 1. 建立线上 Supabase 项目

1. 在 Supabase 新建正式项目。
2. 打开 **Authentication → Providers → Email**。
3. 开启邮箱注册和邮箱验证。正式环境不得关闭邮箱验证。
4. 打开 **Authentication → URL Configuration**，设置以下地址：
   - Site URL：`https://<site>.netlify.app`
   - Redirect URL：`https://<site>.netlify.app/login`
   - Redirect URL：`https://<site>.netlify.app/login?reset=1`
   - Redirect URL：`http://localhost:5173/login`
5. 在 Project Settings → API 保存以下公开值：
   - Project URL
   - anon public key
6. 不要复制 service_role key、数据库密码或邮件服务密码到前端、Git 或 Netlify。

## 2. 推送数据库迁移

在项目的 `app` 目录运行：

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

推送后确认 `public.handle_new_user()` 和 `on_auth_user_created` 触发器存在。每个新注册账户应自动生成一条 `profiles` 记录。

## 3. 配置 Netlify 构建

在 Netlify 项目中使用以下配置：

- Base directory：`app`
- Build command：`npm run build`
- Publish directory：`dist`
- Node.js：满足项目 `package.json` 中的 engines 要求

设置以下环境变量：

- `VITE_SUPABASE_URL`：线上 Supabase Project URL
- `VITE_SUPABASE_ANON_KEY`：线上 Supabase anon public key

不要在 Netlify 设置任何以 `VITE_` 开头的 service role、数据库密码或邮件服务密码。生产构建会拒绝缺失配置、环回地址和可识别的 service-role 凭据。

## 4. 手动上传 dist

如果不使用 Git 自动部署，需要先在本地 `app` 目录设置线上公开变量，再重新构建：

```powershell
$env:VITE_SUPABASE_URL='https://<project-ref>.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='<anon-public-key>'
npm run build
Remove-Item Env:VITE_SUPABASE_URL
Remove-Item Env:VITE_SUPABASE_ANON_KEY
```

只上传新生成的 `app/dist`。直接上传旧的 `dist` 会继续携带旧构建时写入的配置。

## 5. 构建产物检查

在 `app` 目录执行：

```powershell
Test-Path dist/_redirects
rg -n "127\.0\.0\.1:54321|localhost:54321|service_role" dist/assets
```

要求：

- `Test-Path` 输出 `True`。
- 搜索不应找到本地 Supabase 地址或 `service_role`。
- `_redirects` 内容必须为 `/* /index.html 200`，确保 Netlify 刷新深层证券路由时回退到 SPA 入口。

## 6. 正式环境验收

1. 未登录打开 `/securities/watchlist`，应跳转到 `/login`。
2. 注册新邮箱，应收到验证邮件；未验证前不能完成登录。
3. 验证后登录，应进入 `/securities` 或登录前访问的证券路径。
4. 点击忘记密码，重置邮件应返回 `/login?reset=1`。
5. 刷新 `/securities/stock/600519`，Netlify 不应返回 404。
6. 两个不同邮箱同时登录时，会话互不覆盖。
7. 同一邮箱在两个浏览器登录时，两边会话均保持有效。
8. 退出登录后，不应继续显示上一账户的证券页面。
9. 确认现有个股分析页面和基金模块没有因账户入口改造而改变算法或数据接口。

后续批次完成自选股、持仓、策略和收件箱云端迁移前，这些模块仍使用现有本地数据路径；本次认证部署不会自动把旧浏览器数据导入其他账户。
