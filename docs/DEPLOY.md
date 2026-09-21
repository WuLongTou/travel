# travel 部署

纯 Vite 静态站：产物是 `dist/`，无服务端组件。

## 日常发布

```bash
./scripts/deploy.sh                  # 门禁＋构建，不推送
./scripts/deploy.sh --smoke          # 追加无头冒烟 e2e（需 agent-browser）
SERVER=<ssh-host> REMOTE_DIR=<服务器 dist 目录> \
  ./scripts/deploy.sh --push         # 构建后 rsync 推送
```

- 门禁与 CI（`.github/workflows/ci.yml`，main 分支强制）一致：
  `typecheck` → `test`（vitest）→ `build`，任一步失败即停。
- 构建产物附带 `dist/.deploy-version`（git describe＋时间），线上核对版本用它。
- 回滚：重新推送上一个版本的 `dist/`（本地保留或 `git stash` 前构建），
  静态站无状态，直接覆盖即回滚。

## CI

push/PR 到 main 自动跑：`pnpm install` → typecheck → test → build →
preview 冒烟（起 `vite preview` 断言 200 + HTML 后关闭）→ 上传 `dist/`
产物留档（保留 7 天）。
`smoke`（真浏览器 e2e）只在本地/部署时按需跑，不进 CI。

## 子路径部署

站点默认按根路径 `/` 构建；挂在域名子路径（如 `example.com/roam/`）时：

```bash
VITE_BASE=/roam/ pnpm build   # 值需带首尾斜杠
```
