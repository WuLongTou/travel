// 室女超星系团 / 拉尼亚凯亚（宇宙网）层
// 世界单位：Mpc。展示：室女星系团（约 16.5 Mpc）、后发团等邻近结构、
// 宇宙网纤维与巨洞（示意，schematic）。教学重点：超星系团尺度、宇宙网结构、
// “每一点都是星系”——星系际距离的宏观体现。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { mpcToLy } from '../util/units.js';
import { buildStarSwarm } from './galaxy-gen.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { SUPER_STRUCTURES } from './data/super-structures.js';
import { mulberry32 } from '../util/math.js';

const MPC_KM = 3.0857e19;

export function buildSuperWorld() {
  const group = new THREE.Group();
  const entities = [];
  const rng = mulberry32(17);

  // 宇宙网纤维：一串沿大圆方向散布的星系点（示意）
  // 视觉：扁丝 + 节点密度起伏
  const N = 12000;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // 采样纤维空间：以原点为中心、半径 80 Mpc 的球内沿随机方向散布，
    // 但加入“丝状”：多数点集中在若干随机大圆/曲线附近。
    const mode = rng();
    let x, y, z;
    const R = 10 + Math.pow(rng(), 0.6) * 60;
    if (mode < 0.55) {
      // 丝：选一条通过原点的方向，点偏移
      const u = randomUnit3();
      const t = (rng() - 0.5) * 2 * 70;
      const perp = randomPerp(u);
      const w = rng() * 6; // 丝粗
      const a = rng() * Math.PI * 2;
      const px = perp[0] * Math.cos(a) * w + perp[1] * Math.sin(a) * w;
      const py = perp[0] * Math.sin(a) * w - perp[1] * Math.cos(a) * w;
      x = u[0] * t + px; y = u[1] * t + py; z = u[2] * t + py * 0.2;
    } else {
      // 巨洞中稀疏点
      const u = randomUnit3();
      const rr = R * (0.3 + rng() * 0.7);
      x = u[0] * rr; y = u[1] * rr; z = u[2] * rr;
    }
    positions[i*3] = x; positions[i*3+1] = y; positions[i*3+2] = z;
    const b = 0.25 + rng() * 0.4;
    c.set('#b9c8ff').multiplyScalar(b);
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
  const webPts = new THREE.Points(geo, mat);
  webPts.frustumCulled = false;
  group.add(webPts);

  // 知名结构（真实数据回表后填）：室女团中心、后发团等，以星系团光晕+标签
  for (const s of SUPER_STRUCTURES) {
    const pos = direction3d(s.raDeg, s.decDeg, s.distMpc);
    // 团块 = 一堆密集点
    const cl = buildStarSwarm(s.count || 3000, 1, { seed: s.seed || 3, flatten: 1, color: s.color || '#d8d0ff', size: 1.1 });
    const visR = s.visRadiusMpc || 3;
    cl.scale.set(visR, visR * 0.85, visR);
    cl.position.set(pos[0], pos[1], pos[2]);
    group.add(cl);
    if (s.label) {
      const lbl = makeTextSprite(s.name, { color: '#ffe2c9' });
      const ls = labelScaleFor(lbl, s.labelSize || 4);
      lbl.scale.set(ls[0], ls[1], 1);
      lbl.position.set(pos[0], pos[1] + (s.labelSize || 4), pos[2]);
      group.add(lbl);
    }
    entities.push({
      id: s.id, name: s.name, en: s.en, type: 'clusterMark',
      pos, pickRadius: Math.max(visR, 2),
      schematic: true,
      info: {
        kind: s.kind || '星系团', sub: (s.en || ''),
        facts: s.facts || [],
        text: s.note || '（描述待 research 回表）',
        source: s.source || '待核实',
      },
      visual: {},
    });
    if (s.dive) entities[entities.length - 1].dive = s.dive;
  }

  return {
    id: 'super', title: '室女·宇宙网', unitName: 'Mpc', kmPerUnit: MPC_KM,
    worldRadius: 90,
    spawn: [20, 10, 20],
    viewDist: 26,
    maxSpeedWorldPerS: 3.2, thrustAccWorldPerS2: 1.4, dragPerSec: 0.35, timeScaleMax: 365 * 86400,
    ambient: { starCount: 1500, starSpread: 120 },
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
function randomPerp(u) {
  let ax = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let d = ax[0] * u[0] + ax[1] * u[1] + ax[2] * u[2];
  let v = [ax[0] - u[0] * d, ax[1] - u[1] * d, ax[2] - u[2] * d];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function direction3d(raDeg, decDeg, distMpc) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [
    distMpc * Math.cos(dec) * Math.cos(ra),
    distMpc * Math.sin(dec),
    distMpc * Math.cos(dec) * Math.sin(ra),
  ];
}

// 自注册工厂
registerWorld('super', buildSuperWorld);
