# 生产部署（systemd + GitHub Actions）

本机 `git push origin main` 后，GitHub Actions 在 Runner 上打包代码，经 **SCP 上传**到服务器，再执行 `deploy/update.sh`。

> 服务器**不必**再 `git pull` GitHub（腾讯云访问 github.com 常出现 `Empty reply from server`）。

## 一、服务器准备

目录默认：`/root/Vibe-Research-main`（与 systemd `WorkingDirectory` 一致）。保留好：

```bash
# 你的配置不要丢
ls /root/Vibe-Research-main/backend/.env
```

首次装服务：

```bash
cd /root/Vibe-Research-main
bash deploy/install-systemd.sh
```

（之后每次由 Actions 覆盖代码并自动 `update.sh`；`.env` 不会被上传包覆盖。）

## 二、SSH 登录方式（密码）

当前 workflow 使用**账号密码** SSH。服务器需允许密码登录：

```bash
grep -E '^(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config
# PasswordAuthentication yes
```

腾讯云安全组放行 **22**。

> 密码写在 GitHub Secrets；改服务器密码后记得同步改 Secret。

## 三、配置 GitHub Secrets

仓库 → **Settings** → **Secrets and variables** → **Actions** → **Repository secrets**：

| Name | 示例 |
|------|------|
| `DEPLOY_HOST` | `1.2.3.4`（纯 IP，无 `http://`） |
| `DEPLOY_USER` | `root` |
| `DEPLOY_PASSWORD` | 你的 SSH 登录密码 |
| `DEPLOY_PORT` | `22`（可省略） |
| `DEPLOY_PATH` | `/root/Vibe-Research-main`（可省略） |
| `NOTIFY_EMAIL` | 更新成功后收件邮箱，可与发件同一 QQ 邮箱 |
| `SMTP_USER` | 发件 QQ 邮箱，如 `you@qq.com` |
| `SMTP_PASS` | QQ 邮箱**授权码**（不是 QQ 密码） |
| `SMTP_HOST` | `smtp.qq.com`（可省略，已是默认） |
| `SMTP_PORT` | `465`（可省略） |
| `SMTP_FROM` | 默认同 `SMTP_USER` |

## 四、启用自动部署

1. push 含 `.github/workflows/deploy.yml` 的提交到 `main`
2. 打开 GitHub → **Actions** → **Deploy production**
3. 也可 **Run workflow** 手动部署；勾选 `no_npm_ci` 可跳过重装前端依赖

流程：

```text
本机 git push
  → Actions checkout + tar 打包（不含 .env / node_modules）
  → SCP 到服务器 /tmp
  → 解压到 DEPLOY_PATH（rsync 删除仓库里已去掉的源文件，恢复 .env）
  → bash deploy/update.sh
  → 成功则发邮件到 NOTIFY_EMAIL（需已配 SMTP）
```

## 五、更新成功发邮件

部署 job **成功结束后**才会发。发信失败不会把整次部署标成失败。在仓库 Secrets 里至少填：

- `NOTIFY_EMAIL`
- `SMTP_USER`
- `SMTP_PASS`

QQ 邮箱：网页登录 [mail.qq.com](https://mail.qq.com) → 设置 → 账号 → 开启 **SMTP** → 生成**授权码**，填进 `SMTP_PASS`。不要填 QQ 登录密码。host/port 可省略（默认 `smtp.qq.com:465`）。

不配这三项时，自动部署照常跑，只是不发信。

## 六、常见问题

- **DEPLOY_HOST is empty**：Secret 必须在 Repository secrets，名字完全一致。
- **Permission denied / auth fail**：检查用户名密码，以及是否允许密码登录。
- **Empty reply from server（旧版 git pull）**：已改为 SCP 上传，更新 workflow 后再跑即可。
- **frontend unit not installed**：`bash deploy/install-systemd.sh`。
- **构建太慢**：workflow_dispatch 勾选 `no_npm_ci`。
- **`Weather.tsx` / 已删除模块仍报 TS2305**：旧部署用 `tar` 覆盖，服务器上会留下已下线文件。新 workflow 会 `rsync --delete` 源码树；当前机器可先手动删再编：
  `rm -f /root/Vibe-Research-main/frontend/src/pages/Weather.tsx && cd /root/Vibe-Research-main && bash deploy/update.sh --frontend-only`
