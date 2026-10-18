# 开发环境启动（不用 Docker）

前端 Vite（5173）→ 代理 `/api` → 后端 FastAPI（8000）→ 本机 MySQL（3306）。

以下命令在 Git Bash 里执行；PowerShell 里把 `curl` 换成 `curl.exe`。

## 0. 环境检查

```bash
uv --version        # 后端依赖管理
node --version      # 前端，建议 24+
mysql --version     # MySQL 8.x
```

MySQL 服务有没有起来：

```bash
netstat -ano | grep ":3306"     # 有 LISTENING 就是在跑
sc query MySQL80                # 服务名不一定是 MySQL80，以「服务」面板里的为准
net start MySQL80               # 没跑就启动（需要管理员终端）
```

## 1. 建库和账号（只需一次）

先把 `backend/scripts/init_db.sql` 里的密码改成你自己的，再用 root 执行：

```bash
cd backend
mysql -u root -p < scripts/init_db.sql
```

注意：这个脚本会先删掉 `etymomind` 用户再重建，重复执行等于重置密码，库里的数据不受影响。

## 2. 配置 backend/.env

```bash
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # 生成 JWT_SECRET
```

需要改的两项：

- `DATABASE_URL`：`mysql+pymysql://etymomind:密码@127.0.0.1:3306/etymomind?charset=utf8mb4`
  密码里有 `@ : / # ?` 等字符时要做 URL 编码，比如 `@` 写成 `%40`。
- `JWT_SECRET`：至少 32 位，不够会启动报错。

### 检查密码对不对

先用 mysql 客户端直接登录，排除配置文件的问题：

```bash
mysql -u etymomind -p -h 127.0.0.1 etymomind -e "select 1"
```

再用后端自己的配置连一次，确认 `.env` 写对了：

```bash
uv run python -c "from sqlalchemy import text; from app.core.database import engine; engine.connect().execute(text('select 1')); print('DB OK')"
```

看到 `DB OK` 就没问题。常见报错：

| 报错 | 原因 |
|---|---|
| `1045 Access denied` | 用户名或密码错；或者密码含特殊字符没做 URL 编码 |
| `2003 Can't connect` | MySQL 没启动，或端口不是 3306 |
| `1049 Unknown database` | 没执行第 1 步建库 |
| `jwt_secret ... at least 32 characters` | `JWT_SECRET` 太短或没填 |

## 3. 后端：装依赖、建表、导入词库

```bash
cd backend
uv sync
uv run alembic upgrade head          # 建表；以后拉到新迁移也跑这个
uv run python -m scripts.seed_vocab  # 导入示例词库，词库非空会自动跳过
```

检查：

```bash
uv run alembic current               # 显示一个版本号并带 (head) 就是最新
mysql -u etymomind -p -h 127.0.0.1 etymomind -e "show tables; select count(*) from roots;"
```

`roots` 数量大于 0 说明词库导好了。

## 4. 启动

两个终端分别执行：

```bash
cd backend && uv run uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

检查：

```bash
curl http://127.0.0.1:8000/api/health        # 后端直连
curl http://localhost:5173/api/health        # 经 Vite 代理，前端起来后也应该通
```

两个都返回 JSON 就正常。打开 http://localhost:5173 。`DEBUG=true` 时接口文档在 http://127.0.0.1:8000/api/docs 。

第一个注册的账号自动成为管理员，可以维护词库。

## 其他问题

- 端口被占用：`netstat -ano | grep ":8000"` 找到 PID，`taskkill /PID <pid> /F`；或者换端口启动（后端换端口要同步改 `frontend/vite.config.ts` 里的代理地址）。
- 终端里中文乱码：先执行 `export PYTHONUTF8=1`，或在 PowerShell 里执行 `chcp 65001`。
- 前端能打开但登录失败：多半是后端没起来或连不上库，先看后端终端的报错，再走一遍第 2 步的检查。
