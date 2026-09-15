// 发现图鉴注册表：按尺度层收录「可发现天体」清单，纯逻辑无 DOM。
// 数据来源：每次换层由 main 扫描 world.entities（含 info 的实体即
// 可发现）合并进表——构建过的层条目自动齐全，未构建层保持「尚未抵达」。
// 渲染约定（图鉴惯例，不剧透）：已发现显示名称，未发现显示 ？？？。

import type { Entity, LayerId } from '../types.js';

export interface CodexEntry {
  id: string;
  name: string;
}

export interface CodexLayer {
  total: number;
  /** id → 名称（构建时登记；渲染时按 discovered 集合决定显名或 ？？？） */
  entries: Map<string, string>;
}

/** 层显示顺序与 schema WORLD_DEFS 一致 */
export const CODEX_LAYER_ORDER: LayerId[] = ['solar', 'stellar', 'galaxy', 'local', 'super', 'cosmos'];

const layers = new Map<LayerId, CodexLayer>();

/** 实体是否可发现（可点选且带信息卡——收集玩法的判定口径） */
export function isDiscoverable(e: Entity): boolean {
  return !!e.info && e.selectable !== false && !!e.pickRadius;
}

/**
 * 合并一层的天体清单（幂等：重复登记不覆盖既有名称）。
 * 传入实体数组前先按 isDiscoverable 过滤。
 */
export function registerLayerEntities(layer: LayerId, entities: Entity[]): void {
  let entry = layers.get(layer);
  if (!entry) {
    entry = { total: 0, entries: new Map() };
    layers.set(layer, entry);
  }
  for (const e of entities) {
    if (!isDiscoverable(e)) continue;
    if (!entry.entries.has(e.id)) entry.entries.set(e.id, e.name);
  }
  entry.total = entry.entries.size;
}

/** 该层是否已被探索过（构建过即探索） */
export function layerExplored(layer: LayerId): boolean {
  return layers.has(layer);
}

/** 查询一层快照（副本；未探索返回 null） */
export function getLayer(layer: LayerId): CodexLayer | null {
  const l = layers.get(layer);
  if (!l) return null;
  return { total: l.total, entries: new Map(l.entries) };
}

/** 全局进度：已发现数（对全部已登记层求交集）/ 已登记总数 */
export function codexProgress(discovered: ReadonlySet<string>): { found: number; total: number } {
  let found = 0;
  let total = 0;
  for (const l of layers.values()) {
    total += l.total;
    for (const id of l.entries.keys()) {
      if (discovered.has(id)) found++;
    }
  }
  return { found, total };
}

/** 重置（测试用） */
export function resetCodex(): void {
  layers.clear();
}
