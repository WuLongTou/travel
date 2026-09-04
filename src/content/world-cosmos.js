// 可观测宇宙层：CMB 壳 + 宇宙网全景 + 哈勃深场式背景 + 尺度认知
// 世界单位：Gpc（1 Gpc ≈ 30.86 亿光年；可观测宇宙半径 ~46.5 Gly ≈ 14.2 Gpc? 
// 不——用 Mpc 更顺：可观测宇宙半径 46.5 Gly = 14200 Mpc = 14.2 Gpc。
// 本层用 Gpc，radius = 14.2（可观测半径），CMB 壳画在 14.2。
// 教学重点：可观测宇宙边界即 CMB；宇宙网最大尺度；每颗星点都是一整个星系。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { buildCosmicWeb } from './galaxy-gen.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { cmbShell } from '../render/background.js';
import { COSMOS_INFO } from './data/cosmos.js';

const GPC_KM = 3.0857e22;
export const OBSERVABLE_RADIUS_GPC = 14.2; // ≈46.5 Gly（research 校准）

export function buildCosmosWorld() {
  const group = new THREE.Group();
  const entities = [];

  // 宇宙网：大尺度纤维状分布，每个点 = 一个星系（示意）。
  // 节点 = 富集中心（示意网状拓扑；真实制图需 SDSS 巡天数据），
  // 方向与半径均近似均匀（大尺度各向同性），星系沿丝分布、节点富集、巨洞稀疏。
  const R = OBSERVABLE_RADIUS_GPC * 0.92;
  const webNodes = [{ pos: [0, 0, 0], w: 0.6 }]; // 我们（本地群）
  for (let i = 0; i < 14; i++) {
    const u = randomUnit3();
    const rr = R * (0.25 + 0.6 * (i / 13)); // 均匀铺满球体，避免挤在中心
    webNodes.push({ pos: [u[0] * rr, u[1] * rr, u[2] * rr], w: 0.5 + (i % 4) * 0.3 });
  }
  const web = buildCosmicWeb({
    nodes: webNodes, radius: R, count: 70000, seed: 23,
    size: 1.3, opacity: 0.75,
    // 颜色：近处淡蓝白 → 远处偏暖红（哈勃红移的教学示意）
    colorFn: (f) => {
      const r = Math.min(1, f);
      const g = 1 - r * 0.25, b = 1 - r * 0.5;
      return `rgb(${Math.round(255 * (0.82 + r * 0.18))},${Math.round(255 * (0.82 * g))},${Math.round(255 * (0.95 * b))})`;
    },
  });
  group.add(web);

  // CMB 壳：可观测宇宙边界——大爆炸余晖（极淡颗粒，保持"边界感"而非实心球）
  const cmbR = OBSERVABLE_RADIUS_GPC;
  const shell = cmbShell(cmbR, 42000, { size: 1.4, opacity: 0.08 });
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
    const ls = labelScaleFor(lbl, 0.8);
    lbl.scale.set(ls[0], ls[1], 1);
    lbl.position.set(0, 0, mk.f * cmbR);
    group.add(lbl);
  }

  // 本地群标注（原点附近极小）
  const localLabel = makeTextSprite('我们 · 本星系群', { color: '#7fe8ff' });
  const llS = labelScaleFor(localLabel, 0.9);
  localLabel.scale.set(llS[0], llS[1], 1);
  localLabel.position.set(0, 0.35, 0);
  group.add(localLabel);

  // 一些知名深空目标（数据回表后填，现在放代表性示意）
  // 真实目标：后发星系团等——放 COSMOS_INFO.targets

  return {
    id: 'cosmos', title: '可观测宇宙', unitName: 'Gpc', kmPerUnit: GPC_KM,
    intro: '半径约 465 亿光年。橙色边界是宇宙微波背景——大爆炸后 38 万年的余晖；网中的每一个亮点都是一整个星系。',
    worldRadius: OBSERVABLE_RADIUS_GPC * 1.4,
    spawn: [19, 7, 24], // 壳外观测位（半径 ~31.6 Gpc）看全景
    spawnLookAt: [0, 0, 0],
    viewDist: 12,
    labelFadeDist: 45, // 壳外观测位到中心 ~31 Gpc，标注保持可见
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
