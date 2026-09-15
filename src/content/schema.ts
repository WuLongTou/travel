// 内容层统一 Schema 与定义
// 每个尺度层（world）是一个独立坐标空间（世界单位 = 该层 kmPerUnit）。
// world 由 build 函数产出（见 src/worlds/*.js），返回：
//   {
//     id, title, intro, kmPerUnit,                // 1 世界单位 = ? km（真实比例用）
//     unitName,                                    // 显示单位名（如 AU / ly / kpc）
//     worldRadius,                                 // 内容活动半径（世界单位，用于相机与边界）
//     spawn,                                       // 探测球出生点 [x,y,z]
//     maxSpeedWorldPerS,                           // 探测球世界速度上限（世界单位/真实秒，=300 km/s 换算）
//     timeScaleMax,                                // 本层时间倍率上限（模拟钟）
//     ambient: { starDensity, milkyWay, cmb },     // 背景装饰
//     build(engine) => { group, entities, update(dtSim), labelPolicy }  // group 加入场景
//   }
//
// entity（可交互/可下潜对象）统一形状：
//   {
//     id, name, en, type, pos:[x,y,z] (世界单位, 世界中心坐标),
//     pickRadius,                        // 点击检测半径（世界单位）
//     schematic:true,                    // 示意（尺寸/位置非真实比例）
//     info: { kind, sub, facts:[[k,v]...], text, source },
//     dive: { toWorld, at:[x,y,z], targetName },   // 可下潜目标
//     visual: { color, tempK, size, labelOffset }, // 渲染参数
//     body?: 渲染对象引用（引擎填充）
//   }
import type { WorldDef } from '../types.js';

export const WORLD_DEFS: WorldDef[] = [
  { id: 'solar',   name: '太阳系',         short: '太阳系',     color: '#ffd27f' },
  { id: 'stellar', name: '星际近邻',       short: '星际近邻',   color: '#bfe3ff' },
  { id: 'galaxy',  name: '银河系',         short: '银河系',     color: '#9fc4ff' },
  { id: 'local',   name: '本星系群',       short: '本星系群',   color: '#c9a7ff' },
  { id: 'super',   name: '室女·宇宙网',     short: '室女·宇宙网', color: '#ff9ecf' },
  { id: 'cosmos',  name: '可观测宇宙',     short: '可观测宇宙', color: '#8ff0e4' },
];
export const WORLD_BY_ID: Record<string, WorldDef> = Object.fromEntries(WORLD_DEFS.map((w) => [w.id, w]));
