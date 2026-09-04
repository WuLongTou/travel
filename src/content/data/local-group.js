// 本星系群成员目录（真实数据；研究子代理核实后修订）
// 银河系 = 原点 (0, 0, 0)。所有成员位置：ra/dec → 3D 方向 × distMpc。
// 数据来源：Wikipedia "Local Group" / NASA / NED 标准公开数据；
// distMpc 为到银河系的距离（多数来自 Karachentsev et al. 2002/2013 公开目录）。
// sizeKpc: 星系可见盘面直径（kpc）；M31/M33/银河系较大；矮星系 ~1–5 kpc。
// type: 'spiral' / 'dwarf-spheroidal' / 'dwarf-irregular'
// dive: 下潜到该星系视角（如银河系 → 进入 galaxy 层）。
//
// 注意：星系坐标方向用 RA/Dec 转 3D 笛卡尔（与 stellar 层一致公式）。

export const LOCAL_GROUP = [
  // --- 大旋涡星系 ---
  {
    id: 'm31', name: '仙女座星系', en: 'Andromeda (M31)', type: 'spiral',
    distMpc: 0.774, raDeg: 10.68, decDeg: 41.27, sizeKpc: 46,
    seed: 31,
    extraFacts: [['质量', '约 1.5 万亿倍太阳质量'], ['恒星', '约 1 万亿颗'], ['预计碰撞', '约 45 亿年后与银河系合并']],
    note: '距银河系最近的大型旋涡星系；是肉眼可见的最远天体之一（视星等 3.4）。正以约 110 km/s 的速度接近银河系；预计约 45 亿年后合并。',
    source: 'NASA/NED 标准值',
    dive: { toWorld: 'galaxy', at: [0.55, 0.05, 0], dist: 0.35, targetName: '仙女座内部' },
  },
  {
    id: 'm33', name: '三角座星系', en: 'Triangulum (M33)', type: 'spiral',
    distMpc: 0.94, raDeg: 23.46, decDeg: 30.66, sizeKpc: 18,
    seed: 33,
    extraFacts: [['距 M31', '约 200 kpc（与 M31 可能有引力相互作用）']],
    note: '本星系群第三大成员；肉眼极限可见（视星等 5.7）。其最显著的发射星云 NGC 604 是已知最大的恒星形成区之一。',
    source: 'NASA/NED 标准值',
  },

  // --- 银河系本身（原点；单独 entity） ---
  // 已在 world-local.js 中手写；这里不重复

  // --- 大麦哲伦云 / 小麦哲伦云（银河系的卫星星系；南天极区）---
  {
    id: 'lmc', name: '大麦哲伦云', en: 'Large Magellanic Cloud', type: 'dwarf-irregular',
    distMpc: 0.050, raDeg: 80.89, decDeg: -69.76, sizeKpc: 4.3,
    seed: 50,
    extraFacts: [['质量', '约 138 亿倍太阳质量'], ['著名天体', '蜘蛛星云（NGC 2070，超大恒星形成区）']],
    note: '银河系最大的卫星星系之一。位于南天极附近，北半球低纬度不可见。1987 年在 LMC 中爆发了一颗超新星（SN 1987A）。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'smc', name: '小麦哲伦云', en: 'Small Magellanic Cloud', type: 'dwarf-irregular',
    distMpc: 0.063, raDeg: 13.16, decDeg: -72.80, sizeKpc: 2.4,
    seed: 51,
    extraFacts: [['距 LMC', '约 20 kpc']],
    note: '银河系另一个卫星星系；与 LMC 通过中性氢"麦哲伦桥"相连。',
    source: 'NASA/NED 标准值',
  },

  // --- 银河系周边的矮椭圆星系（球状矮星系） ---
  {
    id: 'sagittarius-dsph', name: '人马座矮椭圆星系', en: 'Sagittarius Dwarf Spheroidal', type: 'dwarf-spheroidal',
    distMpc: 0.026, raDeg: 283.76, decDeg: -30.48, sizeKpc: 1.9,
    seed: 60,
    extraFacts: [['状态', '正被银河系潮汐撕裂']],
    note: '1994 年发现；距银河系约 7 万光年，正被银河系的潮汐力逐渐撕裂（其恒星流贯穿银河系南北天空）。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'sculptor-dsph', name: '玉夫座矮星系', en: 'Sculptor Dwarf', type: 'dwarf-spheroidal',
    distMpc: 0.090, raDeg: 11.92, decDeg: -33.71, sizeKpc: 1.2,
    seed: 61,
    extraFacts: [['距银河', '约 29 万光年']],
    note: '1937 年发现；位于南天银河极区。包含至少 4 个球状星团。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'fornax-dsph', name: '天炉座矮星系', en: 'Fornax Dwarf', type: 'dwarf-spheroidal',
    distMpc: 0.139, raDeg: 39.96, decDeg: -34.51, sizeKpc: 1.6,
    seed: 62,
    extraFacts: [['球状星团', '5 个已知']],
    note: '距银河系约 45 万光年；包含 5 个已知球状星团。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'carina-dsph', name: '船底座矮星系', en: 'Carina Dwarf', type: 'dwarf-spheroidal',
    distMpc: 0.103, raDeg: 100.31, decDeg: -50.05, sizeKpc: 0.6,
    seed: 63,
    extraFacts: [['距银河', '约 33 万光年']],
    note: '距银河系约 33 万光年的矮球状星系；位于南天。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'leo-i', name: '狮子座 I', en: 'Leo I', type: 'dwarf-spheroidal',
    distMpc: 0.260, raDeg: 152.09, decDeg: 12.31, sizeKpc: 0.9,
    seed: 64,
    extraFacts: [['距银河', '约 85 万光年']],
    note: '距银河系约 85 万光年；可能是银河系的卫星或正脱离中。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'leo-ii', name: '狮子座 II', en: 'Leo II', type: 'dwarf-spheroidal',
    distMpc: 0.205, raDeg: 147.78, decDeg: 22.16, sizeKpc: 0.7,
    seed: 65,
    note: '距银河系约 70 万光年的矮球状星系。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'ursa-minor', name: '小熊座矮星系', en: 'Ursa Minor Dwarf', type: 'dwarf-spheroidal',
    distMpc: 0.220, raDeg: 227.28, decDeg: 67.23, sizeKpc: 0.8,
    seed: 66,
    note: '银河系卫星星系之一；距约 70 万光年。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'draco-dsph', name: '天龙座矮星系', en: 'Draco Dwarf', type: 'dwarf-spheroidal',
    distMpc: 0.260, raDeg: 260.05, decDeg: 57.92, sizeKpc: 0.8,
    seed: 67,
    note: '银河系卫星星系之一；距约 85 万光年。富含暗物质。',
    source: 'NASA/NED 标准值',
  },

  // --- M31 卫星星系 ---
  {
    id: 'm32', name: 'M32', en: 'M32 (Andromeda satellite)', type: 'dwarf-spheroidal',
    distMpc: 0.805, raDeg: 10.67, decDeg: 40.86, sizeKpc: 1.6,
    seed: 70,
    extraFacts: [['距 M31', '约 22 kpc']],
    note: 'M31 的卫星星系；视星等约 8.1，是最亮的椭圆矮星系之一。',
    source: 'NASA/NED 标准值',
  },
  {
    id: 'm110', name: 'M110', en: 'M110 (Andromeda satellite)', type: 'dwarf-spheroidal',
    distMpc: 0.815, raDeg: 10.10, decDeg: 41.68, sizeKpc: 2.4,
    seed: 71,
    note: 'M31 另一个卫星矮椭圆星系。',
    source: 'NASA/NED 标准值',
  },

  // --- 银河系远卫星 ---
  {
    id: 'ic-10', name: 'IC 10', en: 'IC 10', type: 'dwarf-irregular',
    distMpc: 0.700, raDeg: 5.10, decDeg: 59.30, sizeKpc: 1.5,
    seed: 80,
    note: '本星系群中一个恒星形成活跃的矮不规则星系；富含沃尔夫-拉叶星。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'phoenix-dsph', name: '凤凰座矮星系', en: 'Phoenix Dwarf', type: 'dwarf-irregular',
    distMpc: 0.450, raDeg: 27.78, decDeg: -44.51, sizeKpc: 0.5,
    seed: 81,
    note: '距银河系约 145 万光年的矮星系。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'ngc-6822', name: '巴纳德星系', en: "Barnard's Galaxy (NGC 6822)", type: 'dwarf-irregular',
    distMpc: 0.640, raDeg: 296.23, decDeg: -14.80, sizeKpc: 1.5,
    seed: 82,
    note: '距银河系约 160 万光年；富含恒星形成区。',
    source: 'NASA/NED 标准值',
  },
];
