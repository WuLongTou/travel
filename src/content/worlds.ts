// 各尺度层（世界）配置与工厂注册表
// world = {
//   id, title, unitName, kmPerUnit, worldRadius,
//   spawn: [x,y,z], viewDist(相机初始距离), maxSpeedWorldPerS,
//   thrustAccWorldPerS2, timeScaleMax(模拟钟上限倍率),
//   ambient: {...}, entities: [...], buildAmbientFns...
// }
import { WORLD_DEFS } from './schema.js';
import type { GameWorld, LayerId } from '../types.js';

export type WorldFactory = () => Promise<GameWorld> | GameWorld;

// 工厂按 id 注册：() => world（构建可含异步资源）
export const worldFactories: Partial<Record<LayerId, WorldFactory>> = {};

export function registerWorld(id: LayerId, factory: WorldFactory): void {
  worldFactories[id] = factory;
}

// 层链（下潜顺序：solar→stellar→galaxy→local→super→cosmos；反向=浮升）
export const LAYER_CHAIN: LayerId[] = WORLD_DEFS.map((w) => w.id);
export const CHAIN_INDEX: Record<string, number> = Object.fromEntries(LAYER_CHAIN.map((id, i) => [id, i]));
