// 本星系群层：银河系 + 仙女座星系 M31 + 三角座 M33 + 麦哲伦云等
// 世界单位：Mpc。本星系群尺度 ~几 Mpc（真实：银河-M31 距离约 0.77 Mpc）。
// 教学重点：星系间的真实距离、本地群的成员与引力束缚、与仙女座的碰撞前景。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { mpcToLy } from '../util/units.js';
import { buildGalaxy, buildStarSwarm } from './galaxy-gen.js';import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { LOCAL_GROUP } from './data/local-group.js';
import { GM_SUN_MPC, MPC_KM, shipMaxSpeed, shipAcc } from './physics.js';


// 星系渲染：M31 与银河是对等的棒旋；远近不同给大小/倾斜。简化：全部用一个
// 可配置盘。视觉示意：真实半径 ~kpc 级，但在 Mpc 尺度不可见 → 用「示意大小」
// （视觉可读的弥散光斑），并标注 schematic。
  // 本星系群坐标：银河在原点；成员位置 = ra/dec 方向 × 距离。
  // 旋涡星系渲染为程序化螺旋小盘（真实感），矮星系为松散点云；
  // 尺寸为教学示意（真实 8kpc 在 Mpc 尺度不可见，schematic 标注）。
export function buildLocalWorld() {
  const group = new THREE.Group();
  const entities = [];
  const members = LOCAL_GROUP; // [{id,name,en,distMpc(距银河),raDeg,decDeg,type,sizeKpc,note}]
  let tiltSeed = 0;
  for (const m of members) {
    const p = direction3d(m.raDeg, m.decDeg, m.distMpc); // Mpc
    let obj;
    if (m.type === 'spiral') {
      // 螺旋小盘：M31 更大更亮；每家给不同的盘倾角（视觉可区分）
      tiltSeed += 1;
      obj = buildGalaxy({
        rCore: 0.2, rDisk: 1, arms: 2, pitch: 3.0, barLength: m.id === 'milkyway' ? 0.2 : 0.12,
        countStars: m.id === 'm31' ? 14000 : 9000, armFraction: 0.6,
        flatten: 0.12, tilt: (tiltSeed - 1) * 0.5 - 0.35, seed: m.seed || 12,
      });
      const s = m.id === 'm31' ? 0.075 : 0.055;
      obj.scale.set(s, s, s);
    } else {
      obj = buildStarSwarm(2200, 1, { seed: m.seed || 5, flatten: 0.75, color: '#d9d2ff', size: 1.2 });
      obj.scale.set(0.022, 0.022, 0.022);
    }
    obj.position.set(p[0], p[1], p[2]);
    group.add(obj);
    // 标签（星系盘半径量级，避免大标签糊满屏；大星系优先占位）
    const lbl = makeTextSprite(m.name, { color: '#d4e3ff', priority: m.id === 'm31' ? 2 : (m.id === 'm33' ? 1 : 0) });
    const ls = labelScaleFor(lbl, 0.042);
    lbl.scale.set(ls[0], ls[1], 1);
    lbl.position.set(p[0], p[1] + 0.05, p[2]);
    group.add(lbl);
    // 实体
    const e = {
      id: m.id, name: m.name, en: m.en, type: 'galaxy',
      pos: p, pickRadius: m.type === 'spiral' ? 0.06 : 0.03,
      schematic: true,
      info: {
        kind: m.type === 'spiral' ? '旋涡星系' : m.type === 'dwarf' ? '矮星系' : '星系',
        sub: (m.en || ''),
        facts: [
          ['距银河系', (m.distMpc * 1e6).toFixed(2) + ' 万光年'],
          ['直径', (m.sizeKpc * 3261.6).toFixed(0) + ' 光年（示意）'],
        ].concat(m.extraFacts || []),
        text: m.note || '（描述待 research 回表）',
        source: m.source || '待核实',
      },
      visual: {},
    };
    if (m.dive) {
      e.dive = m.dive; // { toWorld:'galaxy', at:[...], targetName }
    }
    entities.push(e);
  }
  // 银河系（原点）——同螺旋小盘（带中央棒）
  const mw = buildGalaxy({
    rCore: 0.2, rDisk: 1, arms: 2, pitch: 3.2, barLength: 0.2,
    countStars: 14000, armFraction: 0.6, flatten: 0.12, tilt: 0.4, seed: 2024,
  });
  mw.scale.set(0.07, 0.07, 0.07);
  mw.position.set(0, 0, 0);
  group.add(mw);
  const mwLbl = makeTextSprite('银河系（我们）', { color: '#9fe6ff', priority: 2 });
  const mws = labelScaleFor(mwLbl, 0.05);
  mwLbl.scale.set(mws[0], mws[1], 1);
  mwLbl.position.set(0, 0.09, 0);
  group.add(mwLbl);
  entities.push({
    id: 'milkyway', name: '银河系', en: 'Milky Way', type: 'galaxy',
    pos: [0, 0, 0], pickRadius: 0.08, schematic: true,
    info: {
      kind: '棒旋星系', sub: '我们的家 · 本层原点',
      facts: [['直径', '约 10 万光年'], ['恒星数', '数千亿'], ['距 M31', '约 250 万光年']],
      text: '在本尺度（约 250 万光年 = 0.77 Mpc 量级）里，银河系和仙女座星系是相距约 250 万光年的两个邻居，且正在相互接近——约 45 亿年后可能合并。',
      source: 'research 回表后标注',
    },
    dive: { toWorld: 'galaxy', at: [0, 0, 0], dist: 0.35, targetName: '银河系内部' },
  });

  // 真实物理口径：星系井 GM = 总质量（含暗晕）× GM☉（Mpc³/s² 换算）。
  // 质量取核实值：银河系 ≈1.15e12 M☉、仙女座 ≈1.5e12 M☉（信息卡一致）、
  // 三角座 ≈5e10 M☉、大麦云 ≈1.38e10 M☉（信息卡）、小麦云 ≈7e9 M☉。
  // 碰撞半径 = 星系盘半径（kpc→Mpc）。0.77 Mpc 处仙女座圆速度 ≈290 km/s，
  // 与真实本星系群逃逸速度量级一致——银河系与仙女座相互绕行/接近全部真实。
  // 质量为总质量（含暗晕）；lmc/smc 取恒星质量（总质量大一个量级，见 facts 限定）
  const GALAXY_MASS_SUN = { milkyway: 1.15e12, m31: 1.5e12, m33: 5e10, lmc: 1.38e10, smc: 7e9 };
  const DISK_R_MPC = { milkyway: 1.5e-2, m31: 2.3e-2, m33: 9.2e-3, lmc: 2.2e-3, smc: 1.2e-3 }; // 盘半径 kpc→Mpc（与 sizeKpc 半径一致）
  const gravityWells = entities
    .filter((e) => GALAXY_MASS_SUN[e.id])
    .map((e) => ({ ref: e, GM: GM_SUN_MPC * GALAXY_MASS_SUN[e.id], minR: DISK_R_MPC[e.id], capR: 0.25, name: e.name }));

  return {
    id: 'local', title: '本星系群', unitName: 'Mpc', kmPerUnit: MPC_KM,
    intro: '跨度的数百万光年。银河系与仙女座星系正以约 110 km/s 相互接近，预计约 45 亿年后合并。飞近星系可下潜进入。',
    worldRadius: 1.2,
    // 大巡游路线（T 键）：银河系 → 麦哲伦云 → 三角座 → 仙女座压轴
    tourStops: ['milkyway', 'lmc', 'smc', 'm33', 'm31'],
    // 出生在浮升阈值（85% 半径 ≈1.02 Mpc）内侧，靠近银河系一侧
    spawn: [0.45, 0.15, 0.45],
    spawnLookAt: [0, 0, 0], // 兴趣中心：银河系（原点）
    viewDist: 0.6,
    labelFadeDist: 2.4, // 本星系群全景下成员标签可见
    // 飞船性能与全层同一真实口径（300 km/s、0.6 m/s²，按 Mpc 单位换算）；
    // 星系间航行的节奏由时间倍率承担（亿年/秒档下 1 Mpc ≈ 33 墙上秒）
    maxSpeedWorldPerS: shipMaxSpeed(MPC_KM),
    thrustAccWorldPerS2: shipAcc(MPC_KM), timeScaleMax: 3.15576e15,
    ambient: { starCount: 1200, starSpread: 4 },
    gravityWells,
    group, entities,
    update() {},
  };
}

// ra/dec(deg)+距离(Mpc) → 3D（本星系群以银河为原点）
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
registerWorld('local', buildLocalWorld);
