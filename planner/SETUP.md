# 计划 · 云同步设置

云同步用 Google 的 Firebase（免费的 Spark 方案就够：每天 5 万次读、2 万次写、1 GB 空间；不用绑信用卡，长时间不用也不会被停用）。
只要设置一次，大约 10 分钟。设置好以前，计划照样能用，只是资料只存在那一台设备上。

## 1. 建项目

1. 打开 <https://console.firebase.google.com>，用你的 Google 账号登录。
2. 「创建项目」（Create a project），名字随便取，比如 `ling-planner`。
3. 问要不要 Google Analytics 时选**不要**（用不到）。

## 2. 开启登录方式

1. 左边「构建 → Authentication」（Build → Authentication）→「开始」（Get started）。
2. 「登录方法」（Sign-in method）里：
   - 启用 **电子邮件/密码**（Email/Password）——主要的登录方式，网页、APK、EXE 都能用。
   - （可选）启用 **Google**——只在浏览器里能用，打包成 APK / EXE 后 Google 不允许在 App 里面弹登录窗口。
3. 「设置 → 授权网域」（Settings → Authorized domains）里「添加网域」：`ningloke.github.io`
   （`localhost` 默认已经在里面。只有 Google 登录会检查这个；邮箱登录不受影响。）

## 3. 建数据库

1. 左边「构建 → Firestore Database」→「创建数据库」（Create database）。
2. 位置选 **asia-southeast1（新加坡）**，离马来西亚最近。选了以后不能改。
3. 选「以生产模式启动」（Start in production mode）。
4. 建好后打开「规则」（Rules）分页，把 [`firestore.rules`](firestore.rules) 的全部内容贴进去，按「发布」（Publish）。
   这份规则保证：每个账号只能读写自己的资料，别人登录了也看不到你的。

## 4. 把设置交给网页

1. 左上齿轮「项目设置」（Project settings）→ 往下到「您的应用」（Your apps）→ 点 `</>`（Web）。
2. 应用名称随便取（比如 `planner`），**不用**勾 Firebase Hosting →「注册应用」。
3. 页面会显示一段 `const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", ... }`。
4. 把它贴进 [`firebase-config.js`](firebase-config.js)，把 `export const firebaseConfig = null;` 换成：

   ```js
   export const firebaseConfig = {
     apiKey: "……",
     authDomain: "……",
     projectId: "……",
     storageBucket: "……",
     messagingSenderId: "……",
     appId: "……",
   };
   ```

   这些值**不是密码**，放在公开的网页里是正常的（Firebase 本来就是这样用的）；保护资料的是第 3 步的规则。
   你也可以直接把这段发给 Claude，让它帮你填好、推送。

## 5. 用起来

1. 网页「设置 · 同步」→ 填邮箱和密码 →「注册新账号」（只有第一次）。
2. 另一台设备打开同一个网页 → 用同一个邮箱密码「登录」。
3. 之后两边的改动会自动同步（通常 1 秒内）。离线时改的东西会先存在本机，连上网自动上传。
4. 第一次登录时，这台设备上已经有的资料会合并上传，不会被清掉。
5. 「退出登录」会清空这台设备上的资料（云端的还在，再登录就回来）。

## 同步是怎么做的（给以后维护的人）

- `store.js`：资料和操作；`sync.js`：同步规则（纯函数）；`syncer.js`：什么时候上传、下载、重试；`cloud.js`：只负责和 Firebase 说话。
- 资料被切成一条条小记录（一项待办、一个行程、一个每日任务、某天某个任务的一个勾、一个设置），存在 `users/{你的账号 id}/records/` 下。删除会留下一条「已删除」记录，好让其他设备知道。
- 同一条记录两边都改了：以**最后修改的时间**为准；上传时在云端用事务（transaction）检查，旧的改动不会盖掉新的。
- 每台设备记着上次同步到的云端时间，只下载那之后变过的记录，所以资料多了也不会每次全部重读。
- Firebase SDK 放在 `vendor/`（不从 CDN 载入），以后打包 APK / EXE 也能离线用。

### 在本机用模拟器测试（不需要真的 Firebase 项目）

```bash
npm install -g firebase-tools        # 需要 Java
# 在一个放着下面 firebase.json 的文件夹里：
#   { "firestore": { "rules": "<repo>/planner/firestore.rules" },
#     "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 }, "singleProjectMode": true } }
firebase emulators:start --project demo-planner --only auth,firestore
# 另开一个终端，在仓库根目录：
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/planner/?emulator   （网址带 ?emulator 就会连本机模拟器）
```
