-- 用 MySQL 管理员账号执行：mysql -u root -p < scripts/init_db.sql
-- 执行前把密码改成你自己的，并同步填到 backend/.env

CREATE DATABASE IF NOT EXISTS etymomind
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- 先删除可能存在的旧用户（避免 IF NOT EXISTS 跳过导致用户实际不存在）
DROP USER IF EXISTS 'etymomind'@'localhost';
DROP USER IF EXISTS 'etymomind'@'%';
DROP USER IF EXISTS 'myuser'@'%';
DROP USER IF EXISTS 'myuser'@'localhost';

-- 重新创建用户
CREATE USER 'etymomind'@'localhost' IDENTIFIED BY '123456';

-- 授权
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON etymomind.* TO 'etymomind'@'localhost';

FLUSH PRIVILEGES;