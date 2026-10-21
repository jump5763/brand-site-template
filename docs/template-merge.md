# Brand Site：模板复用与隔离构建

一个 Next.js 工程，两个模板、四个商家。模板拥有独立的实际路由和 CSS 入口；内容按商家区分。生产构建在干净临时目录完成。

| 商家 | 模板 | 域名 | 内容 |
| --- | --- | --- | --- |
| a1 · Downtown | a | a1.localhost | sites/a1/current.json |
| a2 · Riverside | a | a2.localhost | sites/a2/current.json |
| b1 · Market Street | b | b1.localhost | sites/b1/current.json |
| b2 · Harbor | b | b2.localhost | sites/b2/current.json |

模板 a 来自 `clever-kiwi-play`，b 来自 `glowing-kookaburra-skip`。原 CodeForma 项目未修改。四份示例内容拥有不同标题、门店名称和主题，使用各自模板的原有 Schema 校验。

## 安装与开发

使用 Node.js 22 和项目固定的 pnpm 10.34.5：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

访问 `http://localhost:3000` 选择商家，或直接访问 `http://a1.localhost:3000` 等域名。每个商家有首页和 `/menu`。开发模式在原仓库运行，支持源代码和已有 JSON 内容的热更新；新增商家或修改构建范围后重启。`pnpm dev --site a1 --port 3100` 可以只开放一个商家。

`siteUrl` 决定 canonical，不从访问请求推测。使用正式域名时同时修改商家内容与 `src/site-catalog.json`；域名必须匹配。

## 单商家和全量构建

```bash
corepack pnpm build --site a1
corepack pnpm start --site a1 --port 3101

corepack pnpm build --site b1
corepack pnpm start --site b1 --port 3102

corepack pnpm build --all
corepack pnpm start --all --port 3000
```

`a2`、`b2` 使用相同命令。`--site` 接受商家 ID，不再接受容易混淆的模板名 `a`、`b`。

| 范围 | 准备的模板 | 准备的内容 | 最终独立部署包 |
| --- | --- | --- | --- |
| a1 | a | a1 | dist/a1 |
| a2 | a | a2 | dist/a2 |
| b1 | b | b1 | dist/b1 |
| b2 | b | b2 | dist/b2 |
| all | a、b，各一份 | 全部四个商家 | dist/all |

每次生产构建执行：

1. 复用原有 Schema 校验。
2. 新建系统临时目录，只复制公共代码、所需模板路由和源码、所选商家内容。
3. 生成所选商家目录与明确的 JSON 导入文件；不通过任意文件路径读取内容。
4. 在临时目录安装锁定依赖，复用 pnpm store，运行完整 Next.js 构建。
5. 将 standalone、static 和所需 public 资源复制到 `dist/<scope>`，保留相对符号链接。
6. 删除临时目录。追踪清单单独保存在 `output/traces/<scope>`，不进入部署包。

首次先运行仓库的 `pnpm install` 填充包缓存，临时目录安装采用 offline 模式。不同范围可以并行构建；同一范围应顺序构建。再次构建会替换该范围的 dist 目录，正式运行的部署包应复制到独立部署位置，不在服务运行期间替换其目录。

部署时复制整个 `dist/<scope>`，在包内执行 `PORT=3000 node server.js`。包内包含自己的 Next.js 运行依赖，不依赖原仓库或已删除的临时目录。

**单站包是完整独立构建，不是全量服务的热补丁。** 本项目没有实现 Wonder 式 HTML/RSC 热同步，不得合并不同构建的 `.next` 目录。

旧 `.next`、`.next-a`、`.next-b` 是前一实现的本地产物，保留作对比，不被新构建流程读取或发布。

## 代码边界

- `src/app/sites/a/[siteId]`、`src/app/sites/b/[siteId]`：实际物理路由入口，仅导入自己的模板。
- `src/templates/a/site.ts`、`b/site.ts`：选择自身校验器；模板组件及 generated 注册表继续独立维护。
- `src/load-site.ts`：通用加载函数，没有总模板映射或跨模板类型联合。
- `src/shared/site-pages.tsx`：共用页面枚举、metadata、JSON-LD、robots 和 sitemap 逻辑。
- `src/site-catalog.json`：商家目录。构建工作目录只保留选中的条目。
- `src/site-data.ts`：准备阶段生成的明确内容导入；开发时生成于源目录并被 Git 忽略。
- `src/proxy.ts`：域名映射到 `/sites/<templateId>/<siteId>/...`。检查完整商家前缀，阻止同模板商家之间或跨模板访问其他商家的内部路径。

商家 A1、A2 共用模板 A 的路由代码和浏览器资源，但数据、主题、canonical 和页面缓存路径分别属于各自商家。选择 A1 不会构建或开放 A2。

## 样式与资源

各模板的 `styles.css` 使用 Tailwind 3 `@config` 指向本模板配置，只扫描本模板、对应路由和公共 helper。`src/styles/tailwind.preset.cjs` 共用设计 token，`base.css` 只有真正公共的基础规则，不含全量 utilities。预览入口拥有自己的小型样式入口。

全量部署允许保存两个模板的资源，但访问一个商家不应加载另一模板的专属模块和样式。共享 React、Next.js 或基础库属于正常复用。

公开资源按目录放置：

- `public/shared`：所有模板共用。
- `public/templates/a`、`public/templates/b`：模板资源。
- `public/media/a1` 等：商家资源。

构建只复制对应范围。源模板当前主要使用远程图片；原始图片约束要求本地图片使用 `/media/<siteId>/...`。

## 检查

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm schema:check
corepack pnpm typecheck
node scripts/inspect-build.mjs a1
node scripts/inspect-build.mjs b1
node scripts/inspect-build.mjs all
```

`schema:generate` / `schema:check --site a1` 处理该商家使用的模板，全量时每个模板只处理一次。新增 Section 后生成契约，内容修改不必生成契约。

`inspect-build` 检查部署文件、追踪清单、实际 HTML 引用的 JS/CSS 以及客户端模块归属，结果写入 `output/audit`。这不是发布状态机或回滚系统。

根目录 `templates/new-site3` 是另一个独立模板工程，保持原样；它不属于本次主应用源码、lint 范围或构建输入。

默认不允许搜索索引。配置正式域名后，在构建时设置 `SEARCH_INDEXING_ENABLED=true`；各页仍遵守自己的 robots 配置。
