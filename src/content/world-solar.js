// 太阳系层构建器：真实轨道比例 + 可读渲染
// 尺度约定：世界单位 = AU；太阳在原点。
// 现实里行星极小（半径 vs 轨道差 ~4-5 个数量级），全真比例无法直视，
// 因此实体球体用「示意尺寸」渲染（schematic=true 会在信息卡标注），
// 但轨道半径、周期、相对顺序、数量严格用真实数据。
import * as THREE from 'three';
import { PLANETS, SOL, MOONS, ASTEROID_BELT, KUIPER_BELT, SOURCE_NOTE } from './data/solar.js';
import { AU_KM } from '../util/units.js';
import { registerWorld } from './worlds.js';
import { makeSphere, makeRing, makeOrbitLine, makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import {
  sunTexture, gasGiantTexture, rockyTexture, earthTexture, venusTexture, iceGiantTexture,
} from '../render/textures.js';

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

// 每颗行星的程序化贴图（真实色彩观感：条纹/陨石坑/海洋大陆）
const PLANET_TEXTURES = {
  mercury: () => rockyTexture({ base: '#b5a396', dark: '#6e6056', light: '#d0c4b6', craterCount: 40, seed: 21 }),
  venus: () => venusTexture({ seed: 22 }),
  earth: () => earthTexture({ seed: 23 }),
  mars: () => rockyTexture({ base: '#d2824a', dark: '#8f4f28', light: '#e8ab74', craterCount: 30, seed: 24 }),
  jupiter: () => gasGiantTexture({
    base: '#e0b88e', bands: ['#c89868', '#f0e0c0', '#a87850', '#e8cc9e'],
    bandCount: 14, spot: { x: 0.32, y: 0.63, rx: 0.06, color: '#c25a3a' }, seed: 25,
  }),
  saturn: () => gasGiantTexture({
    base: '#e6d3a8', bands: ['#d8c090', '#f2e6c4', '#c8ae7c'],
    bandCount: 10, seed: 26,
  }),
  uranus: () => iceGiantTexture({ base: '#9ad9dc', seed: 27 }),
  neptune: () => iceGiantTexture({ base: '#5f86d6', band: 'rgba(40,70,140,0.25)', seed: 28 }),
};

export function buildSolarWorld() {
  const group = new THREE.Group();
  const entities = [];
  const pickables = [];
  const moonAnims = []; // 卫星公转动画：{ mesh(相对行星), aAU, periodS, phase }
  const spins = []; // 行星自转：{ tex, rotPeriodS }（贴图 offset 驱动，不带动卫星/标签）

  // ---- 太阳 ----
  // 真实半径 ~0.005 AU，渲染放大 80 倍便于看见；米粒组织 emissiveMap
  const sunVis = 0.42;
  const sunMesh = makeSphere({
    radius: sunVis,
    color: '#fff3cf',
    emissive: '#ffd27f',
    emissiveIntensity: 1.0,
    roughness: 0.4,
    emissiveMap: sunTexture({ seed: 7 }),
  });
  sunMesh.position.set(0, 0, 0);
  group.add(sunMesh);
  // 太阳光晕：内圈炽白 + 外圈暖黄柔光（真实太阳的辉光观感）
  const sunHalo = makeGlowSprite(sunVis * 4.5, '#fff7dd', 0.95);
  group.add(sunHalo);
  const sunOuter = makeGlowSprite(sunVis * 11, '#ffd9a0', 0.28);
  group.add(sunOuter);

  // 光照：太阳作为唯一点光源（无衰减，教学场景全层照亮）+ 微弱环境光提亮背光面
  const sunLight = new THREE.PointLight(0xfff2dd, 3.0);
  sunLight.decay = 0;
  group.add(sunLight);
  group.add(new THREE.AmbientLight(0x405066, 0.55));

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
  const sunLs = labelScaleFor(sunLabel, 0.7);
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
      // 轻微自发光（同色 0.35）让背光面仍可辨认——教学场景避免"黑剪影"
      emissive: p.color,
      emissiveIntensity: 0.35,
      roughness: 0.95,
      map: PLANET_TEXTURES[p.id]?.(),
    });
    if (mesh.material.map) {
      spins.push({ tex: mesh.material.map, rotPeriodS: Math.abs(p.rotH) * 3600 });
    }
    // 真实自转轴倾角（度）：金星 177（近似逆转）、天王星 97.8"躺着"
    const axialTiltDeg = { mercury: 0.03, venus: 177.4, earth: 23.4, mars: 25.2, jupiter: 3.1, saturn: 26.7, uranus: 97.8, neptune: 28.3 }[p.id] ?? 0;
    if (axialTiltDeg) mesh.rotation.z = THREE.MathUtils.degToRad(axialTiltDeg);
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
    // 跟随 mesh 且悬于行星上方（放在中心会遮挡行星本体）
    lbl.position.set(0, rVis * 1.8 + 0.02, 0);
    mesh.add(lbl);

    // 卫星（随行星平移；mesh 作为父节点）。真实卫星轨道（如月球 0.0026 AU）
    // 小于示意行星半径，故轨道半径做教学缩放到行星半径外（schematic），
    // 公转周期严格用真实数据（periodD），时间倍速下可见运动。
    const moons = MOONS[p.id] || [];
    moons.forEach((m, mi) => {
      const moonOrbitAU = Math.max(m.aKm / AU_KM, rVis * (1.9 + mi * 0.55));
      const moonVis = Math.max(visRadiusKm(m.rKm) * 0.5, rVis * 0.14);
      const mm = makeSphere({ radius: moonVis, color: m.color, roughness: 1 });
      mesh.add(mm);
      moonAnims.push({ mesh: mm, aAU: moonOrbitAU, periodS: m.periodD * 86400, phase: (mi * 2.399) % (Math.PI * 2) });
    });

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
      const b = 0.18 + Math.random() * 0.16;
      colors[i*3] = b * 0.85; colors[i*3+1] = b * 0.8; colors[i*3+2] = b * 0.68;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.0016, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
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
      const b = 0.12 + Math.random() * 0.12;
      colors[i*3] = b * 0.65; colors[i*3+1] = b * 0.75; colors[i*3+2] = b * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.004, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
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
    intro: '尺度 ~120 AU。八大行星沿真实轨道公转，行星大小为教学缩放（真实比例仅约万分之一）。把时间调到 1月/秒，看行星、卫星转动起来。',
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
      // 卫星公转：真实周期（月 27.3 天、火卫一 0.32 天…），倍速下可见
      for (const ma of moonAnims) {
        const ang = ma.phase + (clock.t / ma.periodS) * Math.PI * 2;
        ma.mesh.position.set(Math.cos(ang) * ma.aAU, 0, Math.sin(ang) * ma.aAU);
      }
      // 行星自转：贴图经度偏移 = 真实自转周期（木星 9.9h、金星 -5832h 逆行…）
      for (const sp of spins) {
        sp.tex.offset.x = (clock.t / sp.rotPeriodS) % 1;
      }
    },
  };
}

// 自注册工厂
registerWorld('solar', buildSolarWorld);
