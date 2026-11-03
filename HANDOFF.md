# 山水报价查询项目交接

更新时间：2026-11-03 21:40（Asia/Shanghai）

## 1. 当前线上状态

- 客户访问地址：https://quote.waydd.xyz/
- 页面名称：安徽山水智元科技。
- 页头图标显示白色“山水”字样，底色为深蓝 `#1f4f82`。
- 不需要访问密码，打开直接进入搜索。
- 当前报价：696 条。
- 商品图片：268 条已关联原图，共 261 个去重文件，约 35 MB。
- 无价/缺货商品：45 条，搜索结果显示“无价”。
- 当前分类数量：显卡 97 / 主板 111 / 存储 31 / 显示器 158 / 一体机 13 / 机箱 94 / 电源 105 / 散热·风扇 68 / 外设 13 / 套餐 6。

### 最近已完成（2026-11-03）

- **数据抓取去浏览器化**：改用金山文档官方 CLI（`kdocs-cli`）读原表，不再依赖 Chrome/Playwright/WPSOpenApi 前端接口。只读权限即可读表，696 条数据与旧方式零差异。
- **变化检测**：新增 `scripts/check-version.mjs`，同步前先查原表 `mtime`，没变化直接跳过（约 32 秒结束），变了才全量读表+发布，避免无意义扫描和日志堆积。
- **定时触发换用腾讯云 SCF**：GitHub Actions 的 `schedule` 定时器在该账号上始终不触发（连最简 probe workflow 也不触发，属账号级平台问题）。改用腾讯云云函数 SCF 每 5 分钟发 `repository_dispatch` 触发同步。
- 页面主题、移动端布局、悬浮顶部按钮等前端改动已在此前完成。

## 2. 托管与域名

- 托管平台：腾讯云 EdgeOne Pages。
- 生产项目：`shanshui-quote-public`，Project ID：`makers-dpptw8hgamm6`，区域：`overseas`。
- 自定义域名：`quote.waydd.xyz`，正确 CNAME：`quote.waydd.xyz.pages.dnsoe6.com`。
- DNS：DNSPod，NS 为 `poplar.dnspod.net`、`scroll.dnspod.net`。

说明：

- `waydd.xyz` 无工信部备案，不能绑定腾讯云中国站项目；生产走 EdgeOne 海外区。
- GitHub Pages 旧地址 `https://waydd624507569-ui.github.io/shanshui-quote/` 是旧快照，不要发给客户。

## 3. 自动同步（当前架构）

私有自动化仓库：

https://github.com/waydd624507569-ui/shanshui-quote-automation

### 完整链路

```
腾讯云 SCF（每 5 分钟定时）
  → POST repository_dispatch 到私有仓库
  → 触发 .github/workflows/sync-quote.yml
  → 跑 scripts/check-version.mjs 查原表 mtime
      ├─ 没变 → 跳过（约 32 秒，不读表不发布）
      └─ 变了 → kdocs-cli 读表 → 构建 → 发布 EdgeOne
```

### 数据抓取：kdocs-cli（官方 API）

- 命令：`kdocs-cli drive read-file url=...` 或 `kdocs-cli sheet get-range-data ...`
- 认证：金山文档 Token（`kdocs-cli auth login` 获取，有效期约 1 年），存在 GitHub Secrets `KDOCS_TOKEN`。
- 只读权限即可读表，不需要浏览器、不需要编辑权限。
- 脚本：`scripts/sync-kdocs-cli.mjs`（读 13 个工作表 → 输出 `data/source-snapshot.json`，格式与旧浏览器版一致，供 `build-catalog.mjs` 复用）。

### 变化检测

- 脚本：`scripts/check-version.mjs`（查原表 `mtime`，与仓库内 `last-mtime` 文件对比）。
- 有变化才执行后续同步/构建/发布步骤，并在最后 commit 更新 `last-mtime`。

### 定时触发：腾讯云 SCF

- 函数名：`airsync-trigger`（地域 ap-guangzhou，运行时 Nodejs16.13）。
- 定时触发器：`airsync-timer`，cron `0 */5 * * * * *`（每 5 分钟）。
- 函数逻辑：用环境变量 `GH_TOKEN` 发 `repository_dispatch`（event_type=`airsync`）到私有仓库。
- 依赖：执行角色 `SCF_QcsRole`（已绑定自定义策略 `SCF-CLS-Access`，授予 CLS 日志权限）。
- 注意：GitHub 的 `schedule` 定时器在该账号上不可用（见「已知限制」），因此用 SCF 替代。

### 私有仓库 Secrets

- `CATALOG_PASSPHRASE`：报价数据加密口令。
- `EDGEONE_API_TOKEN`：EdgeOne 发布令牌。
- `KDOCS_TOKEN`：金山文档 API Token（kdocs-cli 认证用）。
- `GH_TOKEN`（放 SCF 环境变量，不在 GitHub Secrets）：发 repository_dispatch 的 GitHub PAT。

## 4. KDOCS Token 失效时

网站不会坏，会继续展示最后一次成功发布的报价，但同步会中断。

`KDOCS_TOKEN` 有效期约 1 年，失效后重新授权：

```bash
cd /Users/ydd/Documents/ChatGPT/mac/product-quote
kdocs-cli auth login        # 浏览器确认，几秒完成，Token 自动存入系统密钥链
```

然后取新 Token 更新到 GitHub Secrets：

```bash
TOKEN=$(security find-generic-password -s "kdocs-cli" -w | sed 's/^go-keyring-base64://' | base64 -d)
printf '%s' "$TOKEN" | gh secret set KDOCS_TOKEN --repo waydd624507569-ui/shanshui-quote-automation
```

## 5. 常用命令

本地完整同步（数据 + 套餐图）并发布 EdgeOne：

```bash
cd /Users/ydd/Documents/ChatGPT/mac/product-quote
npm run deploy:edgeone
```

只同步价格数据（kdocs-cli，不重新生成套餐图）：

```bash
cd /Users/ydd/Documents/ChatGPT/mac/product-quote
npm run sync:data
npm run protect
npm run build
```

只读表不构建（验证 kdocs-cli 读数据）：

```bash
npm run sync:data:only
```

手动触发云同步：

```bash
gh workflow run sync-quote.yml --repo waydd624507569-ui/shanshui-quote-automation
```

查看最近运行：

```bash
gh run list --repo waydd624507569-ui/shanshui-quote-automation --workflow sync-quote.yml --limit 5
```

## 6. 本地项目

项目目录：

`/Users/ydd/Documents/ChatGPT/mac/product-quote`

关键文件：

- `src/App.tsx`：前端搜索、分类、复制、自动解密报价。
- `src/styles.css`：白色背景、移动端布局、套餐图片展示。
- `scripts/sync-kdocs-cli.mjs`：用 kdocs-cli 读原表数据（当前数据同步主路径）。
- `scripts/check-version.mjs`：查原表 mtime 做变化检测。
- `scripts/sync-kdocs.mjs`：旧浏览器版同步（现仅用于图片/套餐图抓取）。
- `scripts/build-catalog.mjs`：分类、品牌前缀和型号解析。
- `scripts/encrypt-catalog.mjs`：报价数据 AES-GCM 加密。
- `scripts/create-package-image.swift`：macOS 下生成透明套餐图。
- `scripts/deploy-edgeone.sh`：本地完整同步并发布 EdgeOne。
- `scripts/sync-product-images.mjs`：商品图片提取。
- `public/data/catalog.enc.json`：线上自动解密的数据包。

本地 `.env.local` 含构建时自动解密口令，已加入 `.gitignore`，不要提交。

## 7. 数据和解析规则

原表：

https://www.kdocs.cn/l/cpn7SRJAtLzt

重要规则：

- 所有商品名称均加品牌前缀。
- “联想”统一使用准确品牌“联想来酷”。
- 无价格商品保留，显示“无价”。
- “缺货”价格可显示为无价并在备注中保留“缺货”。
- 显示器分 5 个品牌区块解析：联想来酷 39 / 泰坦 28 / 优派 62 / 明基 18 / 海兰 11。
- 显卡右侧按不同品牌子表解析，品牌前缀包括讯景、耕升、蓝戟、杰灵、铭鑫、精粤等。
- 显卡“套提”备注若在原表中纵向合并，自动展开到合并区域内的每个型号。
- 鑫谷电源存在多个“型号 + 价格”写在同一单元格的情况，`parseInlinePricedModels` 会逐行拆分。
- 复制报价时不包含“来源：工作表/行号”这一行。

## 8. 图片规则

- 客户明确要求不要压缩图片，当前保留原图格式，不压缩。
- 商品图片映射保存在 `data/product-images.json`，文件位于 `public/products/`。
- 套餐图/商品图抓取仍走旧浏览器方式（`sync-kdocs.mjs` + `sync-product-images.mjs` + macOS Vision/Swift 抠图）。
- 云端自动同步设置 `WPS_SKIP_IMAGES=1`，只更新价格数据，不重新生成套餐图。
- 如果套餐图片本身变化，需要在 Mac 上运行 `npm run deploy:edgeone`（依赖 macOS Vision/Swift）。

## 9. 已验证内容

- 公网 HTTPS 返回 200，无需密码即可进入。
- 搜索型号、品牌、无价商品正常。
- 图片无白底、无裁切；320 / 360 / 430px 移动端检查通过。
- 手机端锁定 1x，禁用双击/双指缩放。
- kdocs-cli 读表 696 条与旧浏览器版零差异。
- 变化检测生效：mtime 未变时同步跳过（约 32 秒），发布仅在实际变化时发生。
- SCF 触发 → GitHub workflow `repository_dispatch` 跑通，结论 success。

## 10. 已知限制

- 非秒级，最长约 5 分钟延迟（SCF 每 5 分钟检测一次）。
- GitHub Actions 的 `schedule` 定时器在该账号上不触发（账号级平台问题），已用 SCF 替代，不要再依赖 GitHub schedule。
- KDOCS_TOKEN 约 1 年失效，需重新 `kdocs-cli auth login` 并更新 Secrets。
- 云端自动同步不更新套餐图片；图片更新需 Mac。
- 原表结构若新增品牌子表或改变列位置，需同步调整 `scripts/build-catalog.mjs`。
- 富勒 L618/L650/L690 黑白颜色变体目前按同型号去重，只保留一条记录。

## 11. 新会话建议开场

可以直接对新会话说：

> 读取 `/Users/ydd/Documents/ChatGPT/mac/product-quote/HANDOFF.md`，继续维护山水报价查询项目。
