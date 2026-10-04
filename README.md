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

## 校园地图（3D · GPS 定位 · 带路）

页头的「校园地图」、上课卡片上的「带我去 SK3」、课卡片上的教室名都会打开一张 1:1 的 3D 校园地图：

- **楼和路**：来自 OpenStreetMap（© OpenStreetMap contributors，ODbL）。`.github/workflows/campus-map-data.yml` 在 GitHub Actions 里下载校园数据（`scripts/fetch-campus-osm.mjs` → `data/campus/osm.json`），`scripts/build-campus.mjs` 把它做成地图用的 `data/campus/campus.geojson` 和步行路网 `data/campus/paths.json`。楼的高度按楼层数算（每层约 3.6 米）。
- **楼的代码**（SK3、PA3、HL2、FN4……）对照学校官方校园地图，写在 `data/campus/codes.json`。官方地图上有、OpenStreetMap 还没画的楼（FN7）按官方地图补画。没有代码的教室名（Auditorium = FN4，Harry Perkins LT = FN1）写在 `assets/campus-geo.js` 的 `ROOM_ALIASES`。
- **校园外面**的道路、河流、树林、市镇用 [OpenFreeMap](https://openfreemap.org)（免费、不用密钥）。连不上的时候校园本身照样能用。
- **画地图**用 [MapLibre GL JS](https://maplibre.org) 6.12（BSD-3-Clause），放在 `assets/vendor/`，第一次打开地图时才下载（约 300 KB）。需要 iPhone iOS 16.4 以上或较新的 Android Chrome。
- **定位和带路**：手机 GPS（`watchPosition`）加指南针定朝向；路线在本机用 A* 算，偏离路线会自动重新规划，走到门口会震动提示。位置只在你的手机上用，不保存、不发给别人（显示地图时会像普通地图一样从 OpenFreeMap 下载附近的地图块）。GPS 在室内、楼之间可能偏差 10–30 米，室外最准。

- **方向校准**：手机指南针在钢筋水泥旁边常常偏 10–40°。定位后点右边的指南针按钮（导航时点「校准方向」），手机顶端对准一栋认得的楼或脚下这条路的方向，点它就按差值修正（在这台手机上保留 6 小时）。没有指南针的手机会直接按你面对的方向摆好地图。
- **看实景**：点一栋楼，「街景 / 卫星图 / Google 地图」会在 Google 地图里打开这栋楼的实景（用的是公开的 Maps 链接，不需要密钥）。`.github/workflows/campus-photos.yml` 每周在 Wikimedia Commons、Panoramax、KartaView、OpenAerialMap 找开放授权的校园照片，记在 `data/campus/photos.json`，有的话会直接显示在楼的卡片里（注明作者和授权）。目前这些开放图库里还没有这个校园的照片：把带位置的照片上传到 Wikimedia Commons 或 Panoramax，一周内就会自动出现。
- **360° 全景（在地图里直接拖动看）**：全景照片放在 `panoramas/`，列在 `data/campus/panoramas.json`，地图上会出现相机图标，楼的卡片上会有「360°」按钮，用 [Pannellum](https://pannellum.org)（MIT，`assets/vendor/pannellum-2.5.7/`）在页面里打开，朝着那栋楼，手指拖动看四周。加一张手机拍的全景照：`node scripts/add-panorama.mjs 照片.jpg --author "名字" --license "CC BY 4.0"`，位置和朝向从照片自带的 GPS / Photo Sphere 信息读出；没有的话加 `--at SK3`（或 `--at 纬度,经度`）和 `--north 照片正中对着的方向`。手机相机的「全景」模式拍出来的是一圈里的一段（加 `--haov 角度`），Photo Sphere / 360° 相机拍的是整个球面。
- **Google 街景在地图里打开**：Google 只允许用它的 Maps Embed API 把街景放进别的网页，需要一个 API 密钥。在 Google Cloud 建一个项目，启用 “Maps Embed API”，创建 API 密钥并限制只能用在 `ningloke.github.io/*` 和 `3e4.netlify.app/*`，把它填进 `index.html` 里的 `GOOGLE_EMBED_KEY`。不填的时候「街景」按钮照旧跳到 Google 地图。
- **门**：OpenStreetMap 没有画这里的出入口，所以每栋楼取离路最近的一个角，再加上其他方向也靠近路的角（最多 3 个）当门，带路时走到最近的那个。

改了 `codes.json` 或 `build-campus.mjs` 推送后，Actions 会重新下载并生成地图数据，并检查每间教室都能找到楼和路线。

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
