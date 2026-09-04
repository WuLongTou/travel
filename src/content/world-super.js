// 室女超星系团 / 拉尼亚凯亚（宇宙网）层
// 世界单位：Mpc。展示：室女星系团（约 16.5 Mpc）、后发团等邻近结构、
// 宇宙网纤维与巨洞（示意，schematic）。教学重点：超星系团尺度、宇宙网结构、
// “每一点都是星系”——星系际距离的宏观体现。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { buildCosmicWeb, buildStarSwarm } from './galaxy-gen.js';
import { makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { SUPER_STRUCTURES } from './data/super-structures.js';

const MPC_KM = 3.0857e19;

export function buildSuperWorld() {
  const group = new THREE.Group();
  const entities = [];

  // 宇宙网：节点 = 本地群（我们）+ 真实星系团位置（SUPER_STRUCTURES）。
  // 星系点沿节点间"暗物质丝"分布（schematic：丝的走向为示意，节点为真实方位）。
  const nodes = SUPER_STRUCTURES.map((s) => ({
    pos: direction3d(s.raDeg, s.decDeg, s.distMpc),
    w: Math.max(0.5, (s.visRadiusMpc || 3) / 3),
  }));
  nodes.unshift({ pos: [0, 0, 0], w: 0.8 }); // 本地群（丝的交汇近端）
  const webPts = buildCosmicWeb({
    nodes, radius: 85, count: 26000, seed: 17,
    color: '#b9c8ff', size: 1.3, opacity: 0.7,
  });
  group.add(webPts);

  // 知名结构（真实数据回表后填）：室女团中心、后发团等，以星系团光晕+标签
  for (const s of SUPER_STRUCTURES) {
    const pos = direction3d(s.raDeg, s.decDeg, s.distMpc);
    // 团块 = 密集点云 + 中心辉光（星系团的引力中心核心）
    const cl = buildStarSwarm(s.count || 3000, 1, { seed: s.seed || 3, flatten: 1, color: s.color || '#d8d0ff', size: 1.1 });
    const visR = s.visRadiusMpc || 3;
    cl.scale.set(visR, visR * 0.85, visR);
    cl.position.set(pos[0], pos[1], pos[2]);
    group.add(cl);
    const glow = makeGlowSprite(visR * 1.1, s.color || '#d8d0ff', 0.4);
    glow.position.set(pos[0], pos[1], pos[2]);
    group.add(glow);
    if (s.label !== false) { // 默认显示名称标注（label:false 可关闭）
      const lbl = makeTextSprite(s.name, { color: '#ffe2c9' });
      const ls = labelScaleFor(lbl, s.labelSize ? s.labelSize * 0.5 : 2.2);
      lbl.scale.set(ls[0], ls[1], 1);
      lbl.position.set(pos[0], pos[1] + (s.labelSize ? s.labelSize * 0.55 : 2.4), pos[2]);
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
    intro: '尺度上亿光年。星系并非均匀散布，而是沿暗物质丝状结构聚集成「宇宙网」，节点处富集为星系团（丝的走向为示意）。',
    worldRadius: 90,
    spawn: [20, 10, 20],
    spawnLookAt: [0, 0, 0], // 兴趣中心：本地群（原点，丝网交汇近端）
    viewDist: 26,
    labelFadeDist: 110, // 全景下星系团名称仍可读
    maxSpeedWorldPerS: 3.2, thrustAccWorldPerS2: 1.4, dragPerSec: 0.35, timeScaleMax: 365 * 86400,
    ambient: { starCount: 700, starSpread: 120 },
    group, entities,
    update() {},
  };
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
