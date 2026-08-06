# 生产部署（systemd + GitHub Actions）

本机 `git push origin main` 后，GitHub Actions 经 SSH 登录服务器执行 `git pull` + `deploy/update.sh`。

## 一、服务器先变成 git 仓库

若当前是解压的 zip（没有 `.git`），任选一种：

### 方式 A：旁路 clone 再切过去（推荐，不丢 `.env`）

```bash
# 保留旧目录里的配置
cp /root/Vibe-Research-main/backend/.env /root/vibe.env.bak 2>/dev/null || true

# 公共仓库 HTTPS；私有库请改用 SSH + deploy key
git clone https://github.com/Maxwellpower1/Vibe-Research.git /root/Vibe-Research-git
# 迁回原路径名（与 systemd WorkingDirectory 一致）
systemctl stop vibe-backend vibe-frontend 2>/dev/null || true
mv /root/Vibe-Research-main /root/Vibe-Research-main.bak
mv /root/Vibe-Research-git /root/Vibe-Research-main
cp /root/vibe.env.bak /root/Vibe-Research-main/backend/.env 2>/dev/null || true

cd /root/Vibe-Research-main
bash deploy/install-systemd.sh
```

### 方式 B：在原目录 `git init`（简单但历史从零开始）

```bash
cd /root/Vibe-Research-main
git init
git remote add origin https://github.com/Maxwellpower1/Vibe-Research.git
git fetch origin
git checkout -B main origin/main
# 注意：会覆盖与远程不一致的本地改动；先备份 .env
```

验证：

```bash
cd /root/Vibe-Research-main && git status && git log -1 --oneline
```

## 二、SSH 登录方式（密码）

当前 workflow 使用**账号密码** SSH（与你日常登录一致）。服务器需允许密码登录（腾讯云默认一般已开）：

```bash
# 可选自检
grep -E '^(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config
# PasswordAuthentication yes
# PermitRootLogin yes   # 或 prohibit-password 时需改用密钥
```

腾讯云安全组放行 **22**（或你的 SSH 端口）。

> 密码写在 GitHub Secrets 里；改服务器密码后记得同步改 Secret。更稳妥可日后改回密钥登录。

## 三、配置 GitHub Secrets

仓库 → **Settings** → **Secrets and variables** → **Actions** → New repository secret：

| Name | 示例 |
|------|------|
| `DEPLOY_HOST` | `1.2.3.4` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_PASSWORD` | 你的 SSH 登录密码 |
| `DEPLOY_PORT` | `22`（可省略） |
| `DEPLOY_PATH` | `/root/Vibe-Research-main`（可省略） |

若以前建过 `DEPLOY_SSH_KEY`，可删掉，已不再使用。

## 四、启用自动部署

1. 把本仓库含 `.github/workflows/deploy.yml` 的提交 push 到 `main`
2. 打开 GitHub → **Actions** → **Deploy production**，看是否变绿
3. 也可在 Actions 页点 **Run workflow** 手动部署；勾选 `no_npm_ci` 可跳过重装前端依赖

之后流程：

```text
本机 git push → Actions SSH → 服务器 git reset --hard origin/main → deploy/update.sh
```

## 五、常见问题

- **Not a git repo**：服务器还没按第一节改成 clone。
- **Permission denied / auth fail**：检查 `DEPLOY_USER` / `DEPLOY_PASSWORD`，以及服务器是否允许密码登录。
- **missing server host / DEPLOY_HOST is empty**：Secret 必须建在 **Repository secrets**（不是 Environment secrets），名字精确为 `DEPLOY_HOST`（不要多空格）。改完后重新 Run workflow。
- **frontend unit not installed**：在服务器执行 `bash deploy/install-systemd.sh`。
- **私有仓库 pull 失败**：给服务器配 GitHub deploy key（只读），`git remote` 用 SSH 地址。
- **构建太慢**：workflow_dispatch 勾选 `no_npm_ci`，或平时用 `bash deploy/update.sh --no-npm-ci`。
