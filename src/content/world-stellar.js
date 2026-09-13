// 星际近邻层：太阳系周围 ~60 ly 内的真实恒星系统
// 世界单位：ly。太阳在原点。
// 数据文件：data/stars.js（research 回表后填真值；坐标已含 3D 估算，
// 见数据说明——RA/Dec+距离换算）。
// 教学重点：最近的恒星有多远、恒星类型多样、每颗恒星的“光年”信息卡。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { LY_KM, tempToHex } from '../util/units.js';
import { makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';
import { STAR_CATALOG } from './data/stars.js';
import { GM_SUN_LY, shipMaxSpeed, shipAcc, starRadiusLy } from './physics.js';

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
  STARS.forEach((s, i) => {
    // ra/dec/距离 → 3D 坐标（银河系标准：以太阳为原点的本地笛卡尔）
    const p = raDecDistToXYZ(s.raDeg, s.decDeg, s.distLy);
    positions[i*3] = p[0]; positions[i*3+1] = p[1]; positions[i*3+2] = p[2];
    c.set(tempToHex(s.tempK || 5800));
    const lum = Math.max(0.25, 0.5 + (s.lumFactor || 0.5));
    colors[i*3] = c.r*lum; colors[i*3+1] = c.g*lum; colors[i*3+2] = c.b*lum;
  });
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  group.add(pts);

  // 交互实体：给「著名/亮」恒星建独立 mesh + 标签，并放进 entities
  const all = [];
  STARS.forEach((s, i) => {
    const p = raDecDistToXYZ(s.raDeg, s.decDeg, s.distLy);
    all.push({ s, p });
  });
  // 南门二双星互绕动画引用（真实双星系统，见 buildBinaryAnim）
  const binRefs = {};
  let binEntA = null, binEntB = null, binLabel = null;

  for (const { s, p } of all) {
    // 恒星观感 = 小亮核 + 柔光晕（真实星光是点源 + 衍射/散射晕，不是大球）
    const lum = s.lumFactor ?? 0.4;
    const hex = tempToHex(s.tempK || 5800);
    // 亮星带十字衍射芒（望远镜观星特征），暗星保持圆晕
    const glow = makeGlowSprite(0.55 + lum * 1.1, hex, 0.85, { spikes: lum > 0.45 });
    glow.position.set(p[0], p[1], p[2]);
    group.add(glow);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.045 + lum * 0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: hex }),
    );
    core.position.set(p[0], p[1], p[2]);
    group.add(core);
    if (s.id === 'alpha-centauri-a' || s.id === 'alpha-centauri-b') {
      binRefs[s.id] = { glow, core, base: p, lum };
    }
    if (s.showLabel) {
      const lbl = makeTextSprite(s.name, { color: '#cfe6ff' });
      const ls = labelScaleFor(lbl, 0.55);
      lbl.scale.set(ls[0], ls[1], 1);
      // 标签放在光晕外缘上方（亮星光晕直径最大 ~1.45），避免文字糊进亮核
      lbl.position.set(p[0], p[1] + 0.55 + lum * 0.55, p[2]);
      group.add(lbl);
      if (s.id === 'alpha-centauri-a') binLabel = lbl;
    }
    const facts = [
      ['距离', s.distLy.toFixed(2) + ' 光年'],
      ['光谱型', s.spec || '—'],
      ['表面温度', (s.tempK || '—').toLocaleString() + ' K'],
      ['质量', (s.mass ? '约 ' + s.mass + ' 倍太阳' : '—')],
    ];
    if (s.mag !== undefined) facts.push(['视星等', s.mag]);
    if (s.id === 'alpha-centauri-a') {
      facts.push(['双星系统', '与南门二 B 互绕，周期约 79.9 年（图中间距为演示缩放，真实半长轴约 17.6 AU、间距 11–36 AU 间变化）']);
    }
    const ent = {
      id: s.id, name: s.name, en: s.en, type: 'star',
      pos: p, pickRadius: 0.5,
      mass: s.mass, // 太阳倍数（分层引力真实化：井 GM 按质量缩放）
      info: {
        kind: '恒星 · ' + (s.spec || ''),
        sub: (s.en || ''),
        facts,
        text: s.desc || '（描述待 research 回表）',
        source: s.source || '待核实',
      },
      visual: { color: tempToHex(s.tempK || 5800) },
    };
    entities.push(ent);
    if (s.id === 'alpha-centauri-a') binEntA = ent;
    if (s.id === 'alpha-centauri-b') binEntB = ent;
  }

  // 南门二 A/B 双星互绕：真实周期 79.9 年、质量比 A:B ≈ 1.1:0.9（半径反比）；
  // 间距为演示缩放（真实 ~23 AU 在 ly 尺度不可见），演示周期 ~44 秒实时一圈。
  const binA = binRefs['alpha-centauri-a'];
  const binB = binRefs['alpha-centauri-b'];
  const BIN_PERIOD_S = 44;
  // 半径按质量反比分配；间距取 ~2.1 ly 保证最大分离时两核光晕可分辨
  const BIN_R_A = 0.95, BIN_R_B = 1.2;
  function updateBinary(clockT) {
    if (!binA || !binB) return;
    const a = (clockT / BIN_PERIOD_S) * Math.PI * 2;
    const c = binA.base;
    const ax = c[0] + Math.cos(a) * BIN_R_A, az = c[2] + Math.sin(a) * BIN_R_A;
    const bx = c[0] - Math.cos(a) * BIN_R_B, bz = c[2] - Math.sin(a) * BIN_R_B;
    binA.glow.position.set(ax, c[1], az);
    binA.core.position.set(ax, c[1], az);
    binB.glow.position.set(bx, c[1], bz);
    binB.core.position.set(bx, c[1], bz);
    if (binEntA) binEntA.pos = [ax, c[1], az];
    if (binEntB) binEntB.pos = [bx, c[1], bz];
    if (binLabel) binLabel.position.set(ax, c[1] + 0.55 + binA.lum * 0.55, az);
  }

  // 太阳位置实体与标签（原点：下潜至太阳系）
  const sunEntity = {
    id: 'sun-system', name: '太阳系', en: 'Solar System', type: 'star',
    pos: [0, 0, 0], pickRadius: 0.8,
    mass: 1.0,
    info: {
      kind: '单星恒星系', sub: '我们的家园母星系',
      facts: [
        ['中心天体', '太阳（G2V 黄矮星）'],
        ['已知大行星', '8 颗（水、金、地、火、木、土、天王、海王）'],
        ['范围', '日球层顶约 120 AU'],
      ],
      text: '太阳系是以太阳为中心，由八大行星、数百颗卫星、矮行星及数以亿计的小天体组成的恒星行星系统。飞近可自动下潜深入太阳系内部。',
    },
    dive: { toWorld: 'solar', at: [22, 7, 26], dist: 0.35, targetName: '太阳系内部' },
    visual: { color: '#ffd27f' },
  };
  entities.push(sunEntity);

  const sunLabel = makeTextSprite('太阳系（本层原点）', { color: '#ffd27f', priority: 1 });
  const sunLs2 = labelScaleFor(sunLabel, 0.4);
  sunLabel.scale.set(sunLs2[0], sunLs2[1], 1);
  sunLabel.position.set(0, 0.9, 0);
  group.add(sunLabel);

  // 真实物理口径：每颗恒星一井，GM = GM☉ × 真实质量（换算到 ly³/s²），
  // 碰撞半径 = 真实恒星半径（主序 M-R 近似）——贴近恒星表面才会撞毁。
  // 真实 GM 下恒星引力只在近距离可感（1 ly 外绕行速度 ~0.4 km/s），
  // 星际航行的「快」是真实物理：引力弹弓需要贴到 AU 量级才明显
  const gravityWells = entities
    .filter((e) => e.type === 'star')
    .map((e) => ({ ref: e, GM: GM_SUN_LY * (e.mass ?? 1), minR: starRadiusLy(e.mass), capR: 2.5, name: e.name }));

  return {
    id: 'stellar', title: '星际近邻', unitName: 'ly', kmPerUnit: LY_KM,
    intro: '近邻恒星圈（参宿四/参宿七为远景示意，余者均在约 40 光年内）。这里是太阳的邻居圈：比邻星 4.2 光年、天狼星 8.6 光年……每颗恒星按真实方位与表面色温呈现，点选可查看详情。',
    worldRadius: 40,
    // 大巡游路线（T 键）：按距离由近及远造访邻星
    tourStops: ['proxima-centauri', 'alpha-centauri-a', 'barnards-star', 'sirius-a', 'procyon', 'tau-ceti', 'altair', 'vega', 'arcturus'],
    spawn: [3, 1.2, 3],
    spawnLookAt: [0, 0, 0], // 兴趣中心：太阳（本层原点）
    viewDist: 6,
    shipViewDist: 0.35, // 飞船第三人称跟拍视距
    labelFadeDist: 14,
    // 飞船性能与全层同一真实口径（300 km/s、0.6 m/s²，按 ly 单位换算）；
    // 跨恒星航行的节奏由时间倍率承担（千年/秒档下 60 ly ≈ 60 墙上秒）
    maxSpeedWorldPerS: shipMaxSpeed(LY_KM), thrustAccWorldPerS2: shipAcc(LY_KM),
    timeScaleMax: 3.15576e10,
    ambient: { starCount: 1800, starSpread: 260, milkyWay: true },
    gravityWells,
    group, entities,
    update(dtSim, clock) {
      updateBinary(clock.t);
    },
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
