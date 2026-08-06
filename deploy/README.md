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

## 二、给 GitHub Actions 准备 SSH 密钥

在**本机**生成专用密钥（不要用你日常登录密钥上传到仓库）：

```bash
ssh-keygen -t ed25519 -C "github-actions-vibe" -f vibe-deploy -N ""
```

得到：

- `vibe-deploy` → 私钥，放到 GitHub Secret `DEPLOY_SSH_KEY`
- `vibe-deploy.pub` → 公钥，追加到服务器

服务器：

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
# 把 vibe-deploy.pub 内容追加进去
echo "ssh-ed25519 AAAA... github-actions-vibe" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

本机测通：

```bash
ssh -i vibe-deploy root@你的服务器IP "cd /root/Vibe-Research-main && git rev-parse --short HEAD"
```

腾讯云安全组放行 **22**（或你的 SSH 端口）对 GitHub Actions 出口；也可先对 `0.0.0.0/0` 开 22（仅密钥登录）。

## 三、配置 GitHub Secrets

仓库 → **Settings** → **Secrets and variables** → **Actions** → New repository secret：

| Name | 示例 |
|------|------|
| `DEPLOY_HOST` | `1.2.3.4` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | `vibe-deploy` **整个私钥文件内容**（含 `BEGIN`/`END` 行） |
| `DEPLOY_PORT` | `22`（可省略） |
| `DEPLOY_PATH` | `/root/Vibe-Research-main`（可省略） |

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
- **Permission denied (publickey)**：`DEPLOY_SSH_KEY` 不对，或公钥没进 `authorized_keys`。
- **frontend unit not installed**：在服务器执行 `bash deploy/install-systemd.sh`。
- **私有仓库 pull 失败**：给服务器配 GitHub deploy key（只读），`git remote` 用 SSH 地址。
- **构建太慢**：workflow_dispatch 勾选 `no_npm_ci`，或平时用 `bash deploy/update.sh --no-npm-ci`。
