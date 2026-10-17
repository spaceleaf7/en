# 前后端整合待办清单

检查日期：2026-10-17。前端 vitest 44 项、后端 pytest 31 项全部通过，`tsc -b` 无报错。

优先级：P0 影响正常使用 / P1 后端已就绪、前端缺界面 / P2 优化与收尾。

## 已打通

- 登录 / 注册 / 刷新 / 退出：`AuthGate.tsx` + `api/client.ts`，401 自动刷新重试，并发共用一次刷新
- 词库读取：`GET /vocab/roots` 驱动导图
- 进度同步：`POST /progress/sync`，分批 2000 条、3 秒防抖、30 秒失败重试、5 分钟定期拉取、多标签页同步、pagehide keepalive
- 学习目标的上传通道：`pendingSettings` → `PATCH /auth/me`（只差界面，见 1.1）
- 旧本机数据 / 备份导入：`store/migration.ts` 按拼写把 mock id 映射成数据库 id

---

## 1. 个人设置（P1）

后端 `GET/PATCH /auth/me`、`POST /auth/change-password` 都已完成，前端只有 Header 里的头像和退出按钮。

### 1.1 学习目标（已完成 2026-10-17）

- [x] 新建 `components/SettingsModal.tsx`，弹窗样式复用 `StatsModal` 的 `modal-overlay` / `modal-card`
- [x] 两个数字输入：每日新词（1-200）、每日分钟（1-600），前端先校验范围（`utils/settings.ts`）
- [x] 保存时调用 `progress.setSettings`，只提交有改动的字段
- [x] 看板标题栏加"学习目标"按钮，设置弹窗叠在看板上方，Esc 只关闭最上层
- [x] 测试：`utils/settings.test.ts`（校验规则、`viewState` 立即生效、同步后 `pendingSettings` 清空）
- [ ] 待 1.4 用户菜单完成后，在菜单里也放一个入口

### 1.2 昵称与时区（已完成 2026-10-17）

- [x] 设置弹窗改为"个人设置"，分"个人资料 / 学习目标"两栏；昵称 1-32 位（去掉首尾空格），联网保存，失败时弹窗内提示、不关闭
- [x] `AuthGate` 新增 `handleUserChange`，经 `StudyApp.onUserChange` 更新 Header 显示的昵称
- [x] 时区只读显示浏览器时区（同步时已自动上报）；与服务器记录不同时提示"下次同步会更新、学习日将重新切分"
- [x] 打开设置时静默 `getMe()` 一次，拿到其他设备改过的昵称和同步后更新的时区
- [x] 入口：Header 头像点击打开个人设置；看板"学习目标"按钮打开并直接聚焦目标输入框
- [x] 后端：注册昵称去空格（全空白回退为用户名）；`PATCH /me` 昵称去空格、全空白返回 422，补充测试
- [ ] 手动选择时区暂不做：学习日切分依赖浏览器本地时间（`progressCore.studyDayStart`），手动设成和浏览器不同的时区会导致前后端换日不一致

### 1.3 修改密码

- [ ] `api/endpoints.ts` 新增 `changePassword(oldPassword, newPassword)`，请求 `POST /auth/change-password`
- [ ] 设置弹窗加"修改密码"区块：原密码、新密码、确认新密码；新密码规则复用 `LoginPage.tsx` 里的校验（建议抽到 `utils/password.ts`）
- [ ] 改密前先 `progress.syncNow()`，避免未上传的记录被卡在本地
- [ ] 成功后：`setAccessToken(null)` → 提示"密码已修改，请重新登录" → 回到登录页
- [ ] 400「原密码不正确」显示在表单内

### 1.4 入口

- [ ] `Header.tsx` 的 `user-chip` 改成下拉菜单：个人设置 / 修改密码 / （管理员）词库管理 / 退出登录
- [ ] 下拉菜单需要支持键盘操作（Enter 打开、Esc 关闭、方向键切换）和 `aria-expanded`

---

## 2. 收藏（P1）

`useProgress.favorite()` 和后端 `favorite` 事件都已就绪，`mindMapTransformer.ts` 也算出了 `view.favorite`，只是没有渲染和点击处理。

- [ ] `utils/mindMapTransformer.ts` 的 `renderProgressBadgeHtml` 加一个星标按钮：`<button class="favorite-btn" data-word-id data-root-id aria-pressed>`
- [ ] `components/MindMapBoard.tsx` 的点击处理（目前只处理 `.audio-btn`）加上 `.favorite-btn`，调用新增的 `onFavorite(wordId, rootId)` prop
- [ ] `App.tsx` 把 `progress.favorite` 传给 `MindMapBoard`
- [ ] 默写 / 考核模式下是否显示星标要定一下（建议只在浏览模式显示，避免误触）
- [ ] `getProgressRenderKey` 已包含 `favorite`，确认切换后节点会重新渲染
- [ ] `App.css` 加 `.favorite-btn` 样式（未收藏描边、已收藏实心）
- [ ] 看板加"我的收藏"列表（可选，见 3.3）

---

## 3. 学习看板（P1，需先做决定）

### 3.0 决定数据来源

`StatsModal.tsx` 目前全部用本地 `utils/stats.ts` 计算，后端 `/api/stats/*` 八个接口前端都没调用。

- [ ] 方案 A：继续本地计算。好处是离线可用、打开即显示。后端 stats 接口留给以后的小程序 / 管理后台用，在 `API.md` 注明
- [ ] 方案 B：改为调用 `/api/stats/dashboard`。好处是多设备一致，规则只维护一份。坏处是要处理加载中、离线和未同步记录不计入的问题
- [ ] 方案 C（建议）：本地计算为主，打开看板时如果有待上传记录先触发一次 `syncNow()`；两边规则继续靠 `progress-parity.json` 保证一致，在 `utils/stats.ts` 也补一份 parity 测试

### 3.1 已经算好但没显示的指标

`utils/stats.ts` 里这几个函数已经写好并有测试，看板没用到：

- [ ] `getTrend(state, now, 7)`：近 7 天学习时长 / 单词数的柱状图
- [ ] `getDueForecast(state, now, 7)`：未来 7 天到期单词数
- [ ] `getHourlyDistribution(state)`：学习时段分布（24 小时）
- [ ] `getForgettingRate(state)`：遗忘率，可放在副标题或概览卡片
- [ ] 画图前先确认用纯 CSS / SVG 还是引入图表库（目前依赖里没有图表库，建议先用 SVG，不加依赖）

### 3.2 词根掌握概况

- [ ] `summarizeRoot` 目前只用在导图的词根节点上；看板可加一个词根列表（已掌握 / 学习中 / 未学 / 待复习），点击跳到对应词根
- [ ] 跳转需要 `StatsModal` 拿到 `goToRoot` 回调，并经过 `confirmDiscard()` 检查

### 3.3 今日复习

- [ ] `getDueWordIds` 已有，但只显示了数量。加一个"开始复习"按钮，把待复习单词组成一轮练习
- [ ] 当前练习以词根为单位（`App.tsx` 的 `currentRoot`），复习要跨词根，需要设计一个虚拟词根或单独的复习视图
- [ ] 难词列表（`getDifficultWords`）同理，可以做成"错题重练"

---

## 4. 词库管理（P1，仅管理员）

后端增删改查和批量导入都已完成并有测试，前端 `user.isAdmin` 完全没用到，目前只能跑 `scripts/seed_vocab.py`。

### 4.1 接口封装（`api/endpoints.ts`）

- [ ] `getRootsBrief()` → `GET /vocab/roots/brief`
- [ ] `createRoot(root)` / `updateRoot(id, patch)` / `deleteRoot(id)`
- [ ] `createWord(rootId, word)` / `updateWord(id, patch)` / `deleteWord(id)`
- [ ] `importRoots(roots, mode)` → `POST /vocab/import`
- [ ] 补充 `RootIn` / `WordIn` 类型，字段长度限制和 `API.md` 保持一致

### 4.2 管理界面

- [ ] 新建 `components/admin/VocabAdmin.tsx`：左侧词根列表（带单词数），右侧当前词根的单词表格
- [ ] 词根：新增、改名 / 改释义、调整顺序（`sortOrder`）、删除（二次确认，提示会连带删除单词）
- [ ] 单词：新增、行内编辑全部字段、移动到其他词根（`rootId`）、删除
- [ ] 音频地址只允许 `http(s)://`，前端先校验
- [ ] 保存失败时显示后端 `detail`（409 / 404 / 422）

### 4.3 批量导入

- [ ] 支持导入 JSON（格式同 `shared/seed-roots.json`）
- [ ] 支持导入 Excel：根目录已有 `en.xlsx`，需要确认列格式；前端解析需引入库（如 SheetJS），或在后端加一个上传接口，二选一
- [ ] 导入前预览：词根数、单词数、与现有词库重复的拼写
- [ ] `replace` 模式醒目警告：旧单词的学习记录会变成孤儿数据（见 6.4）
- [ ] 单次最多 500 个词根，超出时前端自动分批

### 4.4 改完后刷新导图

- [ ] 目前词库只在 `AuthGate.loadSession` 加载一次。管理操作后需要重新拉取 `getRoots()` 并更新 `phase.roots`
- [ ] 刷新后 `rootIndex` 可能越界（词根被删），`App.tsx` 要做边界处理
- [ ] 其他用户不会自动看到新词库，可以在 5 分钟定期同步时顺带检查词库版本（后端需加 `updatedAt` 或版本号，可选）

### 4.5 重算进度

- [ ] `api/endpoints.ts` 新增 `rebuildProgress()` → `POST /progress/rebuild`
- [ ] 放在设置弹窗的"高级"区域，说明用途；完成后用返回结果 `applyServer` 覆盖本地 base

---

## 5. 登录与会话细节（P2）

- [ ] 关闭注册（`ALLOW_REGISTRATION=false`）时，`LoginPage.tsx` 仍显示注册页签。方案：后端 `/api/health` 或新接口返回 `allowRegistration`，前端据此隐藏
- [ ] 429 登录限流：后端返回了 `Retry-After`，前端只显示文字；可以禁用登录按钮并倒计时
- [ ] 注册成功后是否提示"你是第一个用户，已成为管理员"
- [ ] 词库为空时（`AuthGate.tsx` 的 `ready` 分支）提示的是后端命令。改为：管理员显示"去导入词库"按钮跳到 4.2；普通用户显示"请联系管理员"
- [ ] 页面关闭时的 keepalive 同步请求不会刷新 token，access token 过期（30 分钟）时这批会 401。不会丢数据（下次打开会重传），可以接受，在代码注释里写明即可
- [ ] `lastSyncedAt` 已返回但没显示，放到 Header 同步按钮的 `title` 里，如"上次同步：3 分钟前"
- [ ] 同步状态为 `error`（4xx，如 413、422）时，现在只在控制台打印。需要给用户可见的提示，否则会一直 30 秒重试同一批坏数据

---

## 6. 清理与一致性（P2）

- [ ] `getProgress`（`GET /progress`）已封装未使用，`/sync` 已覆盖拉取功能。删除，或在 API 层注释说明保留原因
- [ ] `GET /vocab/roots/{id}` 未使用。词库变大后可改为先拉 `roots/brief` 再按词根懒加载；目前词库小，暂不需要
- [ ] `src/mock/roots.ts` 现在只用于旧数据迁移，在文件头注明，避免误以为还是数据源
- [ ] 词库 `replace` 导入后，旧 wordId 的 `WordProgress` 仍在 `state.words` 里，`getOverallSummary` 用传入的 wordIds 过滤所以不影响总数，但难词列表 `getDifficultWords` 可能出现已不存在的单词，需要按当前词库过滤（`StatsModal` 里 `wordIndex.get()` 取不到时目前如何显示要确认）
- [ ] 前端 `utils/stats.ts` 和后端 `services/stats.py` 也是两份规则（连续打卡、难词、遗忘率），目前没有共享 fixture，建议仿照 `progress-parity.json` 补一份

---

## 7. 部署（P2）

### 7.1 方案

- [ ] 选择托管方式：Nginx 托管 `frontend/dist` 并反代 `/api` 到 uvicorn（建议），或 FastAPI 挂载静态目录
- [ ] 前后端同源部署，Cookie 不需要跨域；如果分域部署，需要改 `SameSite`、`CORS_ORIGINS`，并把前端 `credentials: 'same-origin'` 改为 `include`
- [ ] 写 Nginx 配置样例：静态文件、`/api` 反代、SPA 回退到 `index.html`、gzip、静态资源缓存

### 7.2 后端配置（`backend/.env`）

- [ ] `DEBUG=false`（关闭 Swagger）
- [ ] `COOKIE_SECURE=true`，全站 HTTPS
- [ ] `JWT_SECRET` 用随机长串
- [ ] `CORS_ORIGINS` 设为正式域名
- [ ] 第一个账号注册完成后设 `ALLOW_REGISTRATION=false`（如果不对外开放）
- [ ] 数据库账号只给应用库权限，改掉 `scripts/init_db.sql` 里的默认密码

### 7.3 运行与运维

- [ ] uvicorn 多 worker 或 gunicorn 启动；此时登录限流（`core/ratelimit.py`，进程内存）不共享，需改为 Redis 或接受限流变宽松
- [ ] 进程守护（systemd / Docker）
- [ ] 部署时执行 `alembic upgrade head`
- [ ] MySQL 定期备份
- [ ] 过期 refresh token 的清理任务（`refresh_tokens` 表会一直增长）
- [ ] 可选：Dockerfile + docker-compose（MySQL + 后端 + Nginx）

---

## 8. 测试（P2）

- [ ] 前端没有组件测试：至少给 `LoginPage`（校验、错误显示）和 `AuthGate`（refresh 成功 / 过期 / 离线三种分支）补测试
- [ ] `useProgress` 的同步流程（分批、失败重试、请求期间新增记录不丢）只测了 `syncStore` 纯函数，hook 本身没测
- [ ] 端到端：起后端（SQLite）+ 前端，跑一遍 注册 → 作答 → 同步 → 换浏览器登录 → 进度一致
- [ ] 后端测试在 MySQL 上跑一次（`TEST_DATABASE_URL`），确认和 SQLite 行为一致

---

## 9. 文档（P2）

- [ ] `frontend/README.md` 已过时：仍写"记录保存在浏览器 localStorage""词根数据位于 `src/mock/roots.ts`"。改为后端词库 + 同步，并说明要先启动后端
- [ ] 根目录 `README.md` 补充：第一个注册用户是管理员、如何导入词库、部署文档链接
- [ ] 新增的接口（如 4.4 的词库版本、5 的 `allowRegistration`）同步写进 `backend/API.md`

---

## 建议顺序

1. 6 的清理和 9 的 README（小，先做掉）
2. 1 个人设置 + 1.4 用户菜单（其他功能的入口都挂在这里）
3. 2 收藏
4. 3.0 定看板方案 → 3.1 补图表
5. 4 词库管理
6. 5 会话细节
7. 7 部署、8 测试
