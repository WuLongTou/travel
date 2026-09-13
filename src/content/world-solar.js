// 太阳系层构建器：完全真实物理口径
// 尺度约定：世界单位 = AU；太阳在原点。
// 真实性边界：天体半径/轨道/引力（GM）/轨道速度全部真实——地球轨道
// 速度 29.8 km/s、月球轨道 38.4 万 km 都按真实数值。飞船性能按未来
// 离子推进设定（0.6 m/s²、巡航 ~300 km/s，远低于光速），跨行星航行
// 由时间倍率承担节奏（AUTO 自动调节倍率，物理始终真实）。
// 视觉边界：远场行星为辉光点+标签（真实望远镜观感），接近后真实
// 半径球体接管（LOD）；飞船视觉尺寸随跟拍距离示意放大（真实 ~10m
// 不可见）；太阳系照明不随距离衰减（渲染便利，见 ARCHITECTURE.md）。
import * as THREE from 'three';
import { PLANETS, SOL, MOONS, ASTEROID_BELT, KUIPER_BELT, SOURCE_NOTE } from './data/solar.js';
import { AU_KM } from '../util/units.js';
import { mulberry32, clamp } from '../util/math.js';
import { registerWorld } from './worlds.js';
import { makeSphere, makeRing, makeOrbitEllipse, makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import {
  sunTexture, gasGiantTexture, rockyTexture, earthTexture, venusTexture, iceGiantTexture,
} from '../render/textures.js';

// ---- 真实物理常量（SI → AU 口径换算） ----
const G_SI = 6.674e-11;      // 万有引力常数 m³/(kg·s²)
const AU_M = 1.496e11;       // 1 AU（米）
// GM = G·M（AU³/s²）：地球 GM=1.19e-19，地球轨道速度 √(GM☉/1AU)=29.8 km/s
const gmReal = (massKg) => (G_SI * massKg) / (AU_M ** 3);
// 真实半径（AU）：地球 6371 km ≈ 4.26e-5 AU
const rReal = (rKm) => rKm / AU_KM;

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

// 开普勒椭圆轨道位置：焦点（太阳）在原点。M 平近点角 → Newton 迭代解
// 偏近点角方程 E − e·sinE = M（行星 e ≤ 0.21，4 次收敛到 1e-6 级），
// 再由 E 得轨道坐标并旋转近日点方向。t 秒 ≡ 模拟钟累计秒。
const _orbTmp = [0, 0, 0];
const _velA = [0, 0, 0];
const _velB = [0, 0, 0];
function keplerPos(o, t, out = _orbTmp) {
  const M = o.M0 + (t / o.periodS) * Math.PI * 2;
  let E = M + o.e * Math.sin(M);
  for (let k = 0; k < 4; k++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  const xo = o.aAU * (Math.cos(E) - o.e);
  const yo = o.aAU * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const cw = Math.cos(o.peri), sw = Math.sin(o.peri);
  out[0] = xo * cw - yo * sw;
  out[2] = xo * sw + yo * cw;
  return out;
}

export function buildSolarWorld() {
  const group = new THREE.Group();
  const entities = [];
  const moonAnims = []; // 卫星公转动画：{ mesh(相对行星), aAU, periodS, phase }
  const spins = []; // 行星自转：{ tex, rotPeriodS }（贴图 offset 驱动，不带动卫星/标签）
  const clockHandles = []; // 额外模拟回调（彗星轨道等），update 时以 (dtSim, clock.t) 调用

  // ---- 太阳 ----
  // 真实半径 0.00465 AU（≈69.6 万 km）；米粒组织 emissiveMap；
  // 远处可见性由光球辉光 sprite 承担（真实太阳的眩光观感）
  const sunR = rReal(SOL.rKm);
  const sunMesh = makeSphere({
    radius: sunR,
    color: '#fff3cf',
    emissive: '#ffd27f',
    emissiveIntensity: 1.0,
    roughness: 0.4,
    emissiveMap: sunTexture({ seed: 7 }),
  });
  sunMesh.position.set(0, 0, 0);
  group.add(sunMesh);
  // 太阳光晕：内圈炽白 + 外圈暖黄柔光（真实太阳的辉光观感）
  const sunHalo = makeGlowSprite(sunR * 28, '#fff7dd', 0.95);
  group.add(sunHalo);
  const sunOuter = makeGlowSprite(sunR * 70, '#ffd9a0', 0.28);
  group.add(sunOuter);

  // 光照：太阳作为唯一点光源（无衰减，教学场景全层照亮）+ 微弱环境光提亮背光面
  const sunLight = new THREE.PointLight(0xfff2dd, 3.0);
  sunLight.decay = 0;
  group.add(sunLight);
  group.add(new THREE.AmbientLight(0x405066, 0.55));

  const sunEntity = {
    id: 'sun', name: '太阳', en: 'Sun', type: 'sun',
    pos: [0, 0, 0], pickRadius: sunR,
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
    visual: { color: '#ffd27f', labelOffset: sunR * 2.4 },
  };
  entities.push(sunEntity);
  const sunLabel = makeTextSprite('太阳 · Sun');
  const sunLs = labelScaleFor(sunLabel, 0.7);
  sunLabel.scale.set(sunLs[0], sunLs[1], 1);
  sunLabel.position.set(0, sunR * 2.6, 0);
  group.add(sunLabel);

  // ---- 行星 ----
  const planetLods = []; // 近远场 LOD：{ sprite, rAU }——远处辉光点、近处真实球
  const gravityWells = [
    { center: [0, 0, 0], GM: gmReal(SOL.massKg), minR: sunR, capR: sunR * 2.5, name: '太阳' },
  ];
  for (const p of PLANETS) {
    const rAU = rReal(p.rKm);
    const mesh = makeSphere({
      radius: rAU,
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
    // 起始平近点角随机；轨道用真实根数（aAU 半长轴 + e 偏心率）的开普勒
    // 椭圆——近日点方向（peri）未在数据中，取每行星固定随机相位；
    // 匀速圆周改为开普勒变速：近日点明显加速（水星 e=0.206 最直观）
    const orbitA = p.aAU;
    const M0 = Math.random() * Math.PI * 2;
    const peri = Math.random() * Math.PI * 2;
    const orbit = { aAU: orbitA, periodS: p.periodD * 86400, M0, e: p.e, peri };
    keplerPos(orbit, 0, _orbTmp);
    mesh.position.set(_orbTmp[0], 0, _orbTmp[2]);
    group.add(mesh);

    // 环（仅土星；真实环系内径 ~7 万 km，外径 ~14 万 km，渲染按比例缩到行星半径的 1.5–2.5 倍）
    if (p.rings) {
      const ring = makeRing(rAU * 1.5, rAU * 2.4, '#d9cbb0');
      mesh.add(ring);
    }
    // 远场 LOD：真实半径球在远处是亚像素点，辉光 sprite 承担"望远镜里
    // 的行星就是一个亮点"的真实观感；接近后（<80R，视角 >0.7°）隐藏
    const farDot = makeGlowSprite(rAU * 30, p.color, 0.8);
    mesh.add(farDot);
    planetLods.push({ sprite: farDot, rAU });
    // 轨道线：真实椭圆（太阳在焦点）
    const ol = makeOrbitEllipse(orbitA, p.e, peri, '#3d5575', 360);
    group.add(ol);
    // 标签（贴行星上方一点；尺寸按行星比例但有最小可读下限）
    const lbl = makeTextSprite(p.name, { color: '#dbe7ff' });
    const ls = labelScaleFor(lbl, Math.max(rAU * 2.4, 0.05));
    lbl.scale.set(ls[0], ls[1], 1);
    // 跟随 mesh 且悬于行星上方（放在中心会遮挡行星本体）
    lbl.position.set(0, rAU * 3, 0);
    mesh.add(lbl);

    // 卫星（随行星平移；mesh 作为父节点）。真实轨道距离（月球 38.4 万
    // km = 0.00257 AU）与真实半径——行星真实化后卫星轨道自然成立
    const moons = MOONS[p.id] || [];
    moons.forEach((m, mi) => {
      const mm = makeSphere({ radius: rReal(m.rKm), color: m.color, roughness: 1 });
      mesh.add(mm);
      moonAnims.push({ mesh: mm, aAU: m.aKm / AU_KM, periodS: m.periodD * 86400, phase: (mi * 2.399) % (Math.PI * 2) });
    });
    // 真实引力井：GM = G·M，碰撞半径 = 真实表面
    gravityWells.push({
      ref: null, // 实体创建后回填引用
      GM: gmReal(p.massKg), minR: rAU, capR: rAU * 2.4, name: p.name,
    });

    const entity = {
      id: p.id, name: p.name, en: p.en, type: 'planet',
      pos: [_orbTmp[0], 0, _orbTmp[2]],
      pickRadius: rAU, // 真实半径：泊车/碰撞/引力井共用同一物理口径
      mesh, // 关键：让 update 能驱动位置
      info: {
        kind: { mercury: '行星 · 岩石行星', venus: '行星 · 岩石行星', earth: '行星 · 岩石行星', mars: '行星 · 岩石行星', jupiter: '行星 · 气态巨行星', saturn: '行星 · 气态巨行星', uranus: '行星 · 冰巨星', neptune: '行星 · 冰巨星' }[p.id] || '行星',
        sub: `距太阳 ${p.aAU} AU · 公转 ${p.periodD.toFixed(1)} 天`,
        facts: [
          ['直径', (p.rKm * 2).toLocaleString() + ' km'],
          ['质量', p.massKg.toExponential(2) + ' kg'],
          ['距太阳', p.aAU + ' AU（' + (p.aAU * AU_KM / 1e6).toFixed(1) + ' 百万 km）'],
          ['公转周期', p.periodD.toFixed(1) + ' 天'],
          ['轨道速度', (Math.sqrt(gmReal(SOL.massKg) / p.aAU) * AU_KM).toFixed(1) + ' km/s'],
          ['自转周期', Math.abs(p.rotH).toFixed(1) + (p.rotH < 0 ? ' 小时（逆行）' : ' 小时')],
          ['卫星', p.moons + ' 颗'],
        ],
        text: p.desc,
        source: SOURCE_NOTE,
      },
      visual: { color: p.color, labelOffset: 0 },
      orbit, // { aAU, periodS, M0, e, peri }——update 用 keplerPos 驱动
    };
    entities.push(entity);
    gravityWells[gravityWells.length - 1].ref = entity; // 引力井回填实体引用
  }
  // 构建期预计算行星轨道速度（±1 小时中心差分）：出生注入（bindWorld）
  // 先于首帧 update，必须在此就绪
  for (const e of entities) {
    if (!e.orbit) continue;
    keplerPos(e.orbit, 3600, _velA);
    keplerPos(e.orbit, -3600, _velB);
    e.vel = [
      (_velA[0] - _velB[0]) / 7200,
      (_velA[1] - _velB[1]) / 7200,
      (_velA[2] - _velB[2]) / 7200,
    ];
  }

  // ---- 教学彗星（真实根数 + 数值积分）----
  // 与探测球同一套引力积分（太阳井教学 GM，实时可见）；
  // 近日点速度 vP=√(GM(1+e)/q) 的真实公式，时间倍速下可见"近日加速-弯转-远离"。
  // 哈雷 q=0.586 AU / e=0.967 / 周期 75.3 年；恩克 q=0.336 AU / e=0.847 / 3.3 年
  // （NASA/JPL）。两者构成短/长周期对比。
  makeComet(group, entities, clockHandles, {
    id: 'halley', name: '哈雷彗星', en: "Halley's Comet",
    q: 0.586, e: 0.967, startSide: 1, incDeg: 162.3,
    coreColor: '#cfe0ea', comaColor: '#bfe0f4', tailColor: '#9fd0ff',
    info: {
      kind: '短周期彗星', sub: '1P/Halley',
      facts: [
        ['近日点', '0.586 AU（金星轨道内侧）'],
        ['远日点', '35.1 AU（海王星轨道外）'],
        ['偏心率', '0.967'],
        ['周期', '约 75.3 年'],
        ['上次回归', '1986 年'],
        ['下次回归', '2061 年'],
      ],
      text: '哈雷彗星是首颗被预言回归的彗星（哈雷 1705 年计算其周期）。彗尾由太阳风与辐射压把冰升华后的尘埃与离子推向背阳方向形成——图中彗尾始终背离太阳，越近日越长。',
      source: 'NASA/JPL 标准值',
    },
  });
  makeComet(group, entities, clockHandles, {
    id: 'encke', name: '恩克彗星', en: "Encke's Comet",
    q: 0.336, e: 0.847, startSide: -1, incDeg: 11.8,
    coreColor: '#d8e8d8', comaColor: '#c4e4cc', tailColor: '#a8e0c0',
    info: {
      kind: '短周期彗星', sub: '2P/Encke',
      facts: [
        ['近日点', '0.336 AU（水星轨道内侧）'],
        ['远日点', '4.1 AU（小行星带外）'],
        ['偏心率', '0.847'],
        ['周期', '约 3.3 年（已知最短之一）'],
        ['母体', '金牛座流星雨'],
      ],
      text: '恩克彗星是周期最短的彗星之一，每 3.3 年回归一次，是金牛座流星雨的源头。与哈雷彗星（75.3 年）对比：短周期彗星频繁近日，冰物质消耗更快、彗尾更弱。图中彗尾同样始终背离太阳。',
      source: 'NASA/JPL 标准值',
    },
  });

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
    intro: '完全真实物理口径的太阳系：天体半径、引力（GM）、轨道速度全部真实（地球轨道 29.8 km/s）。飞船为未来离子推进（0.6 m/s²），跨行星航行由自动时间倍率承担——飞近天体自动降倍率。',
    worldRadius: 55,
    // 大巡游路线（T 键）：由内向外造访太阳，再按轨道距离逐一行星，哈雷彗星压轴
    tourStops: ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'halley'],
    // 真实引力井：GM☉ = 1.327e11 km³/s²（=3.96e-14 AU³/s²），行星 GM =
    // G·M 真实值；碰撞半径 = 真实表面（触碰即撞毁→安全轨道重部署）。
    // 真实口径下地球轨道速度 29.8 km/s、希尔球 ~0.01 AU，泊车/俘获/
    // 弹弓全部按真实引力开场。
    gravityWells,
    // 出生在地球旁 ~1.6e-3 AU（约 24 万 km，≈38 个地球半径），望向地球
    spawn: (() => {
      const earth = entities.find((e) => e.id === 'earth');
      return [earth.pos[0] + 1.1e-3, 3.2e-4, earth.pos[2] + 1.1e-3];
    })(),
    viewDist: 30, // 宏观全景视距（供地图/全景参考）
    shipViewDist: 6.4e-4, // 跟拍视距（≈15 个地球半径，真实尺度特写）
    // 飞船性能：未来离子推进——最大 300 km/s（≈0.001c，远低于光速），
    // 推进加速度 0.6 m/s²；跨行星航行的节奏由时间倍率承担（main.js 自动管理）
    maxSpeedWorldPerS: 2.005e-6,
    thrustAccWorldPerS2: 4.01e-12, timeScaleMax: 3.156e10,
    ambient: { starCount: 1400, starSpread: 600, milkyWay: true },
    group, entities,
    spawnLookAt: (() => {
      const earth = entities.find((e) => e.id === 'earth');
      return earth.pos.slice();
    })(),
    update(dtSim, clock, probe, dtReal = 0) {
      // 行星轨道：开普勒椭圆（真实 aAU/e/periodD）——近日点加速、远日点
      // 减速（面积速度守恒），时间倍率足够才明显
      for (const e of entities) {
        if (!e.orbit || !e.mesh) continue;
        keplerPos(e.orbit, clock.t, _orbTmp);
        e.mesh.position.set(_orbTmp[0], 0, _orbTmp[2]);
        e.pos = [_orbTmp[0], 0, _orbTmp[2]];
        // 真实轨道速度（±1 小时中心差分）：出生/重生注入母体公转分量
        //（在地球边出生必须携带地球 29.8 km/s 公转速度，否则被甩离）
        keplerPos(e.orbit, clock.t + 3600, _velA);
        keplerPos(e.orbit, clock.t - 3600, _velB);
        e.vel = [
          (_velA[0] - _velB[0]) / 7200,
          (_velA[1] - _velB[1]) / 7200,
          (_velA[2] - _velB[2]) / 7200,
        ];
      }
      // 行星近远场 LOD：远处以辉光点呈现（望远镜观感），接近后真实球体接管
      for (const it of planetLods) {
        const dx = it.sprite.parent.position.x - probe.pos[0];
        const dy = it.sprite.parent.position.y - probe.pos[1];
        const dz = it.sprite.parent.position.z - probe.pos[2];
        it.sprite.visible = Math.hypot(dx, dy, dz) > it.rAU * 80;
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
      // 彗星等附加模拟：与飞船同一套真实引力口径，按模拟时间推进
      //（1年/秒 倍率下哈雷 75 秒跑完一个真实 75 年周期）
      for (const fn of clockHandles) fn(dtSim, clock.t, probe);
    },
  };
}

// 彗星构造：真实根数（q/e/近日点速度公式）+ 真实 GM 数值积分 + 背阳锥形离子尾。
// 与飞船同一套真实引力口径、按模拟时间推进；startSide 控制初始在近日点哪一侧。
function makeComet(group, entities, clockHandles, { id, name, en, q, e, startSide = 1, incDeg = 0,
  coreColor, comaColor, tailColor, info, GM }) {
  GM = GM ?? gmReal(SOL.massKg); // 默认真实 GM☉
  const vP = Math.sqrt(GM * (1 + e) / q); // 近日点速度（真实公式，哈雷 ~54.6 km/s）
  // 轨道倾角（真实值，绕黄道 x 轴倾斜）：哈雷 162° 逆行、恩克 12°——
  // 彗星轨道不与行星共面是真实性质，也是视觉上区分彗星与行星的关键
  const inc = incDeg * Math.PI / 180;
  const ci = Math.cos(inc), si = Math.sin(inc);
  const tilt = (v) => [v[0], v[1] * ci - v[2] * si, v[1] * si + v[2] * ci];
  const cState = { pos: tilt([q * startSide, 0, 0]), vel: tilt([0, 0, -vP * startSide]) };
  const cState0 = { pos: cState.pos.slice(), vel: cState.vel.slice() }; // 数值异常自愈基准
  // 真实尺度：彗核 ~5 km 不可见，可见体为彗发辉光（真实彗发 ~10 万 km 级）
  const coreR = 3.4e-8; // ≈5 km
  const comaR = 6.7e-4; // 彗发 ≈10 万 km
  const cometCore = makeSphere({
    radius: coreR, color: coreColor, emissive: coreColor, emissiveIntensity: 0.5, roughness: 0.8,
  });
  cometCore.position.set(...cState.pos);
  group.add(cometCore);
  const comaGlow = makeGlowSprite(comaR, comaColor, 0.55);
  cometCore.add(comaGlow);
  // 彗尾：背阳锥形点云（离子尾观感），长度随日距变化
  const TAIL_N = 260;
  const tPos = new Float32Array(TAIL_N * 3);
  const tailRng = mulberry32(97);
  const tailPts = [];
  for (let i = 0; i < TAIL_N; i++) {
    const u = Math.pow(tailRng(), 0.8);          // 沿尾 0..1（近核密）
    const ang = tailRng() * Math.PI * 2;
    const rad = (0.08 + tailRng() * 0.22) * u;  // 锥形张开（远看仍可辨锥形）
    const ph = tailRng() * Math.PI * 2;
    tailPts.push({ u, ang, rad, ph, w: 0.4 + tailRng() * 0.8 });
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  const tMat = new THREE.PointsMaterial({
    size: 1.8, sizeAttenuation: false, color: tailColor,
    transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const tail = new THREE.Points(tGeo, tMat);
  tail.frustumCulled = false;
  group.add(tail);

  entities.push({
    id, name, en, type: 'comet',
    pos: cState.pos.slice(), pickRadius: comaR,
    info,
    visual: { color: tailColor },
  });

  // 彗星运动与彗尾刷新（挂在 world.update，模拟时间驱动 + 自适应子步）
  clockHandles.push((dtSim, clockT, probe) => {
    // 真实 GM 数值积分：步长随开普勒时标缩放（近日点自动细化），
    // 1年/秒 倍率下哈雷 ~75 墙上秒跑完真实 75.3 年周期
    let remain = Math.max(0, dtSim);
    let steps = 0;
    do {
      const dx = -cState.pos[0], dy = -cState.pos[1], dz = -cState.pos[2];
      const r = Math.hypot(dx, dy, dz) || 1e-12;
      const tau = Math.sqrt(r * r * r / GM);
      const h = Math.min(remain, Math.max(tau * 0.02, 60));
      const a = GM / (r * r);
      cState.vel[0] += dx / r * a * h;
      cState.vel[1] += dy / r * a * h;
      cState.vel[2] += dz / r * a * h;
      cState.pos[0] += cState.vel[0] * h;
      cState.pos[1] += cState.vel[1] * h;
      cState.pos[2] += cState.vel[2] * h;
      remain -= h;
      steps++;
    } while (remain > 0 && steps < 600);
    // 数值自愈：极端瞬态下积分发散产生非有限值时，重置回初始轨道状态
    //（NaN 一旦进入实体 pos 会传染拾取/制导/渲染整条管线）
    if (!Number.isFinite(cState.pos[0] + cState.pos[1] + cState.pos[2] +
      cState.vel[0] + cState.vel[1] + cState.vel[2])) {
      cState.pos = cState0.pos.slice();
      cState.vel = cState0.vel.slice();
    }
    cometCore.position.set(...cState.pos);
    const ent = entities.find((x) => x.id === id);
    if (ent) { ent.pos = [...cState.pos]; ent.vel = [...cState.vel]; }
    // 彗尾：方向 = 背阳；长度随日距反比（近日壮观）
    const r = Math.hypot(...cState.pos);
    const L = clamp(0.9 / r, 0.35, 1.8);
    const ux = cState.pos[0] / r, uy = cState.pos[1] / r, uz = cState.pos[2] / r;
    // 彗尾正对视线时淡出：正对的锥形尾透视上拉成"怪线"，
    // 真实观感中正对彗尾表面亮度弥散降低
    const vdx = cState.pos[0]-probe.pos[0], vdy = cState.pos[1]-probe.pos[1], vdz = cState.pos[2]-probe.pos[2];
    const vd = Math.hypot(vdx, vdy, vdz) || 1;
    const facing = Math.abs(ux*vdx/vd + uy*vdy/vd + uz*vdz/vd);
    tMat.opacity = 0.42 * (1 - clamp((facing - 0.86) / 0.14, 0, 1) * 0.8);
    // 尾向垂直基向量
    const px = -uz, py = 0, pz = ux;
    const pl = Math.hypot(px, py, pz) || 1;
    const nx = px / pl, ny = py / pl, nz = pz / pl;
    const qx = uy * nz - uz * ny, qy = uz * nx - ux * nz, qz = ux * ny - uy * nx;
    for (let i = 0; i < TAIL_N; i++) {
      const t = tailPts[i];
      const sway = Math.sin(clockT * t.w + t.ph) * t.rad * t.u;
      const along = t.u * L;
      const spread = t.rad * t.u * L;
      tPos[i * 3] = cState.pos[0] + ux * along + nx * spread * Math.cos(t.ang) + qx * sway;
      tPos[i * 3 + 1] = cState.pos[1] + uy * along + ny * spread * Math.cos(t.ang) + qy * sway;
      tPos[i * 3 + 2] = cState.pos[2] + uz * along + nz * spread * Math.cos(t.ang) + qz * sway;
    }
    tGeo.attributes.position.needsUpdate = true;
  });
}

// 自注册工厂
registerWorld('solar', buildSolarWorld);
