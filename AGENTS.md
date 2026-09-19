# travel（宇宙航行）

TypeScript strict + three.js 的真实物理太空飞行模拟网页游戏（Vite + Vitest + WebAudio）。

通用约束以全局 `~/AGENTS.md` 为准，本文件只做项目特有补充。

- 包管理器 **pnpm**（`pnpm-lock.yaml` 唯一权威），不要用 npm。
- 命令：`pnpm dev` / `pnpm build`（tsc --noEmit + vite build）/ `pnpm typecheck` / `pnpm test` / `pnpm smoke`（`node scripts/smoke.mjs`，浏览器冒烟基于 agent-browser）。
- 架构与渲染约定见 `docs/ARCHITECTURE.md`，内容管线见 `docs/CONTENT.md`，部署见 `docs/DEPLOY.md`。
