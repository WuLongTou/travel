// 室女超星系团 / 拉尼亚凯亚（宇宙网）层
// 世界单位：Mpc。展示：室女星系团（约 16.5 Mpc）、后发团等邻近结构、
// 宇宙网纤维与巨洞（示意，schematic）。教学重点：超星系团尺度、宇宙网结构、
// “每一点都是星系”——星系际距离的宏观体现。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import type { Entity, GameWorld, Vec3 } from '../types.js';
import type { WebNode } from './galaxy-gen.js';
import { buildCosmicWeb, buildStarSwarm } from './galaxy-gen.js';
import { makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { SUPER_STRUCTURES } from './data/super-structures.js';
import { GM_SUN_MPC, MPC_KM, shipMaxSpeed, shipAcc } from './physics.js';

export function buildSuperWorld(): GameWorld {
  const group = new THREE.Group();
  const entities: Entity[] = [];

  // 宇宙网：节点 = 本地群（我们）+ 真实星系团位置（SUPER_STRUCTURES）。
  // 星系点沿节点间"暗物质丝"分布（schematic：丝的走向为示意，节点为真实方位）。
  const nodes: WebNode[] = SUPER_STRUCTURES.map((s) => ({
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
    const clEnt: Entity = {
      id: s.id, name: s.name, en: s.en, type: 'clusterMark',
      pos, pickRadius: Math.max(visR, 2),
      schematic: true,
      info: {
        kind: s.kind || '星系团', sub: (s.en || ''),
        facts: s.facts,
        text: s.note || '（描述待 research 回表）',
        source: s.source || '待核实',
      },
      visual: {},
    };
    entities.push(clEnt);
    if (s.dive) clEnt.dive = s.dive;
  }

  // 原点位置：本星系群（可下潜进入本星系群）
  const localGroupEnt: Entity = {
    id: 'local-group', name: '本星系群', en: 'Local Group', type: 'clusterMark',
    pos: [0, 0, 0], pickRadius: 2.5,
    schematic: true,
    info: {
      kind: '星系群', sub: '银河系与仙女座星系所在的群系',
      facts: [['直径', '约 1000–1700 万光年（密度口径不同）'], ['成员星系', '134+（亮星系 50+）'], ['主要成员', '银河系、仙女座星系(M31)、三角座星系(M33)']],
      text: '本星系群是包含银河系在内的小型星系群，位于室女超星系团（拉尼亚凯亚超星系团的一部分）边缘。飞近可自动下潜进入。',
    },
    dive: { toWorld: 'local', at: [0.3, 0.1, 0.3], dist: 0.35, targetName: '本星系群' }, // 群内 ≈0.44 Mpc（银河系近旁）
    visual: { color: '#7fe8ff' },
  };
  entities.push(localGroupEnt);

  // 真实物理口径：星系团井 GM = 总质量 × GM☉（Mpc³/s² 换算），质量取
  // 核实量级（ Virgo ≈1.5e15、Fornax ≈7e13、Coma ≈2e15、Hydra ≈1e14、
  // Centaurus ≈1e14、Perseus ≈1e15 M☉）。碰撞半径 = 团核心半径（上限
  // 3 Mpc——拉尼亚凯亚这类超大结构是「标注」不是可撞天体，其中心就在
  // 本地群附近，给碰撞半径会让浮升落点立即「撞入」）。16.5 Mpc 外室女
  // 团的圆速度 ≈600+ km/s——与真实本地群下落/逃逸速度量级一致。
  const CLUSTER_MASS_SUN: Record<string, number> = {
    'virgo-cluster': 1.2e15, // 2.2 Mpc 内约 1.2e15 'fornax-cluster': 7e13, 'coma-cluster': 1e15, // 信息框 ~7e14，取 1e15 量级
    'hydra-cluster': 1e14, 'centaurus-cluster': 1e14, 'perseus-cluster': 1e15,
  };
  const gravityWells = entities
    .filter((e) => CLUSTER_MASS_SUN[e.id])
    .map((e) => {
      const st = SUPER_STRUCTURES.find((x) => x.id === e.id);
      const coreR = Math.min(3, Math.max(0.5, (st?.sizeKpc ?? 3000) * 0.15 / 1000)); // 团核心半径（Mpc，上限 3）
      return { ref: e, GM: GM_SUN_MPC * CLUSTER_MASS_SUN[e.id], minR: coreR, capR: 8, name: e.name };
    });

  return {
    id: 'super', title: '室女·宇宙网', unitName: 'Mpc', kmPerUnit: MPC_KM,
    intro: '尺度上亿光年。星系并非均匀散布，而是沿暗物质丝状结构聚集成「宇宙网」，节点处富集为星系团（丝的走向为示意）。',
    worldRadius: 90,
    // 大巡游路线（T 键）：本地群出发，沿宇宙网节点逐个造访星系团，拉尼亚凯亚压轴
    tourStops: ['local-group', 'virgo-cluster', 'fornax-cluster', 'coma-cluster', 'perseus-cluster', 'laniakea'],
    spawn: [20, 10, 20],
    spawnLookAt: [0, 0, 0], // 兴趣中心：本地群（原点，丝网交汇近端）
    viewDist: 26,
    labelFadeDist: 110,
    // 飞船性能与全层同一真实口径（300 km/s、0.6 m/s²，按 Mpc 单位换算）；
    // 宇宙网尺度航行的节奏由时间倍率承担（百亿年/秒档下 100 Mpc ≈ 5 分钟）
    maxSpeedWorldPerS: shipMaxSpeed(MPC_KM),
    thrustAccWorldPerS2: shipAcc(MPC_KM), timeScaleMax: 3.15576e17,
    ambient: { starCount: 700, starSpread: 120 },
    gravityWells,
    group, entities,
    update() {},
  };
}

function direction3d(raDeg: number, decDeg: number, distMpc: number): Vec3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [
    distMpc * Math.cos(dec) * Math.cos(ra),
    distMpc * Math.sin(dec),
    distMpc * Math.cos(dec) * Math.sin(ra),
  ] as Vec3;
}

// 自注册工厂
registerWorld('super', buildSuperWorld);
