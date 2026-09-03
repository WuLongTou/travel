// 物理域共享定义（等级判定 / 标签 / 死亡动词 / 事件文案）
// 目录梳理：从 sim.js 抽离，供 sim.js 与 methods/* 各组共用，避免循环依赖。

import { EPS2, COLLECTION_LEVELS } from './config.js';

// ---- 集合系统引力参数（2026-09-03 引力重做，三处统一调用）----
// 澄清一个容易误解的事实：主引力公式 `f = GM/pow(r²+soft, invExp)`
// 中 |a| = f·r ∝ r^(1-2·invExp)——**原实现的 invExp 0.95 本来就是
// 延展 ~1/r 律**（平坦旋转曲线近似，暗物质晕对数势），并非点质量
// 1/r²。用户观测"星系无引力、直接飞过去"的根因不是衰减律，而是
// 星系投放距离（隔离半径 480、投放 900~1800）让航线从不进入星系
// 引力圈；修复靠 ①中景投放（480~720，§3 frontier 三景深）②全部
// 成员天体产生引力（不再要求"已发现"）③集合系统加大软化半径防
// 核内奇点（星系 45、星团 25、黑洞 20——多体系统的质量本来就分布在
// 整个系统尺度上，近场不应按中心质点发散）。曾试过 invExp 0.5
// （|a|∝常数，完全不衰减）——400 外仍 7/s² 狂拉、所有掠过都被
// 捕获，已废弃：延展律取 0.95（≈1/r^0.9）与单天体一致。
export function gravityParamsFor(level) {
  if (!COLLECTION_LEVELS.has(level)) {
    return { soft2: EPS2, invExp: 0.95, mult: 1 };
  }
  if (level === 'blackhole') return { soft2: 400, invExp: 0.95, mult: 1 };
  if (level === 'cluster') return { soft2: 625, invExp: 0.95, mult: 1 };
  return { soft2: 2025, invExp: 0.95, mult: 1 };
}

export function levelForSeed(seed) {
  const g = seed.growth || 0;
  if (g <= 0.01) return 'void';
  if (seed.klass === 'nebula') return 'dust';
  if (seed.klass === 'small') {
    if (g < 0.42) return 'dust';
    return 'planet';
  }
  if (seed.klass === 'medium') {
    if (g < 0.34) return 'dust';
    if (g < 0.72) return 'star';
    return 'cluster';
  }
  if (seed.klass === 'large') {
    if (g < 0.30) return 'dust';
    if (g < 0.58) return 'cluster';
    if (g < 0.88) return 'galaxy';
    return 'supercluster';
  }
  // giant：绝大多数是巨椭圆星系——超大质量晕不必然坍缩成黑洞。
  // 只有少数（确定性 willCollapse 标志）最终坍缩成超大质量黑洞，
  // 符合真实宇宙中"活跃黑洞（吸积盘点亮）极其罕见"的稀疏分布。
  if (g < 0.28) return 'dust';
  if (g < 0.52) return 'cluster';
  if (g < 0.78) return 'galaxy';
  return seed.willCollapse ? 'blackhole' : 'galaxy';
}

// 种子定型：天体在宇宙初始化时就已是最终形态（"本来就在那里"），
// 小球靠近只是"发现"细节（§5.2 渐进发现），而不是"路过才生成"。
// 由 klass + willCollapse 确定性决定最终等级，不再随 growth 演化。
export function finalLevelFor(klass, willCollapse) {
  if (klass === 'small') return 'planet';
  if (klass === 'medium') return Math.random() < 0.65 ? 'star' : 'cluster';
  if (klass === 'large') return Math.random() < 0.78 ? 'galaxy' : 'supercluster';
  if (klass === 'giant') return willCollapse ? 'blackhole' : 'galaxy';
  if (klass === 'nebula') return 'dust';
  return 'void';
}

export const LEVEL_LABELS = {
  void: '原初暗晕',
  dust: '星尘云',
  planet: '行星',
  star: '恒星',
  cluster: '星团',
  galaxy: '星系',
  supercluster: '超星系团',
  blackhole: '黑洞',
};

// 死亡文案：不同天体类型的死法不同，事件提示与特效（见渲染层 DEATH_FX）同步区分
export const DEATH_VERBS = {
  atmosphere: (label) => `🔥 小球坠入【${label}】大气，烧蚀解体`,
  vaporize: (label) => `☀️ 小球被【${label}】吞没汽化`,
  tidal: (label) => `🕳️ 小球被【${label}】潮汐撕碎`,
  generic: (label) => `🛟 小球被【${label}】完全捕获`,
};

export const EVENT_LEVELS = ['planet', 'star', 'cluster', 'galaxy', 'supercluster', 'blackhole'];
// 发现制文案：天体本来就在那里，小球首次接近（生成 detail）才"发现"
export const EVENT_MESSAGES = {
  planet: '🪐 发现一颗行星',
  star: '☀️ 发现一颗恒星',
  cluster: '✨ 发现球状星团',
  galaxy: '🌌 发现旋涡星系',
  supercluster: '🫧 发现超星系团',
  blackhole: '🕳️ 发现超大质量黑洞，吸积盘点亮',
};
