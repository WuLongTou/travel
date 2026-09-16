import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

// Node 环境补充简易 canvas mock
if (typeof document === 'undefined') {
  const mockCtx = {
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    fillRect: () => {},
    createRadialGradient: () => ({
      addColorStop: () => {},
    }),
  };
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: () => mockCtx,
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => (tag === 'canvas' ? mockCanvas : {}),
  };
}

import {
  makeShip,
  makeShipMarker,
  syncShipPose,
  updateDynamicNearPlane,
  updateShipFlame,
  type ShipSyncContext,
} from './ship.js';

describe('Ship Renderer', () => {
  it('makeShip 创建包含尾焰和辉光的模型', () => {
    const ship = makeShip();
    expect(ship).toBeInstanceOf(THREE.Group);
    expect(ship.userData.flame).toBeTruthy();
    expect(ship.userData.glow).toBeTruthy();

    // 默认未推进时尾焰隐藏
    updateShipFlame(ship, 0, false);
    expect(ship.userData.flame.visible).toBe(false);

    // 推进时显示
    updateShipFlame(ship, 0.8, true);
    expect(ship.userData.flame.visible).toBe(true);
    expect(ship.userData.glow.visible).toBe(true);
  });

  it('syncShipPose 同步位置朝向并根据相机角径计算亚像素光标', () => {
    const ship = makeShip();
    const marker = makeShipMarker();
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 100);
    cam.updateMatrixWorld();

    syncShipPose(ship, marker, {
      probePos: [0, 0, 0],
      probeForward: [0, 0, -1],
      probeRight: [1, 0, 0],
      probeUp: [0, 1, 0],
      kmPerUnit: 149597870.7, // 太阳系 1 AU
      cam,
      viewportHeight: 1080,
      chaseCamMode: 'chase',
    });

    expect(ship.position.x).toBe(0);
    expect(ship.position.y).toBe(0);
    expect(ship.position.z).toBe(0);

    // 在 100 AU 距离下，真实尺度的飞船远小于 14px，marker 应当可见且全亮
    expect(marker.visible).toBe(true);
    expect((marker.material as THREE.SpriteMaterial).opacity).toBeGreaterThan(0.5);

    // 座舱视角下 marker 隐藏
    syncShipPose(ship, marker, {
      probePos: [0, 0, 0],
      probeForward: [0, 0, -1],
      probeRight: [1, 0, 0],
      probeUp: [0, 1, 0],
      kmPerUnit: 149597870.7,
      cam,
      viewportHeight: 1080,
      chaseCamMode: 'cockpit',
    });
    expect(marker.visible).toBe(false);
  });

  it('亚像素光标前方判定用相机当前位姿，不依赖渲染时才刷新的矩阵', () => {
    const ship = makeShip();
    const marker = makeShipMarker();
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    // 从未渲染过（matrixWorldInverse 仍是初始值）——只更新 position/quaternion，
    // 模拟主循环中 syncShipPose 先于 render 执行的真实时序
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, 0);

    const ctx: ShipSyncContext = {
      probePos: [0, 0, 0],
      probeForward: [0, 0, -1],
      probeRight: [1, 0, 0],
      probeUp: [0, 1, 0],
      kmPerUnit: 149597870.7,
      cam,
      viewportHeight: 1080,
      chaseCamMode: 'chase',
    };
    syncShipPose(ship, marker, ctx);
    // 相机朝船看 → 光标可见（高倍率下船的帧位移远大于跟拍视距也稳定）
    expect(marker.visible).toBe(true);

    // 相机背对船（环视别处）→ 不显示
    cam.lookAt(0, 0, 500);
    syncShipPose(ship, marker, ctx);
    expect(marker.visible).toBe(false);
  });

  it('updateDynamicNearPlane 根据视角和视距自适应调整相机 near 面', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 1, 1000);

    // 追尾视角
    updateDynamicNearPlane(cam, 'auto', 'chase', 10, { kmPerUnit: 1, worldRadius: 100 });
    // refDist = 10 -> near = max(0.5, 1e-12) = 0.5
    expect(cam.near).toBeCloseTo(0.5);

    // 上帝视角：根据层半径走
    updateDynamicNearPlane(cam, 'god', 'chase', 10, { kmPerUnit: 1, worldRadius: 100000 });
    // refDist = 100000 * 1e-5 = 1.0 -> near = 0.05
    expect(cam.near).toBeCloseTo(0.05);
  });
});
