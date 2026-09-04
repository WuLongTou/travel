// 星际近邻层：太阳系周围 ~60 ly 内的真实恒星系统
// 世界单位：ly。太阳在原点。
// 数据文件：data/stars.js（research 回表后填真值；坐标已含 3D 估算，
// 见数据说明——RA/Dec+距离换算）。
// 教学重点：最近的恒星有多远、恒星类型多样、每颗恒星的“光年”信息卡。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { LY_KM, tempToHex } from '../util/units.js';
import { mulberry32 } from '../util/math.js';
import { makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { STAR_CATALOG } from './data/stars.js';

export function buildStellarWorld() {
  const group = new THREE.Group();
  const entities = [];
  // 背景近邻恒星（暗点，让空间不空）——用 data 里远距恒星或生成填充
  // 先做 catalog 主体
  const STARS = STAR_CATALOG; // [{id,name,en,ra,dec,distLy,spec,tempK,mass,mag}]
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STARS.length * 3);
  const colors = new Float32Array(STARS.length * 3);
  const c = new THREE.Color();
  const starMeshes = [];
  STARS.forEach((s, i) => {
    // ra/dec/距离 → 3D 坐标（银河系标准：以太阳为原点的本地笛卡尔）
    const p = raDecDistToXYZ(s.raDeg, s.decDeg, s.distLy);
    positions[i*3] = p[0]; positions[i*3+1] = p[1]; positions[i*3+2] = p[2];
    c.set(tempToHex(s.tempK || 5800));
    const lum = Math.max(0.25, 0.5 + (s.lumFactor || 0.5));
    colors[i*3] = c.r*lum; colors[i*3+1] = c.g*lum; colors[i*3+2] = c.b*lum;
    // 单独小点球（每颗都建 mesh 成本高，改用一个大 Points + 选中时生成 mesh 太重）
    // —— 简化：全部画进 points，labels 单独。
    starMeshes.push({ s, pos: p });
  });
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  group.add(pts);

  // 交互实体：给「著名/亮」恒星建独立 mesh + 标签，并放进 entities
  const FEATURED = STARS.filter((s) => s.featured);
  const rng = mulberry32(7);
  const all = [];
  STARS.forEach((s, i) => {
    const p = raDecDistToXYZ(s.raDeg, s.decDeg, s.distLy);
    all.push({ s, p });
  });
  for (const { s, p } of all) {
    // 恒星观感 = 小亮核 + 柔光晕（真实星光是点源 + 衍射/散射晕，不是大球）
    const lum = s.lumFactor ?? 0.4;
    const hex = tempToHex(s.tempK || 5800);
    const glow = makeGlowSprite(0.55 + lum * 0.9, hex, 0.85);
    glow.position.set(p[0], p[1], p[2]);
    group.add(glow);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.045 + lum * 0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: hex }),
    );
    core.position.set(p[0], p[1], p[2]);
    group.add(core);
    if (s.showLabel) {
      const lbl = makeTextSprite(s.name, { color: '#cfe6ff' });
      const ls = labelScaleFor(lbl, 0.55);
      lbl.scale.set(ls[0], ls[1], 1);
      // 标签放在光晕外缘上方（亮星光晕直径最大 ~1.45），避免文字糊进亮核
      lbl.position.set(p[0], p[1] + 0.55 + lum * 0.55, p[2]);
      group.add(lbl);
    }
    const facts = [
      ['距离', s.distLy.toFixed(2) + ' 光年'],
      ['光谱型', s.spec || '—'],
      ['表面温度', (s.tempK || '—').toLocaleString() + ' K'],
      ['质量', (s.mass ? '约 ' + s.mass + ' 倍太阳' : '—')],
    ];
    if (s.mag !== undefined) facts.push(['视星等', s.mag]);
    entities.push({
      id: s.id, name: s.name, en: s.en, type: 'star',
      pos: p, pickRadius: 0.5,
      info: {
        kind: '恒星 · ' + (s.spec || ''),
        sub: (s.en || ''),
        facts,
        text: s.desc || '（描述待 research 回表）',
        source: s.source || '待核实',
      },
      visual: { color: tempToHex(s.tempK || 5800) },
    });
  }

  // 太阳位置标签（原点）
  const sunLabel = makeTextSprite('太阳（本层原点）', { color: '#ffd27f', priority: 1 });
  const sunLs2 = labelScaleFor(sunLabel, 0.35);
  sunLabel.scale.set(sunLs2[0], sunLs2[1], 1);
  sunLabel.position.set(0, 0.8, 0);
  group.add(sunLabel);

  return {
    id: 'stellar', title: '星际近邻', unitName: 'ly', kmPerUnit: LY_KM,
    worldRadius: 40,
    spawn: [3, 1.2, 3],
    spawnLookAt: [0, 0, 0], // 兴趣中心：太阳（本层原点）
    viewDist: 6,
    labelFadeDist: 14, // 60 ly 邻域内 featured 恒星标注保持可读
    maxSpeedWorldPerS: 1.6, thrustAccWorldPerS2: 0.7, dragPerSec: 0.4, timeScaleMax: 365 * 86400,
    ambient: { starCount: 4000, starSpread: 260 },
    group, entities,
    update() {},
  };
}

// RA/Dec(deg) + 距离(ly) → 本地 3D 坐标（太阳原点）
// 公式：标准赤道坐标转换
//   x = d·cosδ·cosα ; y = d·cosδ·sinα ; z = d·sinδ
// 但渲染把银河盘面放 XZ、银纬 Y？为视觉习惯把 z 轴向银北极略倾斜可省——
// 这里简单用赤道坐标直转（教学足够），银河带背景只作氛围。
export function raDecDistToXYZ(raDeg, decDeg, distLy) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [
    distLy * Math.cos(dec) * Math.cos(ra),
    distLy * Math.sin(dec),
    distLy * Math.cos(dec) * Math.sin(ra),
  ];
}

// 自注册工厂
registerWorld('stellar', buildStellarWorld);
