# Ling's Timetable

Curtin Malaysia 课表网站，课表数据每天自动从 Curtin 官方课表系统（[sws.curtin.edu.my](http://sws.curtin.edu.my)）更新。

- 网站（2E3）：https://ningloke.github.io/ling/
- 数据：`data/2E3.json`、`data/3E4.json`（3E4 的 Netlify 网站也是读这里的数据）

## 自动更新是怎么做的

1. GitHub Actions（`.github/workflows/update-timetables.yml`）每天马来西亚时间 06:17 和 18:17 各跑一次，另外 06:47 和 18:47 各有一次备用。
2. `scripts/update-timetables.mjs` 用无头浏览器打开 SWS → Units → 选好科目 → Semester Two → List 报表，把表格转成 JSON。
3. 只有课表真的变了才会改 `data/<班>.json`。`data/status.json` 记录最近一次检查的时间，每天最多更新一次，所以不会每次运行都产生提交。
4. 网页打开时会先显示内置的课表，再去读最新的 JSON；断网时用上次保存的版本。

## 核准查看（SWS 原页截图）

SWS 把选了哪一科存在服务器会话里，网址里不带科目，所以没法用链接直接打开某一科。自动更新时，脚本会在 SWS 里逐科打开 List 页面，截一张 3840 像素宽的全页图存到 `sws/<科目代码>.png`，每一行在图上的位置记在 `sws/index.json`。网站上点「核准查看」（或课卡片上的「核准」）就能看到原样截图，自己课表用到的行会框出来。SWS 内容变了才会重新截图；某一科截图失败只会记一条警告，不影响课表更新。

## 改班级 / 科目

编辑 `scripts/timetables.config.mjs`，比如：

```js
{ unit: "CMFP0042", groups: ["K"] }                  // Maths 2 group K
{ unit: "FP-070", groups: ["*"], staff: "Grace" }    // 任何 group，只要 Grace 老师的课
```

推送之后 Actions 会自动重新抓一次课表。也可以到 GitHub 的 Actions 页面手动点 "Run workflow"。

## 本地测试

```bash
node --test "scripts/**/*.test.mjs"
```

```bash
node scripts/update-timetables.mjs --fixture scripts/fixtures/sws-2026-sem2.json
```

第二条命令用保存好的 SWS 数据重新生成 `data/`，不需要联网。

`关注塔菲喵/` 是旧版的手动排课数据，现在已经不再自动更新，留作存档。
