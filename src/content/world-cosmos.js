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
import { GPC_KM, shipMaxSpeed, shipAcc } from './physics.js';

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
    { f: 0.055, label: '~2.5 Gly' },
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

  // 本地群与超星系团实体（原点：下潜进入室女座超星系团与宇宙网）
  const superClusterEnt = {
    id: 'super-cluster', name: '室女座超星系团 · 拉尼亚凯亚', en: 'Virgo Supercluster / Laniakea', type: 'system',
    pos: [0, 0, 0], pickRadius: 1.2,
    schematic: true,
    info: {
      kind: '超星系团', sub: '包含银河系在内的宏观结构',
      facts: [['范围', '跨度约 4 亿光年（120 Mpc）'], ['总质量', '约 10^17 太阳质量'], ['引力流向', '巨引源／矩尺—半人马方向']],
      text: '拉尼亚凯亚超星系团是包含银河系、仙女座星系及约 10 万个星系的大尺度结构（2014 年本动速度场重构提出）。飞近可深入内部宇宙网。',
    },
    dive: { toWorld: 'super', at: [10, 5, 10], dist: 0.35, targetName: '室女超星系团' }, // ≈15 Mpc（本地群与室女团之间）
    visual: { color: '#7fe8ff' },
  };
  entities.push(superClusterEnt);

  const localLabel = makeTextSprite('我们 · 室女超星系团', { color: '#7fe8ff' });
  const llS = labelScaleFor(localLabel, 0.9);
  localLabel.scale.set(llS[0], llS[1], 1);
  localLabel.position.set(0, 0.45, 0);
  group.add(localLabel);

  return {
    id: 'cosmos', title: '可观测宇宙', unitName: 'Gpc', kmPerUnit: GPC_KM,
    intro: '半径约 465 亿光年。橙色边界是宇宙微波背景——大爆炸后 38 万年的余晖；网中的每一个亮点都是一整个星系。',
    worldRadius: OBSERVABLE_RADIUS_GPC * 1.4,
    spawn: [6.9, 2.5, 8.7], // CMB 壳内 0.8 倍半径（同方向），出生即被可观测宇宙边界环绕
    spawnLookAt: [0, 0, 0],
    viewDist: 12,
    shipViewDist: 0.35, // 飞船第三人称跟拍视距
    labelFadeDist: 45,
    // 飞船性能与全层同一真实口径（300 km/s、0.6 m/s²，按 Gpc 单位换算）；
    // 本层无引力井（纯导航层，跨层用导航跃迁），时间倍率上限取千亿年/秒
    maxSpeedWorldPerS: shipMaxSpeed(GPC_KM),
    thrustAccWorldPerS2: shipAcc(GPC_KM), timeScaleMax: 3.15576e18,
    ambient: { starCount: 0, starSpread: 0, cmb: false },
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
