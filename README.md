# DDL Countdown

一个可部署到 GitHub Pages 的会议 DDL 倒计时网页。它从 `ccfddl/ccf-deadlines` 定期同步会议数据，页面本身不提供交互，只展示后台配置的会议列表。

## 使用

```bash
node scripts/sync-ccfddl.mjs
npm run check:data
npm run dev
```

正常页面只显示真实的未来 DDL；访问 `http://127.0.0.1:5173/?demo=1` 可以预览多个会议同时出现时的布局。

## 配置展示会议

编辑 `public/tracked-conferences.json`：

```json
[
  "ACL",
  "ICLR",
  "ICML",
  "NeurIPS",
  "EMNLP",
  "AAAI",
  "DAC"
]
```

这里写会议系列名即可，不需要限制年份。页面会从同步数据里自动选择该系列尚未截止的最近一次 DDL；已经过期的年份不会展示，也不会占用页面位置。也可以写某个 `ccfddl` 的精确 `id` 或别名。

## 手动添加会议

如果 `ccfddl` 暂时没有某个会议，编辑 `public/manual-conferences.json` 维护补充条目：

```json
{
  "title": "MYCONF",
  "description": "My Conference Full Name",
  "aliases": ["MyConf 2027"],
  "sub": "AI",
  "rank": { "ccf": "N" },
  "year": 2027,
  "deadline": "2027-01-15 23:59:59",
  "timezone": "AoE",
  "date": "June 1-5, 2027",
  "place": "TBD",
  "link": "https://example.com",
  "source": "manual"
}
```

默认不会写入预测 DDL；只有 `ccfddl` 同步到未来条目，或你手动加入未来条目时，页面才会展示倒计时。

## 覆盖数据

如果 `ccfddl` 中已有会议但某个字段需要临时修正，编辑 `public/overrides.json`：

```json
{
  "aaai27": {
    "abstractDeadline": "2026-07-20 23:59:59",
    "deadline": "2026-07-27 23:59:59",
    "timezone": "UTC-12"
  }
}
```

key 可以是会议 `id`、简称、DBLP 名或别名。`disabled: true` 可以临时隐藏某个条目。

## GitHub Pages

1. 推送到 GitHub 仓库的 `main` 分支。
2. 在仓库 Settings -> Pages 中选择 GitHub Actions。
3. 在仓库 Settings -> Actions -> General 中确认 workflow 有 read/write 权限。
4. `Deploy GitHub Pages` workflow 会同步数据、检查数据、构建并发布站点。

## 数据同步

`.github/workflows/deploy.yml` 每天自动运行，也可以在 Actions 页面手动触发。它会执行：

```bash
node scripts/sync-ccfddl.mjs
npm run check:data
```

同步脚本只拉取 `public/tracked-conferences.json` 中会议对应的 `ccfddl` 源文件，只保留未来 DDL，并生成：

- `public/conferences.json`：网页使用的数据
- `public/health.json`：同步健康报告和无未来 DDL 的会议列表
- `public/calendar.ics`：可订阅的日历文件

定时或手动运行时，workflow 会把这些生成文件提交回仓库后重新部署 GitHub Pages。
