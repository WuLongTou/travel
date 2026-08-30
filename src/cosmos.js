// 宇宙大爆炸动态模拟
// 阶段 1：奇点爆发，物质以极高速度向四面八方喷射（清晰的爆炸闪光 + 冲击波 + 径向流线）。
// 阶段 2：暗物质晕逐个启动，粒子被引力俘获并螺旋下落。
// 阶段 3：从小到大依次形成行星 → 恒星 → 星团 → 星系 → 超星系团 → 超大质量黑洞。

// 聚合入口（目录梳理，2026-08-30）：
//   · 物理域（CosmicSimulation / levelForSeed / LEVEL_LABELS）→ src/core/sim.js
//   · 渲染域（createCosmosRenderer）→ src/render/renderer.js
//   · 常量与默认配置 → src/core/config.js；跨域工具函数 → src/core/utils.js
// 本文件只做 re-export，外部（main.js / smoke-discovery.mjs）的导入路径不变。
export { CosmicSimulation, levelForSeed, LEVEL_LABELS } from './core/sim.js';
export { createCosmosRenderer } from './render/renderer.js';
