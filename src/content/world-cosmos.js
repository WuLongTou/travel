// 可观测宇宙层：CMB 壳 + 宇宙网全景 + 哈勃深场式背景 + 尺度认知
// 世界单位：Gpc（1 Gpc ≈ 30.86 亿光年；可观测宇宙半径 ~46.5 Gly ≈ 14.2 Gpc? 
// 不——用 Mpc 更顺：可观测宇宙半径 46.5 Gly = 14200 Mpc = 14.2 Gpc。
// 本层用 Gpc，radius = 14.2（可观测半径），CMB 壳画在 14.2。
// 教学重点：可观测宇宙边界即 CMB；宇宙网最大尺度；每颗星点都是一整个星系。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { buildStarSwarm } from './galaxy-gen.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { cmbShell } from '../render/background.js';
import { COSMOS_INFO } from './data/cosmos.js';
import { mulberry32 } from '../util/math.js';

const GPC_KM = 3.0857e22;
export const OBSERVABLE_RADIUS_GPC = 14.2; // ≈46.5 Gly（research 校准）

export function buildCosmosWorld() {
  const group = new THREE.Group();
  const entities = [];

  // 宇宙网：大尺度纤维，每个点 = 一个星系（示意 10^6 点但视觉仅作纹理，
  // 用 60k 点代表）。点密度随离中心（我们）近似均匀——现实中大尺度均匀。
  const N = 60000;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const c = new THREE.Color();
  const rng = mulberry32(23);
  for (let i = 0; i < N; i++) {
    // 填充球（半径=可观测半径），大尺度纤维感由颜色/密度轻微调制
    const u = randomUnit3();
    const r = Math.pow(rng(), 1 / 3) * OBSERVABLE_RADIUS_GPC * 0.92;
    positions[i*3] = u[0] * r;
    positions[i*3+1] = u[1] * r;
    positions[i*3+2] = u[2] * r;
    // 颜色：整体淡蓝/微暖，带红移渐变（远=偏红? 红移是把可见光移向红——
    // 远处星系在视觉上更红（如哈勃深场偏红）——教学示意：
    const zFac = r / (OBSERVABLE_RADIUS_GPC * 0.92);
    const tint = 0.25 + rng() * 0.45;
    c.setRGB(0.65 + 0.35 * zFac * 0.6, 0.7, 0.95).multiplyScalar(tint);
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  group.add(pts);

  // CMB 壳：边界
  const cmbR = OBSERVABLE_RADIUS_GPC;
  const shell = cmbShell(cmbR, 24000);
  group.add(shell);
  entities.push({
    id: 'cmb', name: '宇宙微波背景', en: 'CMB', type: 'cmb',
    pos: [0, 0, 0], pickRadius: 0, selectable: false,
    schematic: true,
    info: { kind: '可观测宇宙边界', sub: '大爆炸的余晖', facts: COSMOS_INFO.cmbFacts, text: COSMOS_INFO.cmbText },
  });

  // 重要尺度标注：壳上放几个「我们到那里的光年」标尺标记（离中心半径处）
  const marks = [
    { f: 0.055, label: '~0.8 Gly（近期星系）' },
    { f: 0.3, label: '~14 Gly' },
    { f: 0.6, label: '~28 Gly' },
    { f: 0.92, label: '~43 Gly' },
  ];
  for (const mk of marks) {
    const lbl = makeTextSprite(mk.label, { color: '#7fd8cf', size: 120 });
    lbl.position.set(0, 0, mk.f * cmbR);
    group.add(lbl);
  }

  // 本地群标注（原点附近极小）
  const localLabel = makeTextSprite('我们 · 本星系群', { color: '#7fe8ff' });
  localLabel.position.set(0, 0.15, 0);
  group.add(localLabel);

  // 一些知名深空目标（数据回表后填，现在放代表性示意）
  // 真实目标：后发星系团等——放 COSMOS_INFO.targets

  return {
    id: 'cosmos', title: '可观测宇宙', unitName: 'Gpc', kmPerUnit: GPC_KM,
    worldRadius: OBSERVABLE_RADIUS_GPC * 1.4,
    spawn: [9, 2.5, 11],
    spawnLookAt: [0, 0, 0],
    viewDist: 14,
    maxSpeedWorldPerS: 2.4, thrustAccWorldPerS2: 1.0, dragPerSec: 0.35, timeScaleMax: 365 * 86400,
    ambient: { starCount: 0, starSpread: 0, cmb: false }, // 本层自带全部
    group, entities,
    update() {},
  };
}

function randomUnit3() {
  const z = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(phi) * r, z, Math.sin(phi) * r];
}

// 自注册工厂
registerWorld('cosmos', buildCosmosWorld);
