// 太阳系层构建器：真实轨道比例 + 可读渲染
// 尺度约定：世界单位 = AU；太阳在原点。
// 现实里行星极小（半径 vs 轨道差 ~4-5 个数量级），全真比例无法直视，
// 因此实体球体用「示意尺寸」渲染（schematic=true 会在信息卡标注），
// 但轨道半径、周期、相对顺序、数量严格用真实数据。
import * as THREE from 'three';
import { PLANETS, SOL, MOONS, ASTEROID_BELT, KUIPER_BELT, SOURCE_NOTE } from './data/solar.js';
import { AU_KM } from '../util/units.js';
import { registerWorld } from './worlds.js';
import { makeSphere, makeRing, makeOrbitLine } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';

// 实体球显示半径（km → 世界单位=AU 不可读，故取对数分级放大）。
// 真实比例中地球半径 6371 km ≈ 4.25e-5 AU，肉眼无法分辨。
// 教学缩放策略：log10(rKm) 与 log10(6371) 的差映射到世界半径。
//   数值 → 视觉：
//     水星 2439km  → 0.06 AU（约 900 万 km）
//     地球 6371km  → 0.085 AU
//     木星 69911km → 0.16 AU
//     土星 58232km → 0.145 AU
//   让每颗都肉眼可辨，且大小关系真实。
function visRadiusKm(rKm) {
  const r = Math.max(rKm, 1500);
  return Math.max(0.06, Math.log10(r / 1500) * 0.06 + 0.06);
}

export function buildSolarWorld() {
  const group = new THREE.Group();
  const entities = [];
  const pickables = [];

  // ---- 太阳 ----
  // 真实半径 ~0.005 AU，渲染放大 80 倍便于看见
  const sunVis = 0.42;
  const sunMesh = makeSphere({
    radius: sunVis,
    color: '#fff3cf',
    emissive: '#ffd27f',
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  sunMesh.position.set(0, 0, 0);
  group.add(sunMesh);
  // 太阳外晕（视觉柔光，避免硬边缘）
  const sunHalo = makeSphere({
    radius: sunVis * 1.6,
    color: '#ffd27f',
    emissive: '#ffd27f',
    emissiveIntensity: 0.4,
    roughness: 1,
  });
  sunHalo.position.set(0, 0, 0);
  sunHalo.material.transparent = true;
  sunHalo.material.opacity = 0.25;
  sunHalo.material.depthWrite = false;
  group.add(sunHalo);

  const sunEntity = {
    id: 'sun', name: '太阳', en: 'Sun', type: 'sun',
    pos: [0, 0, 0], pickRadius: sunVis,
    mesh: sunMesh,
    info: {
      kind: '恒星', sub: `G2V 黄矮星 · ${SOL.tempK.toLocaleString()} K`,
      facts: [
        ['直径', (SOL.rKm * 2).toLocaleString() + ' km（约 109 倍地球）'],
        ['质量', SOL.massKg.toExponential(2) + ' kg'],
        ['表面温度', SOL.tempK.toLocaleString() + ' K'],
        ['年龄', '约 46 亿年'],
        ['光谱型', SOL.spectral],
        ['光到地球', '约 8.3 分钟'],
      ],
      text: `太阳是太阳系的中心恒星，占太阳系总质量的 99.86%。其能量来自核心的氢聚变，每秒把约 6 亿吨氢转化为氦。${SOURCE_NOTE}`,
    },
    visual: { color: '#ffd27f', labelOffset: sunVis * 2.4 },
  };
  entities.push(sunEntity);
  const sunLabel = makeTextSprite('太阳 · Sun');
  const sunLs = labelScaleFor(sunLabel, sunVis * 3.2);
  sunLabel.scale.set(sunLs[0], sunLs[1], 1);
  sunLabel.position.set(0, sunVis * 2.6, 0);
  group.add(sunLabel);

  // ---- 行星 ----
  for (const p of PLANETS) {
    const rVis = visRadiusKm(p.rKm);
    const isGas = p.rKm > 20000;
    const mesh = makeSphere({
      radius: rVis,
      color: p.color,
      emissive: isGas ? p.color : '#000000',
      emissiveIntensity: isGas ? 0.15 : 0,
      roughness: 0.95,
    });
    // 起始角随机；轨道半径严格用真实数据
    const orbitA = p.aAU;
    const startAngle = Math.random() * Math.PI * 2;
    mesh.position.set(Math.cos(startAngle) * orbitA, 0, Math.sin(startAngle) * orbitA);
    group.add(mesh);

    // 环（仅土星；真实环系内径 ~7 万 km，外径 ~14 万 km，渲染按比例缩到行星半径的 1.5–2.5 倍）
    if (p.rings) {
      const ring = makeRing(rVis * 1.5, rVis * 2.4, '#d9cbb0');
      mesh.add(ring);
    }
    // 轨道线
    const ol = makeOrbitLine(orbitA, '#3d5575', 360);
    group.add(ol);
    // 标签（贴行星上方一点；尺寸按行星比例但有最小可读下限）
    const lbl = makeTextSprite(p.name, { color: '#dbe7ff' });
    const ls = labelScaleFor(lbl, Math.max(rVis * 2.4, 0.06));
    lbl.scale.set(ls[0], ls[1], 1);
    lbl.position.set(0, 0, 0); // 跟随 mesh：mesh.add(lbl) 让标签随行星公转
    mesh.add(lbl);

    // 卫星（随行星平移；mesh 作为父节点，moon 作为子节点）
    const moons = MOONS[p.id] || [];
    for (const m of moons) {
      const moonOrbitAU = m.aKm / AU_KM; // 真实距离 AU
      const moonVis = Math.max(visRadiusKm(m.rKm), rVis * 0.22);
      const mm = makeSphere({ radius: moonVis, color: m.color, roughness: 1 });
      // 用随机方位摆放（教学简化：不做卫星轨道动画，仅作为附属点）
      const ma = Math.random() * Math.PI * 2;
      mm.position.set(Math.cos(ma) * moonOrbitAU, 0, Math.sin(ma) * moonOrbitAU);
      mesh.add(mm);
    }

    const entity = {
      id: p.id, name: p.name, en: p.en, type: 'planet',
      pos: [Math.cos(startAngle) * orbitA, 0, Math.sin(startAngle) * orbitA],
      pickRadius: Math.max(rVis, 0.05),
      mesh, // 关键：让 update 能驱动位置
      schematic: true, // 尺寸为示意
      info: {
        kind: p.moons ? '行星 · 气态巨行星' : '行星 · 岩石行星',
        sub: `距太阳 ${p.aAU} AU · 公转 ${p.periodD.toFixed(1)} 天`,
        facts: [
          ['直径', (p.rKm * 2).toLocaleString() + ' km'],
          ['质量', p.massKg.toExponential(2) + ' kg'],
          ['距太阳', p.aAU + ' AU（' + (p.aAU * AU_KM / 1e6).toFixed(1) + ' 百万 km）'],
          ['公转周期', p.periodD.toFixed(1) + ' 天'],
          ['自转周期', Math.abs(p.rotH).toFixed(1) + (p.rotH < 0 ? ' 小时（逆行）' : ' 小时')],
          ['卫星', p.moons + ' 颗'],
        ],
        text: p.desc + ' 此处展示的行星大小与间距已做教学缩放（真实比例中行星半径仅轨道距离的约万分之一）。',
        source: SOURCE_NOTE,
      },
      visual: { color: p.color, labelOffset: 0 },
      orbit: { aAU: p.aAU, periodS: p.periodD * 86400, startAngle },
    };
    entities.push(entity);
  }

  // ---- 小行星带（示意点云）----
  {
    const count = ASTEROID_BELT.count;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = ASTEROID_BELT.aMin + Math.random() * (ASTEROID_BELT.aMax - ASTEROID_BELT.aMin);
      const th = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 0.04;
      positions[i*3] = Math.cos(th) * a;
      positions[i*3+1] = y;
      positions[i*3+2] = Math.sin(th) * a;
      const b = 0.35 + Math.random() * 0.3;
      colors[i*3] = b * 0.85; colors[i*3+1] = b * 0.8; colors[i*3+2] = b * 0.68;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.004, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    entities.push({
      id: 'belt', name: '小行星带', en: 'Asteroid belt', type: 'belt',
      pos: [(ASTEROID_BELT.aMin + ASTEROID_BELT.aMax) / 2, 0, 0], pickRadius: 0,
      schematic: true, selectable: false,
      info: { kind: '小行星带', sub: '火星与木星轨道之间', facts: [['范围', '2.2–3.2 AU']], text: '数以百万计的岩石小天体分布在火星与木星之间，总质量约为月球的 3%。' },
    });
  }
  // 柯伊伯带示意点云（更稀疏、更远）
  {
    const count = KUIPER_BELT.count;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = KUIPER_BELT.aMin + Math.random() * (KUIPER_BELT.aMax - KUIPER_BELT.aMin);
      const th = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 0.08;
      positions[i*3] = Math.cos(th) * a;
      positions[i*3+1] = y;
      positions[i*3+2] = Math.sin(th) * a;
      const b = 0.2 + Math.random() * 0.2;
      colors[i*3] = b * 0.65; colors[i*3+1] = b * 0.75; colors[i*3+2] = b * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.006, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    entities.push({
      id: 'kuiper', name: '柯伊伯带', en: 'Kuiper belt', type: 'belt',
      pos: [40, 0, 0], pickRadius: 0, schematic: true, selectable: false,
      info: { kind: '柯伊伯带', sub: '海王星轨道之外', facts: [['范围', '约 30–50 AU']], text: '冥王星等矮行星与冰质小天体所在的环带；奥尔特云则在更遥远的数万 AU 之外。' },
    });
  }

  return {
    id: 'solar', title: '太阳系', unitName: 'AU', kmPerUnit: AU_KM,
    worldRadius: 55,
    spawn: [22, 7, 26],
    spawnLookAt: [0, 0, 0],
    viewDist: 30,
    maxSpeedWorldPerS: 2.2,
    thrustAccWorldPerS2: 1.2, dragPerSec: 0.4, timeScaleMax: 86400 * 365 * 2,
    ambient: { starCount: 3000, starSpread: 600 },
    group, entities, pickables,
    update(dtSim, clock, probe) {
      // 行星轨道动画：真实周期 → 时间倍率足够才明显
      for (const e of entities) {
        if (!e.orbit || !e.mesh) continue;
        const ang = e.orbit.startAngle + (clock.t / e.orbit.periodS) * Math.PI * 2;
        e.mesh.position.set(Math.cos(ang) * e.orbit.aAU, 0, Math.sin(ang) * e.orbit.aAU);
        e.pos = [e.mesh.position.x, e.mesh.position.y, e.mesh.position.z];
      }
    },
  };
}

// 自注册工厂
registerWorld('solar', buildSolarWorld);
