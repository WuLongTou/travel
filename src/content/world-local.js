// 本星系群层：银河系 + 仙女座星系 M31 + 三角座 M33 + 麦哲伦云等
// 世界单位：Mpc。本星系群尺度 ~几 Mpc（真实：银河-M31 距离约 0.77 Mpc）。
// 教学重点：星系间的真实距离、本地群的成员与引力束缚、与仙女座的碰撞前景。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { mpcToLy } from '../util/units.js';
import { buildGalaxy, buildStarSwarm } from './galaxy-gen.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { LOCAL_GROUP } from './data/local-group.js';

const MPC_KM = 3.0857e19;

// 星系渲染：M31 与银河是对等的棒旋；远近不同给大小/倾斜。简化：全部用一个
// 可配置盘。视觉示意：真实半径 ~kpc 级，但在 Mpc 尺度不可见 → 用「示意大小」
// （视觉可读的弥散光斑），并标注 schematic。
export function buildLocalWorld() {
  const group = new THREE.Group();
  const entities = [];
  const members = LOCAL_GROUP; // [{id,name,en,distMpc(距银河),raDeg,decDeg,type,sizeKpc,note}]
  const rng = Math.random;

  // 麦哲伦云作为银盘旁边的点云；M31/M33 作为独立小星系
  for (const m of members) {
    // 本星系群坐标：银河在原点；成员位置 = ra/dec 方向 × 距离
    const p = direction3d(m.raDeg, m.decDeg, m.distMpc); // Mpc
    // 视觉示意大小：转换为可读光斑（实际 Mpc 尺度不可见）
    const visKpc = m.sizeKpc || 8; // 实际半径 kpc
    const visWorldR = (visKpc / 1000) * 4; // Mpc 尺度下把 8kpc → 0.032 Mpc（仍太小）
    // 由于 1 Mpc 世界里 8kpc = 0.008 —— 完全不可见。所以视觉用「点精灵/小型点云」。
    // 教学简化：用 1 个单位点云 = 星系示意，大小按类型：
    //  M31/银河 = 稍大椭球，矮星系 = 小点。附标签。
    let obj;
    if (m.type === 'spiral') {
      const g = buildStarSwarm(m.id === 'm31' ? 9000 : 6000, 1, { seed: m.seed || 12, flatten: 0.3, color: '#dce6ff', size: 1.8 });
      obj = g;
      obj.scale.set(0.06, 0.06, 0.06);
    } else {
      const g = buildStarSwarm(2000, 1, { seed: m.seed || 5, flatten: 0.8, color: '#d9d2ff', size: 1.2 });
      obj = g;
      obj.scale.set(0.025, 0.025, 0.025);
    }
    obj.position.set(p[0], p[1], p[2]);
    group.add(obj);
    // 标签
    const lbl = makeTextSprite(m.name, { color: '#d4e3ff' });
    const ls = labelScaleFor(lbl, 0.09);
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
  // 银河系（原点）用发光的原点标出
  const mw = buildStarSwarm(9000, 1, { seed: 2024, flatten: 0.28, color: '#e8eeff', size: 1.8 });
  mw.scale.set(0.07, 0.07, 0.07);
  mw.position.set(0, 0, 0);
  group.add(mw);
  const mwLbl = makeTextSprite('银河系（我们）', { color: '#9fe6ff' });
  const mws = labelScaleFor(mwLbl, 0.11);
  mwLbl.scale.set(mws[0], mws[1], 1);
  mwLbl.position.set(0, 0.08, 0);
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

  return {
    id: 'local', title: '本星系群', unitName: 'Mpc', kmPerUnit: MPC_KM,
    worldRadius: 1.2,
    spawn: [0.9, 0.3, 0.9],
    viewDist: 0.6,
    maxSpeedWorldPerS: 0.02, thrustAccWorldPerS2: 0.008, dragPerSec: 0.4, timeScaleMax: 365 * 86400 * 100,
    ambient: { starCount: 2500, starSpread: 4 },
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
