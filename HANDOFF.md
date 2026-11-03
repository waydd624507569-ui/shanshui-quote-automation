# 山水报价查询项目交接

更新时间：2026-11-03 13:52（Asia/Shanghai）

## 1. 当前线上状态

- 客户访问地址：https://quote.waydd.xyz/
- 不需要访问密码，打开直接进入搜索。
- 当前报价：696 条。
- 无价/缺货商品：45 条，搜索结果显示“无价”。
- 最近一次云同步：GitHub Actions run 41586205921，成功。
- 当前 WPS 登录态已验证有效，原表可正常打开，共 13 个工作表。
- 当前分类数量：
  - 显卡 97
  - 主板 111
  - 存储 31
  - 显示器 158
  - 一体机 13
  - 机箱 94
  - 电源 105
  - 散热/风扇 68
  - 外设 13
  - 套餐 6

## 2. 托管与域名

- 托管平台：腾讯云 EdgeOne Pages。
- 生产项目：`shanshui-quote-public`
- Project ID：`makers-dpptw8hgamm6`
- 项目区域：`overseas`
- 自定义域名：`quote.waydd.xyz`
- 正确 CNAME：`quote.waydd.xyz.pages.dnsoe6.com`
- DNS：DNSPod，NS 为 `poplar.dnspod.net`、`scroll.dnspod.net`
- 免费 HTTPS 证书已签发并生效。

说明：

- `waydd.xyz` 没有工信部备案，因此不能绑定腾讯云中国站项目。
- 中国站项目 `shanshui-quote` 存在，但默认域名需要 `eo_token` 临时令牌，不能给客户使用。
- 当前生产使用 EdgeOne 海外区项目，但通过 `waydd.xyz` 和 DNSPod 访问。
- GitHub Pages 旧地址 `https://waydd624507569-ui.github.io/shanshui-quote/` 是旧快照，不要发给客户。

## 3. 24 小时自动同步

私有自动化仓库：

https://github.com/waydd624507569-ui/shanshui-quote-automation

工作流：

`.github/workflows/sync-quote.yml`

调度：

- 每 30 分钟运行一次：`*/30 * * * *`
- 也支持手动触发：`workflow_dispatch`
- 单次实际运行约 1–2 分钟
- 原表修改后，通常 30 分钟内发布

自动流程：

1. 从 GitHub Secrets 恢复或解密 WPS 登录态。
2. 使用 GitHub Runner 自带 Google Chrome 打开金山原表。
3. 读取 13 个工作表。
4. 重新生成 `src/data/catalog.json`。
5. 加密报价数据，生成 `public/data/catalog.enc.json`。
6. 构建 Vite 静态站点。
7. 使用 EdgeOne API Token 发布到 `shanshui-quote-public`。
8. 每约 10 小时导出新的 WPS 登录态，加密后写回私有仓库。

私有仓库 Secrets：

- `CATALOG_PASSPHRASE`
- `EDGEONE_API_TOKEN`
- `WPS_STORAGE_STATE_GZ_B64`（首次恢复用后备）

WPS 登录态文件：

- 本地明文：`~/.config/product-quote/wps-storage-state.json`，权限 600
- 私有仓库加密文件：`secrets/wps-state.enc`
- 本地客户加密口令：`~/.config/product-quote/customer-password`，权限 600

不要把上述登录态、API Token 或客户加密口令写入公开仓库或聊天记录。

## 4. 金山登录失效时

网站不会坏，会继续展示最后一次成功发布的报价。GitHub Actions 会显示任务失败。

恢复步骤：

1. 在 Chrome 中重新登录：https://www.kdocs.cn/l/cpn7SRJAtLzt
2. 确认能打开《安徽山水智元全产品报价单》。
3. 在项目目录执行：

```bash
cd /Users/ydd/Documents/ChatGPT/mac/product-quote
npm run reauth:wps
```

该命令会：

- 重新导出 WPS 登录态
- 加密并写入私有自动化仓库
- 更新 `last-wps-refresh`
- 立即触发一次云同步

也可以让新会话中的 Codex 执行。

## 5. 常用命令

本地完整同步、生成活动图并发布 EdgeOne：

```bash
cd /Users/ydd/Documents/ChatGPT/mac/product-quote
npm run deploy:edgeone
```

只同步数据、不重新生成套餐图：

```bash
WPS_STORAGE_STATE_FILE="$HOME/.config/product-quote/wps-storage-state.json" \
WPS_SKIP_IMAGES=1 npm run sync
npm run protect
npm run build
```

手动触发云同步：

```bash
gh workflow run sync-quote.yml \
  --repo waydd624507569-ui/shanshui-quote-automation
```

查看最近运行：

```bash
gh run list --repo waydd624507569-ui/shanshui-quote-automation \
  --workflow sync-quote.yml --limit 5
```

## 6. 本地项目

项目目录：

`/Users/ydd/Documents/ChatGPT/mac/product-quote`

关键文件：

- `src/App.tsx`：前端搜索、分类、复制、自动解密报价。
- `src/styles.css`：白色背景、移动端布局、套餐图片展示。
- `scripts/sync-kdocs.mjs`：金山文档同步。
- `scripts/build-catalog.mjs`：分类、品牌前缀和型号解析。
- `scripts/encrypt-catalog.mjs`：报价数据 AES-GCM 加密。
- `scripts/create-package-image.swift`：macOS 下生成透明套餐图。
- `scripts/deploy-edgeone.sh`：本地完整同步并发布 EdgeOne。
- `scripts/export-wps-session.mjs`：重新导出 WPS 登录态。
- `scripts/publish-wps-session.sh`：加密并上传登录态、触发云同步。
- `public/data/catalog.enc.json`：线上自动解密的数据包。
- `secrets/wps-state.enc`：加密后的 WPS 登录态。

本地 `.env.local` 含构建时自动解密口令，已加入 `.gitignore`，不要提交。

## 7. 数据和解析规则

原表：

https://www.kdocs.cn/l/cpn7SRJAtLzt

重要规则：

- 所有商品名称均加品牌前缀。
- “联想”统一使用准确品牌“联想来酷”。
- 无价格商品保留，显示“无价”。
- “缺货”价格可显示为无价并在备注中保留“缺货”。
- 显示器分 5 个品牌区块解析：
  - 联想来酷 39
  - 泰坦 28
  - 优派 62
  - 明基 18
  - 海兰 11
- 显卡右侧按不同品牌子表解析，品牌前缀包括讯景、耕升、蓝戟、杰灵、铭鑫、精粤等。
- 显卡“套提”备注若在原表中纵向合并，自动展开到合并区域内的每个型号，避免只有首行带完整备注。
- 鑫谷电源存在多个“型号 + 价格”写在同一单元格的情况，`parseInlinePricedModels` 会逐行拆分。
- 复制报价时不包含“来源：工作表/行号”这一行。

本轮复盘补上的 18 个真实漏项：

- 耕升 RTX5050 8GB OC 追风：1
- 七彩虹/杰灵存储无价型号：5
- 海兰兆芯 KX-U6780A、海兰飞腾 D2000：2
- 鑫谷无界 Pro、数智 Ultra 合并单元格型号：10

## 8. 图片规则

- 客户明确要求不要压缩图片，当前使用原始 PNG。
- 6 个套餐图使用透明背景 PNG。
- 图片来自金山内嵌原图，不再使用低清单元格截图。
- 人工替换图保存在：
  - `data/manual-deals/package-1-1.png`
  - `data/manual-deals/package-1-2.png`
  - `data/manual-deals/package-2-1.png`
- 当前 GitHub Actions 设置 `WPS_SKIP_IMAGES=1`，云端只更新价格和数据，不重新生成套餐图。
- 如果套餐图片本身变化，需要在 Mac 上运行 `npm run deploy:edgeone`，因为透明抠图和拼接依赖 macOS Vision/Swift。

## 9. 已验证内容

- 公网 HTTPS 返回 200。
- 不需要密码即可进入。
- 搜索型号、品牌、无价商品正常。
- 图片无白底、无裁切。
- 320 / 360 / 430px 移动端检查通过。
- GitHub Actions 连续两次手动执行成功。
- 当前公网版本为 696 条报价。

## 10. 已知限制

- 不是秒级实时，最长约 30–35 分钟延迟。
- GitHub 定时任务在高峰期可能延迟。
- WPS 若强制注销，需要重新登录并执行 `npm run reauth:wps`。
- 云端自动同步不更新套餐图片；图片更新需 Mac。
- 原表结构如果新增新的品牌子表或改变列位置，需要同步调整 `scripts/build-catalog.mjs`。
- 富勒 L618/L650/L690 的黑白颜色变体目前按同型号去重，只保留一条记录。

## 11. 新会话建议开场

可以直接对新会话说：

> 读取 `/Users/ydd/Documents/ChatGPT/mac/product-quote/HANDOFF.md`，继续维护山水报价查询项目。

