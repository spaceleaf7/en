# EtymoMind 后端

FastAPI + SQLAlchemy 2 + MySQL 8，依赖用 [uv](https://docs.astral.sh/uv/) 管理。

## 首次启动

```bash
cd backend
uv sync                                   # 安装依赖（含测试依赖）

# 1. 建库与应用账号：先把 scripts/init_db.sql 里的密码改掉
mysql -u root -p < scripts/init_db.sql

# 2. 配置：复制后填入上一步的密码，并生成 JWT_SECRET
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"

# 3. 建表、导入示例词库
uv run alembic upgrade head
uv run python -m scripts.seed_vocab

# 4. 启动（前端 npm run dev 会把 /api 代理到这里）
uv run uvicorn app.main:app --reload --port 8000
```

`DEBUG=true` 时接口文档在 http://127.0.0.1:8000/api/docs 。

**第一个注册的账号自动成为管理员**，可以维护词库。其他人注册后只能读取词库。正式部署后如果不想开放注册，设置 `ALLOW_REGISTRATION=false`。

## 接口

| 模块 | 路径 | 说明 |
|---|---|---|
| 认证 | `POST /api/auth/register` `login` `refresh` `logout` | access token 放在响应里；refresh token 放在 httpOnly Cookie 里，每次刷新都换新的 |
| | `GET/PATCH /api/auth/me`、`POST /api/auth/change-password` | 个人信息、学习目标、时区；改密码后其他设备的登录全部失效 |
| 词库 | `GET /api/vocab/roots`、`roots/brief`、`roots/{id}` | 登录后可读 |
| | `POST/PATCH/DELETE roots`、`words`，`POST /api/vocab/import` | 仅管理员 |
| 同步 | `POST /api/progress/sync` | 上传作答日志和学习事件，返回服务端算好的进度 |
| | `GET /api/progress?since=` | 只拉取，按游标分页 |
| 统计 | `GET /api/stats/dashboard` `today` `trend` `hourly` `forecast` `due` `difficult` `roots` | |

## 同步是怎么工作的

客户端不上传算好的熟练度，只上传原始记录：每次作答一条日志，学习时长、听发音、打开页面、收藏也各记一条事件。每条记录带一个客户端生成的唯一 `id`。

服务端按 `(用户, id)` 去重入库，然后把这个用户的全部记录按时间顺序重新计算一遍，得出单词进度和每日统计，返回给客户端覆盖本地。这样设计有几个好处：

- 同一批数据重复上传，结果不变；网络失败后直接重试即可。
- 几台设备各自离线学习，不管谁先同步，最终结果都一样。
- 以后调整规则，调用 `POST /api/progress/rebuild` 就能用历史记录重新计算。

### 前后端规则保持一致

熟练度升降、复习间隔、凌晨 4 点换日这些规则，前端（`frontend/src/store/progressCore.ts`）和后端（`app/services/progress_engine.py`）各实现了一份。两边共用 `shared/progress-parity.json` 里的测试场景：

- 前端 `npm test` 检查 fixture 和前端的计算结果是否一致；
- 后端 `uv run pytest` 用同一个 fixture 检查后端。

有意修改规则时，先改前端，运行 `npm run test:parity:update` 重新生成 fixture，再改后端，直到 pytest 通过。

## 测试

```bash
uv run pytest                                   # 默认用 SQLite 内存库
TEST_DATABASE_URL=mysql+pymysql://... uv run pytest   # 在 MySQL 测试库上跑（会清空该库）
```

## 安全相关

- 密码用 Argon2id 哈希。登录失败时不区分"用户不存在"和"密码错误"。同一 IP 加用户名 15 分钟内失败 5 次就暂时锁定。
- refresh token 数据库里只存哈希。已经换掉的旧 token 如果被再次使用，会被当作盗用，这个用户的所有登录立即失效。
- 正式部署必须走 HTTPS，并设置 `COOKIE_SECURE=true`。`JWT_SECRET` 要用足够长的随机串。
- 登录限流目前存在进程内存里，部署多个实例时需要换成 Redis 这类共享存储。
