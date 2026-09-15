// 任务链谓词单测：12 环推进与挑战判定边界（Vitest）
import { describe, it, expect } from 'vitest';
import { MISSIONS, MOON_IDS } from './missions.js';
import type { MissionCtx } from '../types.js';

/** 基准上下文：全部为「未完成」状态 */
function baseCtx(over: Partial<MissionCtx> = {}): MissionCtx {
  return {
    layer: 'solar', idx: 0,
    selectedId: null, selType: null, branch: null,
    distToSel: Infinity, distToSun: Infinity, rFromCenter: 30,
    everLeft: false, wellId: null, wellSpeedGain: 0,
    targetRadius: 0, moonsDiscovered: 0,
    ...over,
  };
}

const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;

describe('任务链结构', () => {
  it('共 12 环且 id 唯一', () => {
    expect(MISSIONS).toHaveLength(12);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(12);
  });
  it('卫星目录 9 颗', () => {
    expect(MOON_IDS.size).toBe(9);
  });
});

describe('主线环', () => {
  it('首次接触：锁定任意目标即完成', () => {
    const m = byId('first-lock');
    expect(m.done(baseCtx())).toBe(false);
    expect(m.done(baseCtx({ selectedId: 'earth' }))).toBe(true);
  });
  it('泊入行星：需要行星类型 + 交会/伴飞分支', () => {
    const m = byId('park-planet');
    expect(m.done(baseCtx({ selectedId: 'saturn', selType: 'planet' }))).toBe(false);
    expect(m.done(baseCtx({ selectedId: 'sun', selType: 'sun', branch: 'rendezvous' }))).toBe(false);
    expect(m.done(baseCtx({ selectedId: 'saturn', selType: 'planet', branch: 'rendezvous' }))).toBe(true);
    expect(m.done(baseCtx({ selectedId: 'saturn', selType: 'planet', branch: 'station' }))).toBe(true);
  });
  it('贴日掠过：0.3 AU 阈值', () => {
    const m = byId('sun-graze');
    expect(m.done(baseCtx({ distToSun: 0.31 }))).toBe(false);
    expect(m.done(baseCtx({ distToSun: 0.29 }))).toBe(true);
  });
  it('冲出摇篮：曾离开太阳系层即可', () => {
    const m = byId('leave-home');
    expect(m.done(baseCtx({ idx: 0 }))).toBe(false);
    expect(m.done(baseCtx({ idx: 1 }))).toBe(true);
  });
  it('比邻之行：星际层 + 锁定比邻星 + 伴飞', () => {
    const m = byId('proxima');
    expect(m.done(baseCtx({ layer: 'stellar', selectedId: 'proxima-centauri' }))).toBe(false);
    expect(m.done(baseCtx({ layer: 'stellar', selectedId: 'proxima-centauri', branch: 'rendezvous' }))).toBe(true);
  });
  it('回到家园：曾离开 + 回到太阳系', () => {
    const m = byId('dive-home');
    expect(m.done(baseCtx({ layer: 'solar' }))).toBe(false);
    expect(m.done(baseCtx({ layer: 'solar', everLeft: true }))).toBe(true);
  });
  it('卫星巡礼：任意 3 颗', () => {
    const m = byId('moon-tour');
    expect(m.done(baseCtx({ moonsDiscovered: 2 }))).toBe(false);
    expect(m.done(baseCtx({ moonsDiscovered: 3 }))).toBe(true);
  });
  it('银河之心：锁定 Sgr A*', () => {
    const m = byId('sgr-a');
    expect(m.done(baseCtx({ layer: 'galaxy' }))).toBe(false);
    expect(m.done(baseCtx({ layer: 'galaxy', selectedId: 'sgrA' }))).toBe(true);
  });
  it('宇宙边缘：抵达 cosmos 层', () => {
    const m = byId('cosmos-edge');
    expect(m.done(baseCtx({ layer: 'super' }))).toBe(false);
    expect(m.done(baseCtx({ layer: 'cosmos' }))).toBe(true);
  });
});

describe('挑战环（仅手动飞行可完成）', () => {
  it('引力弹弓：木星井内增速 > 20 km/s', () => {
    const m = byId('slingshot');
    expect(m.done(baseCtx({ wellId: 'jupiter', wellSpeedGain: 15 }))).toBe(false);
    expect(m.done(baseCtx({ wellId: 'jupiter', wellSpeedGain: 20.5 }))).toBe(true);
  });
  it('掠日骑士：0.05 AU 阈值', () => {
    const m = byId('sun-knight');
    expect(m.done(baseCtx({ distToSun: 0.051 }))).toBe(false);
    expect(m.done(baseCtx({ distToSun: 0.049 }))).toBe(true);
  });
  it('低轨信使：交会分支 + 1.5 倍半径内', () => {
    const m = byId('low-orbit');
    expect(m.done(baseCtx({ targetRadius: 1, branch: 'rendezvous', distToSel: 1.6 }))).toBe(false);
    expect(m.done(baseCtx({ targetRadius: 1, branch: 'rendezvous', distToSel: 1.4 }))).toBe(true);
    expect(m.done(baseCtx({ targetRadius: 1, branch: 'station', distToSel: 1.4 }))).toBe(false);
  });
});
