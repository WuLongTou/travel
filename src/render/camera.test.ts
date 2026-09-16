import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChaseCam, type CamTarget } from './camera.js';

function createMockTarget(): CamTarget {
  return {
    pos: [10, 20, 30],
    yaw: 0.5,
    pitch: 0.1,
    forward: () => [0, 0, -1],
    right: () => [1, 0, 0],
    up: () => [0, 1, 0],
  };
}

describe('ChaseCam', () => {
  it('初始化默认状态为 chase 模式与默认转角', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const target = createMockTarget();
    const chase = new ChaseCam(cam, target);

    expect(chase.mode).toBe('chase');
    expect(chase.orbitYaw).toBe(0);
    expect(chase.orbitPitch).toBe(0.35);
    expect(chase.panOffset.x).toBe(0);
    expect(chase.panOffset.y).toBe(0);
    expect(chase.panOffset.z).toBe(0);
  });

  it('resetPan 重置平移偏置与转角', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const target = createMockTarget();
    const chase = new ChaseCam(cam, target);

    chase.panOffset.set(50, -20, 10);
    chase.orbitYaw = 1.2;
    chase.orbitPitch = -0.5;

    chase.resetPan();
    expect(chase.panOffset.x).toBe(0);
    expect(chase.panOffset.y).toBe(0);
    expect(chase.panOffset.z).toBe(0);
    expect(chase.orbitYaw).toBe(0);
    expect(chase.orbitPitch).toBe(0.25);
  });

  it('resetToDefault 完全恢复为追尾模式、平移清零、转角回正并重置视距', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const target = createMockTarget();
    const chase = new ChaseCam(cam, target);

    // 模拟玩家将视角切换到 cockpit，并进行平移与巨大缩放
    chase.cycleView(); // cockpit
    expect(chase.mode).toBe('cockpit');
    chase.panOffset.set(100, 200, 300);
    chase.orbitYaw = 0.8;
    chase.orbitPitch = -0.9;
    chase.followDist = 50000;
    chase.userInteracted = true;

    // 执行一键完全复位
    const defaultDist = 2.5;
    chase.resetToDefault(defaultDist);

    expect(chase.mode).toBe('chase');
    expect(chase.panOffset.x).toBe(0);
    expect(chase.panOffset.y).toBe(0);
    expect(chase.panOffset.z).toBe(0);
    expect(chase.orbitYaw).toBe(0);
    expect(chase.orbitPitch).toBe(0.25);
    expect(chase.followDist).toBe(2.5);
    expect(chase.userInteracted).toBe(false);
  });

  it('resetToDefault 在未提供视距参数时保留合理安全视距并 clamp', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const target = createMockTarget();
    const chase = new ChaseCam(cam, target);

    chase.mode = 'orbit';
    chase.resetToDefault();
    expect(chase.mode).toBe('chase');
    expect(chase.panOffset.length()).toBe(0);
  });
});
