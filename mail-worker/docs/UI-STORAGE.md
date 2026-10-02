# 独立界面资料与外观扩展

扩展在原 `db` D1 中增加 `ui_profiles`、`ui_appearance`，沿用现有 JWT、`kv` 会话和权限服务。它不改变账户名称、发件人、原站背景或站点设置。

## 部署

先导出当前生产 D1，并验证 SQL 可以还原及原表行数一致；同时保存 Workers 部署版本、绑定、变量、路由、定时任务和 Time Travel 书签。然后使用实际生产配置执行：

```sh
wrangler d1 execute mail --remote --file migrations/001_ui_storage.sql --config <production-config>
wrangler deploy --config <production-config>
```

配置必须保留原 D1、KV、AI、静态前端和业务变量。使用 `keep_vars = true` 保留现有服务端变量；不能把仓库示例中的空绑定部署到生产。原静态前端照常构建到 `mail-worker/dist`。此迁移可以重复执行，只创建新表，不执行 `/init`。

## 接口

所有路径位于 `/api` 下，JSON 为 `{code,message,data}`。错误同时返回 HTTP 状态；版本冲突为 409，数据库不可用为 503。

| 接口 | 权限 | 数据 |
| --- | --- | --- |
| `GET /ui/profile` | 已登录本人 | 昵称、头像地址、版本 |
| `PUT /ui/profile` | 已登录本人 | `nickname`、`version`，可选 `avatar` |
| `GET /ui/appearance` | 公开 | 已发布外观，默认版本 0 |
| `PUT /ui/appearance` | 根管理员或当前 `setting:set` | `background`、`color`、`surface`、`opacity`、`blur`、`version`，可选 `image` |
| `GET /ui/images/avatar` | 已登录本人 | 原始头像字节 |
| `GET /ui/images/background` | 公开 | 已发布背景字节 |

写入图片使用 PNG/JPEG/WebP 静态图片的 data URI；省略图片字段保留，`null` 清除。头像最长边 256 像素、128 KiB；背景最长边 2560 像素、1 MiB。PNG/WebP 动画被拒绝，类型、尺寸和字节限制同时检查。非图片背景释放旧背景 BLOB。JSON 请求体最多 1,500,000 字节。

初次写入使用版本 0，后续写入使用读取到的版本。单条 SQL 完成版本比较和更新；冲突需重新加载。头像和背景按需查询 BLOB，元数据不包含图片字节。`ui_profiles` 外键在原用户物理删除时级联清理。

## 验证与恢复

```sh
pnpm test:ui
```

测试运行实际 Hono 路由、JWT/KV 认证和内存 SQLite，覆盖版本竞争、图片保存/移除、权限变化、公共接口边界和用户级联删除。原 `pnpm test` 脚本会部署测试 Worker，不是单元测试命令。

代码回滚使用部署前记录的 Worker 版本，新表可以保留。数据库恢复会影响所有原邮件数据，应单独核对恢复点和后续写入后再执行。不要为了代码回滚删除新表或重建原 D1。
