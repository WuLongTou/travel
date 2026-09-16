import { describe, expect, it } from 'vitest';
import { TourController } from './tour.js';
import type { Entity } from '../types.js';

describe('TourController', () => {
  const e1: Entity = { id: 'p1', name: '行星1', type: 'planet', pos: [1, 0, 0], radius: 0.1, pickRadius: 0.2 };
  const e2: Entity = { id: 'p2', name: '行星2', type: 'planet', pos: [2, 0, 0], radius: 0.1, pickRadius: 0.2 };

  it('少于2个有效站点时提示并拒绝启动', () => {
    let toast = '';
    const tour = new TourController({
      onSelectEntity: () => {},
      onToast: (t) => { toast = t; },
    });

    tour.start({ tourStops: ['p1'], entities: [e1] });
    expect(tour.active).toBe(false);
    expect(toast).toContain('没有巡游路线');
  });

  it('正常启动与手动停止', () => {
    let selectedId = '';
    let toast = '';
    const tour = new TourController({
      onSelectEntity: (e) => { selectedId = e.id; },
      onToast: (t) => { toast = t; },
    });

    tour.start({ tourStops: ['p1', 'p2'], entities: [e1, e2] });
    expect(tour.active).toBe(true);
    expect(selectedId).toBe('p1');
    expect(tour.formatStatus()).toBe('大巡游 1/2');

    tour.stop('巡游结束');
    expect(tour.active).toBe(false);
    expect(toast).toBe('巡游结束');
  });

  it('抵达后进入停留观赏并在倒计时结束后进入下一站', () => {
    let selectedId = '';
    const tour = new TourController({
      onSelectEntity: (e) => { selectedId = e.id; },
      onToast: () => {},
    });

    tour.start({ tourStops: ['p1', 'p2'], entities: [e1, e2] });

    // 位于 p1 泊位内 (d <= lastParkDist * 1.5)，持续 1.3 秒进入 dwell 态
    tour.update(1.3, [1.1, 0, 0], e1, 1.0, [e1, e2]);
    expect(tour.state?.phase).toBe('dwell');
    expect(tour.formatStatus()).toContain('停留');

    // 停留 13 秒后跳到下一站 p2
    tour.update(13.0, [1.1, 0, 0], e1, 1.0, [e1, e2]);
    expect(tour.state?.phase).toBe('enroute');
    expect(tour.state?.idx).toBe(1);
    expect(selectedId).toBe('p2');
  });
});
