#!/usr/bin/env bash
# ── travel 部署脚本（Vite 纯静态站）────────────────────────────
# 流程：门禁（单测）→ 生产构建（前置 tsc --noEmit 全量类型检查）
# →（可选）冒烟 →（可选）推送。
#
# 用法（仓库根目录）：
#   ./scripts/deploy.sh                  # 仅本地：门禁＋构建，产物在 dist/
#   ./scripts/deploy.sh --smoke          # 追加无头冒烟 e2e（需 agent-browser）
#   SERVER=workwork-server REMOTE_DIR=/home/workuser/travel \
#     ./scripts/deploy.sh --push         # 构建后 rsync 推送 dist/ 到服务器
#
# 说明：推送目标由环境变量显式给出，不在脚本里写死服务器路径；
# 未设 SERVER/REMOTE_DIR 时 --push 直接拒绝，避免误推。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SMOKE=0
PUSH=0
for arg in "$@"; do
  case "$arg" in
    --smoke) SMOKE=1 ;;
    --push) PUSH=1 ;;
    *) echo "!! 未知参数: ${arg}（可用 --smoke / --push）"; exit 1 ;;
  esac
done

echo "==> 门禁：单测…"
pnpm run test

echo "==> 生产构建…"
pnpm run build
VERSION="$(git describe --always --tags --dirty 2>/dev/null || echo dev)"
echo "$VERSION $(date -u +%Y-%m-%dT%H:%M:%SZ)" > dist/.deploy-version
echo "==> 产物就绪: dist/（版本 ${VERSION}）"

if [ "$SMOKE" = "1" ]; then
  echo "==> 冒烟 e2e…"
  pnpm run smoke
fi

if [ "$PUSH" = "1" ]; then
  : "${SERVER:?--push 需要 SERVER（如 workwork-server）}"
  : "${REMOTE_DIR:?--push 需要 REMOTE_DIR（服务器 dist 目录）}"
  echo "==> 推送 dist/ → $SERVER:$REMOTE_DIR…"
  rsync -az --delete --exclude '.deploy-version' dist/ "$SERVER:$REMOTE_DIR/"
  scp dist/.deploy-version "$SERVER:$REMOTE_DIR/.deploy-version"
  echo "🎉 部署完成（版本 ${VERSION}）"
else
  echo "未推送（--push 需显式给出 SERVER/REMOTE_DIR）"
fi
