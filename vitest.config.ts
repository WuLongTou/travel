import { defineConfig } from 'vitest/config';

// 显式固化单测环境，避免依赖 vitest 默认值被升级静默改变。
// 现有单测全部是纯逻辑（物理/飞控/状态机/单位换算），跑在 node 环境即可；
// 将来加 DOM 相关测试时再按文件级切换 environment: 'happy-dom'
//（或在测试文件头加 // @vitest-environment happy-dom），不要全局切。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
