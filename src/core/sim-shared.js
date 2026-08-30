// 物理域共享定义（等级判定 / 标签 / 死亡动词 / 事件文案）
// 目录梳理：从 sim.js 抽离，供 sim.js 与 methods/* 各组共用，避免循环依赖。

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
