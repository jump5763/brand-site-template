# Brand Site：模板 a / b 合并说明

两个模板共用一个 Next.js 工程和路由入口，各自保留组件、生成契约和渲染器。源 CodeForma 项目未修改。

| 模板 | 源项目 | 演示商家 | 本地域名 |
| --- | --- | --- | --- |
| a | `clever-kiwi-play` | `site-a` | `a.localhost` |
| b | `glowing-kookaburra-skip` | `site-b` | `b.localhost` |

源项目位于 `/Users/penn/Library/Application Support/CodeForma Development/projects`。两者原本使用同一个站点 ID；导入后改为独立商家 ID，品牌正文和页面结构保持。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

访问 `http://localhost:3000` 选择模板，或直接打开 `http://a.localhost:3000`、`http://b.localhost:3000`。两个站点均包含首页 `/` 和菜单页 `/menu`，站内链接使用 Next.js 客户端导航。

可通过 `pnpm dev --port 3100` 换端口。预览入口的普通点击保留当前端口；商家 `siteUrl` 决定 canonical，修改正式域名或固定预览端口时需同步修改内容文件。

## 文件位置

- `src/templates/a`、`src/templates/b`：原模板组件及各自的 `site-schema/generated`、渲染器、校验器。
- `sites/site-a/current.json`、`sites/site-b/current.json`：商家独立的完整 Site Schema。
- `src/site-catalog.json`：商家 ID、模板 ID、域名和内容文件映射。
- `src/template-map.tsx`：固定的模板选择与渲染入口。
- `src/load-site.ts`：按商家读取配置，复用对应模板原有校验器。
- `src/proxy.ts`：将商家域名下的公开路径重写到 `/sites/<siteId>/...`，保留查询参数；拒绝未知域名与跨商家内部路径。
- `src/app/sites/[siteId]/layout.tsx`：商家根布局，将主题变量应用到 body，保证弹窗等 Portal 也使用正确主题。

模板私有的 `@/` 导入已改为 `@/templates/a/` 或 `@/templates/b/`。同名 Section 可以在两个注册表中并存，禁止将一个模板的配置交给另一个模板的校验器。生成工具仍是原有工具，增加 `--template` 定位独立模板目录。

当前两个源项目没有本地图片，图片来自 Schema 中的远程地址。新增本地图片时使用 `public/media/<siteId>/...` 和 `/media/<siteId>/...`，避免同名资源覆盖。

## 全量与单商家构建

```bash
pnpm build --all
pnpm start --port 3000

pnpm build --site a
pnpm start --site a --port 3001

pnpm build --site b
pnpm start --site b --port 3002
```

`--site site-a` 和 `--site site-b` 同样有效。每次仅接受一个范围参数。

| 构建范围 | 产物目录 | 可服务商家 |
| --- | --- | --- |
| 全量 | `.next` | a、b |
| a | `.next-a` | a |
| b | `.next-b` | b |

商家目录始终保留完整映射。构建范围只决定本次预生成及可服务的商家；未选商家、未知页面返回 404，不在请求时补生成。普通内容读取使用本地 JSON，不访问原项目的数据库或部署服务。

构建生成 standalone 程序，并补齐静态资源和内容文件。也可在相应 standalone 目录运行：

```bash
PORT=3000 node server.js
```

启动时使用与构建时匹配的目录和参数。构建与在线目录应分离，不在正在运行的 `.next` 上执行构建。

**单商家构建得到的是完整独立产物，不是可热插入全量应用的补丁。** 本阶段完成模板合并、全量/单商家构建和正常 Next.js 托管；没有实现 Wonder 式 HTML/RSC 热同步。禁止合并不同构建的 `.next` 目录。选择性预生成也不承诺只编译该模板代码，类型检查仍覆盖整个源码工程。

## 编辑与检查

```bash
pnpm validate:site
pnpm validate:site --site a
pnpm schema:generate
pnpm schema:check
pnpm typecheck
pnpm lint
pnpm test
```

新增或修改 Section 能力后执行 `schema:generate`；只修改商家文案无需重新生成契约。`generated` 文件由脚本维护。

生产环境默认不允许搜索引擎索引。设置正式域名和正确的 `siteUrl` 后，在构建时使用 `SEARCH_INDEXING_ENABLED=true`；各页面仍受自己 `metadata.robots` 配置控制。`/sitemap.xml`、`/robots.txt` 按商家输出，不泄漏内部路由前缀。

本次合并同时修正源模板中三个会阻止当前 lint 的写法：Toaster 不再用 Effect 同步挂载标志；Reveal 通过观察器操作动画类并保留无 JavaScript 时的可见内容；轮播插件使用惰性初始化而不是渲染期间读取 ref。源项目不受影响。

本地预览没有新增商家管理后台、发布状态机、自动回滚或 CDN 服务。

## 本次实施验证

- `schema:check`、`typecheck`、`lint` 和 5 项行为测试通过。
- 全量、单站 a、单站 b 的生产构建均通过；预渲染清单分别包含两个、一个、一个商家的页面。
- standalone 实际启动：两个域名的首页、菜单、robots 和 sitemap 可访问；跨商家内部路径和未选商家返回 404。
- 浏览器确认两套模板从首页进入菜单时保留同一文档，完成软导航；内页刷新正常。
- 移动端菜单可打开，弹层继承商家主题，390px 视口无横向溢出。
- 原模板未提供 favicon，浏览器仍可能记录对应 404；远程图片和地图加载依赖外部网络。

截图位于本地忽略目录 `output/playwright/`。
