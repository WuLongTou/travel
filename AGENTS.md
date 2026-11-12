# travel（宇宙航行）

TypeScript strict + three.js 的真实物理太空飞行模拟网页游戏（Vite + Vitest + WebAudio）。

通用约束以全局 `~/AGENTS.md` 为准，本文件只做项目特有补充。

- 包管理器 **pnpm**（`pnpm-lock.yaml` 唯一权威），不要用 npm。
- 命令：`pnpm dev` / `pnpm build`（tsc --noEmit + vite build）/ `pnpm typecheck` / `pnpm test` / `pnpm smoke`（`node scripts/smoke.mjs`，浏览器冒烟基于 agent-browser）。
- 架构与渲染约定见 `docs/ARCHITECTURE.md`，内容管线见 `docs/CONTENT.md`，部署见 `docs/DEPLOY.md`。

## CI 门禁与本地验证分工

重活（依赖安装、全量单测、构建、preview 冒烟）一律交给 GitHub Actions，本地只跑秒级检查。
完整流程见全局 skill `github-ci-flow`：开发分支推送 → `gh pr create` → `gh pr checks --watch`
全绿 → `gh pr merge --rebase --delete-branch` → 本地 `git pull --ff-only` 并清理 worktree。

- 本地（提交前，秒级）：`pnpm typecheck`（`tsc --noEmit` 全量类型检查，实测约 1s）
- CI 覆盖（`.github/workflows/ci.yml`，job `Travel Web (Vite)`）：`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`（vitest）→ `pnpm build` → preview 冒烟（起 `vite preview` 断言 HTTP 200 + HTML）→ 上传 `dist/` 产物（保留 7 天）；push main 与 PR 均触发
- CI 覆盖不到、必须本地/真机验证的：`pnpm smoke`（真浏览器 e2e，依赖本机 agent-browser，按需/发布前执行，不进 CI）
- 发版/发布门禁不变：发布走 `./scripts/deploy.sh`（先跑 `pnpm run test`，再 `pnpm run build` 含 `tsc --noEmit`；`--smoke` 追加无头冒烟，`--push` 才 rsync 推送），发版时照旧执行；详见 `docs/DEPLOY.md`

