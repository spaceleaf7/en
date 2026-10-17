# EtymoMind 后端接口文档

## 约定

- 基础路径：`/api`。开发时前端经 Vite 代理访问，无需跨域。
- 数据格式：请求与响应均为 JSON，字段名统一 camelCase（请求里写 snake_case 也能识别）。
- 时间戳：除特别说明外，均为毫秒级 Unix 时间戳（`int`）。
- 学习日：按用户时区、凌晨 4 点换日，格式 `YYYY-MM-DD`。
- 调试模式（`DEBUG=true`）下可访问 Swagger：`/api/docs`、`/api/openapi.json`。

### 鉴权

| 标记 | 含义 |
|---|---|
| 公开 | 无需登录 |
| 登录 | 请求头 `Authorization: Bearer <accessToken>` |
| 管理员 | 登录且 `isAdmin = true`（第一个注册的用户自动成为管理员） |

- access token：JWT，默认 30 分钟有效，由前端保存在内存。
- refresh token：放在 httpOnly Cookie `etymomind_refresh`（`Path=/api/auth`，`SameSite=Strict`），默认 30 天。每次刷新都会轮换；已作废的 token 再次被使用时，该用户所有登录状态会被作废。
- 跨域调用需带上 `credentials: "include"`，否则 Cookie 不会发送。

### 错误格式

业务错误：

```json
{ "detail": "用户名或密码错误" }
```

参数校验失败（422）为 FastAPI 默认格式，`detail` 是数组：

```json
{ "detail": [{ "loc": ["body", "password"], "msg": "...", "type": "..." }] }
```

| 状态码 | 场景 |
|---|---|
| 400 | 原密码不正确 |
| 401 | 未登录、token 过期、登录失败 |
| 403 | 未开放注册、需要管理员权限 |
| 404 | 词根 / 单词不存在 |
| 409 | 用户名已被占用 |
| 413 | 单次同步数据过多 |
| 422 | 参数校验失败、无效时区 |
| 429 | 登录失败次数过多（响应头 `Retry-After` 为需等待秒数） |

---

## 系统

### `GET /api/health` 公开

```json
{ "status": "ok" }
```

---

## 认证 `/api/auth`

### `POST /register` 公开 → 201

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 是 | 3-32 位字母、数字、`_`、`-` 或中文，会去掉首尾空格 |
| password | string | 是 | 8-128 位，需同时含字母和数字 |
| nickname | string | 否 | ≤32 位，默认同用户名 |

响应（同时下发 refresh Cookie）：

```json
{ "accessToken": "eyJ...", "tokenType": "bearer", "expiresIn": 1800 }
```

错误：403 当前未开放注册（`ALLOW_REGISTRATION=false`）、409 用户名已被占用。

### `POST /login` 公开

| 字段 | 类型 | 说明 |
|---|---|---|
| username | string | ≤32 位 |
| password | string | ≤128 位 |

响应同注册。错误：401 用户名或密码错误（不区分用户不存在）；同一 IP + 用户名 15 分钟内失败 5 次后返回 429。

> 限流计数保存在进程内存中，多进程 / 多实例部署时不共享。

### `POST /refresh` 公开（需 Cookie）

无请求体，凭 refresh Cookie 换取新的 access token，并下发新的 Cookie。响应同注册。失败返回 401「登录已过期，请重新登录」。

### `POST /logout` 公开 → 204

作废当前 refresh token 并清除 Cookie。没有 Cookie 时也返回 204。

### `GET /me` 登录

```json
{
  "id": 1,
  "username": "alice",
  "nickname": "Alice",
  "isAdmin": true,
  "dailyNewGoal": 10,
  "dailyMinutesGoal": 15,
  "timezone": "Asia/Shanghai"
}
```

### `PATCH /me` 登录

只更新传入的字段，`null` 会被忽略。响应同 `GET /me`。

| 字段 | 类型 | 说明 |
|---|---|---|
| nickname | string | ≤32 位 |
| dailyNewGoal | int | 每日新词目标，1-200 |
| dailyMinutesGoal | int | 每日学习分钟目标，1-600 |
| timezone | string | IANA 时区名，如 `Asia/Shanghai`；无效返回 422 |

### `POST /change-password` 登录 → 204

| 字段 | 类型 | 说明 |
|---|---|---|
| oldPassword | string | 原密码 |
| newPassword | string | 规则同注册 |

成功后作废该用户所有设备的 refresh token 并清除 Cookie，前端需重新登录。原密码错误返回 400。

---

## 词库 `/api/vocab`

### 数据结构

Word：

| 字段 | 类型 | 说明 |
|---|---|---|
| wordId | int | 仅响应 |
| rootId | int | 仅响应 |
| word | string | 1-64 位，必填 |
| phonetic | string | 音标，≤128 |
| phoneticAudio | string | 发音地址，≤512，只允许 `http://` / `https://` |
| chineseMeaning | string | 1-255 位，必填 |
| breakdown | string | 拆解，≤255 |
| exampleSentence | string | 例句，≤2000 |
| exampleAudio | string | 例句音频，≤1024，规则同 phoneticAudio |
| sortOrder | int | 默认 0 |

Root：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 仅响应 |
| rootText | string | 1-64 位，必填 |
| meaning | string | 1-255 位，必填 |
| sortOrder | int | 默认 0 |
| words | Word[] | 创建时可带，最多 200 个 |

列表均按 `sortOrder, id` 升序。

### `GET /roots` 登录

全部词根及其单词（导图一次性加载）。响应 `Root[]`：

```json
[
  {
    "id": 1, "rootText": "spect", "meaning": "看", "sortOrder": 0,
    "words": [
      {
        "wordId": 1, "rootId": 1, "word": "inspect", "phonetic": "/ɪnˈspekt/",
        "phoneticAudio": "", "chineseMeaning": "检查", "breakdown": "in + spect",
        "exampleSentence": "", "exampleAudio": "", "sortOrder": 0
      }
    ]
  }
]
```

### `GET /roots/brief` 登录

不含单词，带单词数：

```json
[{ "id": 1, "rootText": "spect", "meaning": "看", "sortOrder": 0, "wordCount": 12 }]
```

### `GET /roots/{rootId}` 登录

单个 `Root`（含 words）。不存在返回 404。

### `POST /roots` 管理员 → 201

请求体为 Root（可带 `words`），响应创建后的 `Root`。

### `PATCH /roots/{rootId}` 管理员

可传 `rootText`、`meaning`、`sortOrder`，只更新传入字段。响应 `Root`。

### `DELETE /roots/{rootId}` 管理员 → 204

连同下属单词一起删除。

### `POST /roots/{rootId}/words` 管理员 → 201

请求体为 Word（不含 wordId / rootId），响应 `Word`。

### `PATCH /words/{wordId}` 管理员

可传 Word 的任意可写字段，另可传 `rootId` 把单词移到其他词根（目标词根不存在返回 404）。响应 `Word`。

### `DELETE /words/{wordId}` 管理员 → 204

### `POST /import` 管理员

| 字段 | 类型 | 说明 |
|---|---|---|
| roots | Root[] | 最多 500 个 |
| mode | `"append"` \| `"replace"` | 默认 append；replace 会先清空全部词库 |

响应为导入后的 `/roots/brief` 结果。

> replace 后用户的学习记录按 wordId 保留，但对应的旧单词不再显示。

---

## 学习进度 `/api/progress`

客户端只上传原始记录（作答日志 + 学习事件），每条带客户端生成的唯一 `id`。服务端按 `(用户, id)` 去重入库，再按时间顺序回放重建单词进度和每日统计，返回权威结果供客户端覆盖本地。重复上传、多设备离线后先后同步，结果都一致；网络失败直接重试即可。

### `POST /sync` 登录

| 字段 | 类型 | 说明 |
|---|---|---|
| logs | ReviewLog[] | 作答日志，单次最多 2000 条 |
| events | StudyEvent[] | 学习事件，单次最多 2000 条 |
| timezone | string | 可选，IANA 时区；与当前不同时会更新并按新时区重算学习日 |
| since | int | 客户端已有的日志游标，默认 0 |

超出条数返回 413，需分批上传。

ReviewLog：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 客户端唯一 id，1-64 位 |
| wordId | int | |
| rootId | int | |
| skill | `"spell"` \| `"meaning"` \| `"self"` | 拼写 / 释义 / 自评 |
| result | `"correct"` \| `"wrong"` \| `"skip"` | |
| answer | string \| null | 用户作答，≤255 |
| hintLevel | int | 0-3，默认 0 |
| responseMs | int | 作答耗时，0-3600000 |
| at | int | 作答时间戳 |

StudyEvent：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 客户端唯一 id，1-64 位 |
| kind | `"time"` \| `"audio"` \| `"session"` \| `"favorite"` | 学习时长 / 播放发音 / 开始学习 / 收藏 |
| wordId | int \| null | audio、favorite 时使用 |
| value | int | time：毫秒（单条 ≤1 小时）；favorite：1 收藏、0 取消 |
| wordIds | int[] \| null | time 事件关联的单词，最多 500 个 |
| at | int | 事件时间戳 |

请求示例：

```json
{
  "logs": [
    { "id": "c1a2", "wordId": 1, "rootId": 1, "skill": "spell", "result": "wrong",
      "answer": "inspct", "hintLevel": 1, "responseMs": 4200, "at": 1760668800000 }
  ],
  "events": [
    { "id": "e9f0", "kind": "time", "value": 60000, "wordIds": [1], "at": 1760668860000 }
  ],
  "timezone": "Asia/Shanghai",
  "since": 0
}
```

响应 `SyncOut`：

| 字段 | 类型 | 说明 |
|---|---|---|
| acceptedLogs | int | 本次新入库的日志数（重复的不计） |
| acceptedEvents | int | 本次新入库的事件数 |
| words | `{ [wordId]: WordProgress }` | 全量单词进度 |
| daily | `{ [date]: DailyStats }` | 全量每日统计 |
| settings | `{ dailyNewGoal, dailyMinutesGoal }` | |
| logs | ReviewLog[] | 服务端 id > since 的增量日志，每页最多 2000 条 |
| cursor | int | 下次请求用的 since |
| hasMore | bool | 为 true 时用新 cursor 继续拉取 |

WordProgress：

| 字段 | 类型 | 说明 |
|---|---|---|
| wordId / rootId | int | |
| spell / meaning | SkillState | 两项技能分别记录 |
| firstSeenAt | int | |
| masteredAt | int \| null | 两项 level 都 ≥4 时记为掌握 |
| studyMs | int | 累计学习时长 |
| avgResponseMs / responseSamples | int | 平均作答耗时及样本数 |
| audioPlays / hintsUsed | int | |
| recentWrong | string[] | 最近的错误答案 |
| favorite | bool | |

SkillState：`{ correct, wrong, streak, level, lastReviewAt, nextReviewAt }`。level 0-5，复习间隔依次为 0/1/2/4/7/15 天。

DailyStats：

| 字段 | 类型 | 说明 |
|---|---|---|
| date | string | `YYYY-MM-DD` |
| activeMs | int | 学习时长 |
| newWords | int | |
| reviewedWordIds | int[] | |
| masteredWords | int | |
| answers / correct | int | 作答数 / 正确数 |
| audioPlays / sessions | int | |
| firstAt / lastAt | int | 当天首次 / 最后活动时间 |
| hourly | int[24] | 按小时分布 |

### `GET /progress?since=0` 登录

只拉取不上传（如换设备首次登录）。响应同 `/sync`，`acceptedLogs`、`acceptedEvents` 为 0。

### `POST /progress/rebuild` 登录

用全部历史记录重新计算（规则调整后使用）。响应同 `/sync`，日志从游标 0 开始返回。

---

## 学习统计 `/api/stats`

所有接口都需要登录，基于服务端已同步的数据实时计算，按用户时区切分学习日。比率字段为 0-1 小数，没有数据时为 `null`。

### `GET /dashboard`

看板一次要用的全部指标：

```json
{
  "today": { "...": "同 /today，不含 streak" },
  "streak": { "current": 3, "longest": 7 },
  "overview": {
    "total": 300, "mastered": 40, "learning": 60, "fresh": 200,
    "totalMinutes": 520, "totalAnswers": 1800, "accuracy": 0.82
  },
  "trend7": [ "同 /trend 的元素，共 7 天" ],
  "dueForecast7": [12, 5, 8, 0, 3, 9, 2],
  "forgettingRate": 0.18
}
```

- streak：有作答或学习满 1 分钟的日子算打卡；今天还没打卡时从昨天往前算。
- overview：mastered 为两项技能 level 都 ≥4；fresh 为从未学过。
- forgettingRate：到期后才复习的作答中答错的比例。

### `GET /today`

```json
{
  "date": "2026-10-17",
  "newWords": 6, "newGoal": 10,
  "minutes": 12, "minutesGoal": 15,
  "reviewed": 20, "answers": 45, "accuracy": 0.8,
  "completion": 0.7,
  "due": 15,
  "streak": { "current": 3, "longest": 7 }
}
```

`completion` = (新词完成率 + 时长完成率) / 2，单项最高 1。

### `GET /trend?days=30`

days 1-365，默认 30。按日期升序，包含今天：

```json
[{ "date": "2026-10-17", "minutes": 12, "words": 20, "newWords": 6, "accuracy": 0.8 }]
```

### `GET /hourly`

全部历史按小时（0-23 点）汇总的活动分布，返回长度 24 的 `int[]`。

### `GET /forecast?days=7`

days 1-60，默认 7。未来每天到期的单词数，下标 0 为今天（已过期的也计入今天）。返回 `int[]`。

### `GET /due?limit=100`

limit 1-1000，默认 100。今日待复习单词，按到期时间升序：

```json
[{ "wordId": 1, "rootId": 1, "word": "inspect", "chineseMeaning": "检查", "phonetic": "/ɪnˈspekt/" }]
```

### `GET /difficult?limit=20`

limit 1-200，默认 20。难词（答错 ≥3 次，或作答 ≥3 次且正确率 <60%），按答错次数降序：

```json
[{
  "wordId": 1, "rootId": 1, "word": "inspect", "chineseMeaning": "检查", "phonetic": "/ɪnˈspekt/",
  "wrong": 4, "correct": 2, "accuracy": 0.33,
  "commonMistake": { "answer": "inspct", "count": 2 }
}]
```

`commonMistake` 取最近错误答案中出现最多的一个（不区分大小写），没有时为 `null`。

### `GET /roots`

每个词根的掌握概况：

```json
[{ "rootId": 1, "rootText": "spect", "total": 12, "mastered": 3, "learning": 5, "fresh": 4, "due": 2 }]
```
