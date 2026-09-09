// 各尺度层（世界）配置与工厂注册表
// world = {
//   id, title, unitName, kmPerUnit, worldRadius,
//   spawn: [x,y,z], viewDist(相机初始距离), maxSpeedWorldPerS,
//   thrustAccWorldPerS2, timeScaleMax(模拟钟上限倍率),
//   ambient: {...}, entities: [...], buildAmbientFns...
// }
import { WORLD_DEFS, WORLD_BY_ID } from './schema.js';

// 工厂按 id 注册：async (engine) => world
export const worldFactories = {};

export function registerWorld(id, factory) {
  worldFactories[id] = factory;
}

// 层链（下潜顺序：solar→stellar→galaxy→local→super→cosmos；反向=浮升）
export const LAYER_CHAIN = WORLD_DEFS.map((w) => w.id);
export const CHAIN_INDEX = Object.fromEntries(LAYER_CHAIN.map((id, i) => [id, i]));
