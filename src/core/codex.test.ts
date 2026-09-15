// 图鉴注册表单测：注册幂等性、发现判定、进度统计（Vitest）
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerLayerEntities, layerExplored, getLayer, codexProgress,
  resetCodex, isDiscoverable, CODEX_LAYER_ORDER,
} from './codex.js';
import type { Entity } from '../types.js';

const ent = (id: string, name: string, over: Partial<Entity> = {}): Entity => ({
  id, name, type: 'planet', pos: [0, 0, 0], pickRadius: 1,
  info: { facts: [] },
  ...over,
});

beforeEach(() => resetCodex());

describe('isDiscoverable', () => {
  it('带信息卡可点选 = 可发现', () => {
    expect(isDiscoverable(ent('a', 'A'))).toBe(true);
  });
  it('无信息卡 / 显式不可选 = 不可发现', () => {
    expect(isDiscoverable(ent('b', 'B', { info: undefined }))).toBe(false);
    expect(isDiscoverable(ent('c', 'C', { selectable: false }))).toBe(false);
  });
});

describe('registerLayerEntities', () => {
  it('登记后 layerExplored 且计数正确', () => {
    registerLayerEntities('solar', [ent('earth', '地球'), ent('moon', '月球')]);
    expect(layerExplored('solar')).toBe(true);
    expect(layerExplored('galaxy')).toBe(false);
    expect(getLayer('solar')?.total).toBe(2);
  });
  it('只登记可发现实体', () => {
    registerLayerEntities('solar', [ent('earth', '地球'), ent('x', 'X', { info: undefined })]);
    expect(getLayer('solar')?.total).toBe(1);
  });
  it('多次合并幂等：不覆盖名称、不重复计数', () => {
    registerLayerEntities('solar', [ent('earth', '地球')]);
    registerLayerEntities('solar', [ent('earth', '地球(改名)'), ent('mars', '火星')]);
    const l = getLayer('solar')!;
    expect(l.total).toBe(2);
    expect(l.entries.get('earth')).toBe('地球'); // 首次登记优先
  });
  it('getLayer 返回副本，外部改动不影响表', () => {
    registerLayerEntities('solar', [ent('earth', '地球')]);
    const snap = getLayer('solar')!;
    snap.entries.delete('earth');
    expect(getLayer('solar')?.total).toBe(1);
  });
});

describe('codexProgress', () => {
  it('对已登记层求交集；未探索层不计入总数', () => {
    registerLayerEntities('solar', [ent('earth', '地球'), ent('mars', '火星')]);
    registerLayerEntities('stellar', [ent('proxima', '比邻星')]);
    const discovered = new Set(['earth', 'proxima', 'ghost-id']);
    expect(codexProgress(discovered)).toEqual({ found: 2, total: 3 });
  });
  it('空表进度为零', () => {
    expect(codexProgress(new Set(['x']))).toEqual({ found: 0, total: 0 });
  });
});

describe('层顺序', () => {
  it('与六层由内向外一致', () => {
    expect(CODEX_LAYER_ORDER).toEqual(['solar', 'stellar', 'galaxy', 'local', 'super', 'cosmos']);
  });
});
