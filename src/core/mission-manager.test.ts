import { describe, expect, it } from 'vitest';
import { MissionManager, PROGRESS_KEY } from './mission-manager.js';
import type { Entity } from '../types.js';

class MockStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe('MissionManager', () => {
  it('初始化时读取已有进度并在 save 时序列化', () => {
    const storage = new MockStorage();
    storage.setItem(PROGRESS_KEY, JSON.stringify({ missionIdx: 2, discovered: ['earth', 'moon'] }));

    const mm = new MissionManager(storage);
    expect(mm.missionIdx).toBe(2);
    expect(mm.discovered.has('earth')).toBe(true);
    expect(mm.discovered.has('moon')).toBe(true);

    const snapshot = mm.getProgressSnapshot();
    expect(snapshot.hasProgress).toBe(true);
    expect(snapshot.progressText).toContain('任务进度 2/12');

    mm.reset();
    expect(mm.missionIdx).toBe(0);
    expect(mm.discovered.size).toBe(0);
    expect(storage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('handleParkedEdge: 边沿触发新发现收集与去重回调', () => {
    const storage = new MockStorage();
    let discoveryName = '';
    let dockCount = 0;

    const mm = new MissionManager(storage, {
      onNewDiscovery: (name) => { discoveryName = name; },
      onDock: () => { dockCount++; },
    });

    const mars: Entity = { id: 'mars', name: '火星', type: 'planet', pos: [0, 0, 0], radius: 1, pickRadius: 1 };

    // 泊入火星
    mm.handleParkedEdge(true, mars);
    expect(mm.discovered.has('mars')).toBe(true);
    expect(discoveryName).toBe('火星');
    expect(dockCount).toBe(1);

    // 持续保持泊入状态（非边沿），不应重复触发新发现回调
    discoveryName = '';
    mm.handleParkedEdge(true, mars);
    expect(discoveryName).toBe('');
    expect(dockCount).toBe(1);

    // 离开后再泊入已发现的火星：触发 dock 音效但不触发新发现
    mm.handleParkedEdge(false, mars);
    mm.handleParkedEdge(true, mars);
    expect(discoveryName).toBe('');
    expect(dockCount).toBe(2);
  });

  it('tick: 引力弹弓进出井计速与峰值记录', () => {
    const mm = new MissionManager(new MockStorage());

    // 进入地球井
    mm.tick({
      layerId: 'solar',
      layerIdx: 0,
      selected: null,
      navBranch: null,
      probePos: [0, 0, 0],
      probeSpeedKmS: 12.0,
      dominantWellRefId: 'earth',
      sunPos: null,
    });
    expect(mm.slingWellId).toBe('earth');
    expect(mm.slingVEntry).toBe(12.0);
    expect(mm.slingVPeak).toBe(12.0);

    // 井内加速到 25 km/s
    mm.tick({
      layerId: 'solar',
      layerIdx: 0,
      selected: null,
      navBranch: null,
      probePos: [0, 0, 0],
      probeSpeedKmS: 25.0,
      dominantWellRefId: 'earth',
      sunPos: null,
    });
    expect(mm.slingVPeak).toBe(25.0);

    // 切换到太阳井
    mm.tick({
      layerId: 'solar',
      layerIdx: 0,
      selected: null,
      navBranch: null,
      probePos: [0, 0, 0],
      probeSpeedKmS: 30.0,
      dominantWellRefId: 'sun',
      sunPos: null,
    });
    expect(mm.slingWellId).toBe('sun');
    expect(mm.slingVEntry).toBe(30.0);
    expect(mm.slingVPeak).toBe(30.0);
  });

  it('setMission: 正确设置进度并在达成全通关时触发回调', () => {
    let allDone = false;
    const mm = new MissionManager(new MockStorage(), {
      onAllMissionsDone: () => { allDone = true; },
    });

    expect(mm.setMission(5)).toBe(true);
    expect(mm.missionIdx).toBe(5);
    expect(allDone).toBe(false);

    // 设到 12 环（全通关）
    expect(mm.setMission(12)).toBe(true);
    expect(mm.missionIdx).toBe(12);
    expect(allDone).toBe(true);

    // 非法值
    expect(mm.setMission(-1)).toBe(false);
    expect(mm.setMission(100)).toBe(false);
  });
});
