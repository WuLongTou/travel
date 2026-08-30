// 渲染域：死亡方式驱动的视觉配置（涟漪环色/重生色/光晕色/扩张/寿命）
// 目录梳理阶段 3：从 renderer 闭包抽离供 probe-fx 引用。

export const DEATH_FX = {
  atmosphere: { ring: 0xff8a4a, launch: 0xffb36b, halo: 0xffc9a0, expand: 6.5, life: 1.6, rings: 1, glow: 0.5 },
  vaporize: { ring: 0xfff3c4, launch: 0xffffff, halo: 0xfff3c4, expand: 12, life: 0.8, rings: 1, glow: 0.9 },
  tidal: { ring: 0xa8d4ff, launch: 0x9fd0ff, halo: 0xbfe0ff, expand: 8.5, life: 1.9, rings: 3, glow: 0.7 },
  generic: { ring: 0x8ef0ff, launch: 0x8ef0ff, halo: 0x9ff0ff, expand: 9, life: 1.1, rings: 1, glow: 0.5 },
};
