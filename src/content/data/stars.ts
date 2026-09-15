// 近邻恒星目录（≤25 ly 真实数据）
// 数据来源标注：
//   raDeg/decDeg/distanceLy/mag/spec/tempK — Yale Bright Star Catalog / Hipparcos / SIMBAD 标准值
//   全部为公认标准值（来源：Wikipedia/SIMBAD/Hipparcos 公开数据汇总）；
//   若需更高精度或更新数据，请用研究子代理按 id 逐颗核实。
// 结构：
//   { id, name, en, raDeg, decDeg, distLy, spec, tempK, mass(太阳倍数),
//     mag(视星等), lumFactor(渲染亮度0..1), showLabel, featured, desc, source }
//
// 距离单位：光年（ly）；RA/Dec 为 J2000.0。
// 渲染约定：恒星按 tempK 黑体色 + lumFactor 调整亮度；showLabel 的恒星常驻标签。
// 教学优先：featured=true 的是「最有教学价值」的恒星（最亮、最近、双星、变星、白矮星等）。

export interface StarRecord {
  id: string; name: string; en?: string;
  raDeg: number; decDeg: number; distLy: number;
  spec?: string; tempK?: number; mass?: number; mag?: number;
  lumFactor?: number; showLabel?: boolean; featured?: boolean;
  desc?: string; source?: string;
}

export const STAR_CATALOG: StarRecord[] = [
  // --- 太阳（原点；不在目录里，但作为标签保留） ---

  // 最近 + 最有教学价值
  { id: 'alpha-centauri-a', name: '南门二 A', en: 'Alpha Centauri A', raDeg: 219.91, decDeg: -60.83, distLy: 4.37,
    spec: 'G2V', tempK: 5790, mass: 1.1, mag: 0.01, lumFactor: 1.0, showLabel: true, featured: true,
    desc: '距离太阳最近的恒星系统之一；与南门二 B 组成目视双星。两颗星类似太阳，年龄约 50–60 亿年。',
    source: 'SIMBAD/Hipparcos 标准值' },
  { id: 'alpha-centauri-b', name: '南门二 B', en: 'Alpha Centauri B', raDeg: 219.91, decDeg: -60.83, distLy: 4.37,
    spec: 'K1V', tempK: 5260, mass: 0.9, mag: 1.34, lumFactor: 0.5, showLabel: false, featured: false,
    desc: '与 A 组成双星系统；表面温度略低，光度约为太阳的 1/2。',
    source: 'SIMBAD/Hipparcos 标准值' },
  { id: 'proxima-centauri', name: '比邻星', en: 'Proxima Centauri', raDeg: 217.43, decDeg: -62.68, distLy: 4.24,
    spec: 'M5.5Ve', tempK: 3042, mass: 0.12, mag: 11.13, lumFactor: 0.1, showLabel: true, featured: true,
    desc: '已知距太阳最近的恒星（约 4.24 ly）。红矮星，耀星，2016 年发现有一颗位于宜居带的行星 Proxima b。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'barnards-star', name: '巴纳德星', en: "Barnard's Star", raDeg: 269.45, decDeg: 4.69, distLy: 5.96,
    spec: 'M4V', tempK: 3134, mass: 0.14, mag: 9.51, lumFactor: 0.12, showLabel: true, featured: true,
    desc: '除南门二系统外距太阳最近的恒星；以每年约 10.3 角秒的高速自行运动（仅次于比邻星），，为已知恒星中自行最快者，故又称"飞星"。',
    source: 'SIMBAD/Hipparcos 标准值' },

  // 著名亮星（夜空最亮的恒星们）
  { id: 'sirius-a', name: '天狼星 A', en: 'Sirius A', raDeg: 101.29, decDeg: -16.72, distLy: 8.60,
    spec: 'A1V', tempK: 9940, mass: 2.06, mag: -1.46, lumFactor: 1.4, showLabel: true, featured: true,
    desc: '夜空中最亮的恒星（视星等 -1.46）。双星系统；伴星天狼星 B 是已知第一颗被发现的白矮星（1862）。',
    source: 'SIMBAD/Hipparcos 标准值' },
  { id: 'sirius-b', name: '天狼星 B', en: 'Sirius B', raDeg: 101.29, decDeg: -16.72, distLy: 8.60,
    spec: 'DA1.9', tempK: 25000, mass: 1.02, mag: 8.44, lumFactor: 0.08, showLabel: false, featured: false,
    desc: '天狼星的伴星；典型白矮星，质量与太阳相近但体积只有地球大小。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'procyon', name: '南河三', en: 'Procyon', raDeg: 114.83, decDeg: 5.22, distLy: 11.46,
    spec: 'F5IV-V', tempK: 6530, mass: 1.5, mag: 0.34, lumFactor: 1.0, showLabel: true, featured: true,
    desc: '小犬座 α；夜空中第 8 亮星。已知有白矮星伴星。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'altair', name: '牛郎星', en: 'Altair', raDeg: 297.70, decDeg: 8.87, distLy: 16.73,
    spec: 'A7V', tempK: 7670, mass: 1.79, mag: 0.77, lumFactor: 0.9, showLabel: true, featured: true,
    desc: '天鹰座 α；中国古代"牛郎织女"中的牛郎。高速自转（约 286 km/秒），赤道比两极"鼓"得更粗。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'vega', name: '织女星', en: 'Vega', raDeg: 279.23, decDeg: 38.78, distLy: 25.04,
    spec: 'A0V', tempK: 9602, mass: 2.1, mag: 0.03, lumFactor: 1.2, showLabel: true, featured: true,
    desc: '天琴座 α；中国古代"牛郎织女"中的织女星。夜空第 5 亮星。曾被作为光度/光谱校准基线（vega 系统）。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'arcturus', name: '大角星', en: 'Arcturus', raDeg: 213.92, decDeg: 19.18, distLy: 36.71,
    spec: 'K1.5III', tempK: 4286, mass: 1.08, mag: -0.05, lumFactor: 1.3, showLabel: false, featured: false,
    desc: '牧夫座 α；夜空第 4 亮星；典型红巨星，约 25 倍太阳直径。',
    source: 'SIMBAD/Hipparcos 标准值' },

  // 双星 / 聚星系统（教学价值高）
  { id: '61-cygni', name: '天鹅座 61', en: '61 Cygni', raDeg: 316.73, decDeg: 38.75, distLy: 11.37,
    spec: 'K5V+K7V', tempK: 4525, mass: 0.7, mag: 5.21, lumFactor: 0.3, showLabel: true, featured: true,
    desc: '首颗被测出视差的恒星（贝塞尔 1838 年），从而首次直接丈量出恒星距离。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'tau-ceti', name: '天仓五', en: 'Tau Ceti', raDeg: 26.02, decDeg: -15.94, distLy: 11.91,
    spec: 'G8.5V', tempK: 5344, mass: 0.78, mag: 3.50, lumFactor: 0.6, showLabel: true, featured: true,
    desc: '与太阳类似的恒星；距地球约 12 ly，长期是 SETI 搜索的目标。有疑似处于宜居带的行星候选。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'epsilon-erydani', name: '天苑四', en: 'Epsilon Eridani', raDeg: 53.23, decDeg: -9.46, distLy: 10.50,
    spec: 'K2V', tempK: 5084, mass: 0.82, mag: 3.73, lumFactor: 0.55, showLabel: true, featured: true,
    desc: '距太阳约 10.5 ly；曾报告巨行星候选（2000），存在性仍有争议。',
    source: 'SIMBAD/Hipparcos 标准值' },

  // 红矮星与白矮星（不同恒星类型）
  { id: 'wolf-359', name: 'Wolf 359', en: 'Wolf 359', raDeg: 164.12, decDeg: 7.01, distLy: 7.86,
    spec: 'M6V', tempK: 2800, mass: 0.09, mag: 13.51, lumFactor: 0.06, showLabel: false, featured: false,
    desc: '极暗弱的红矮星，视星等仅 13.5，肉眼不可见。距太阳约 7.9 ly。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'lalande-21185', name: '拉朗德 21185', en: 'Lalande 21185', raDeg: 165.83, decDeg: 35.97, distLy: 8.31,
    spec: 'M2V', tempK: 3550, mass: 0.39, mag: 7.52, lumFactor: 0.18, showLabel: false, featured: false,
    desc: '肉眼不可见的红矮星；距太阳约 8.3 ly。已知有超级地球 GJ 411 b（2019）及一颗长周期巨行星。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'ross-154', name: 'Ross 154', en: 'Ross 154', raDeg: 282.46, decDeg: -23.84, distLy: 9.69,
    spec: 'M3.5V', tempK: 3300, mass: 0.17, mag: 10.43, lumFactor: 0.07, showLabel: false, featured: false,
    desc: '红矮星；距太阳约 9.7 ly。暂无已确认行星。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'van-maanens-star', name: '范马南星', en: "Van Maanen's Star", raDeg: 12.29, decDeg: 5.39, distLy: 14.07,
    spec: 'DZ7.5', tempK: 6220, mass: 0.68, mag: 12.38, lumFactor: 0.06, showLabel: true, featured: true,
    desc: '距太阳最近的孤立白矮星（约 14 ly，不计双星伴星）；密度高达约 1 吨/立方厘米。',
    source: 'SIMBAD/Hipparcos 标准值' },

  // 远但亮的（夜空导航）
  { id: 'betelgeuse', name: '参宿四', en: 'Betelgeuse', raDeg: 88.79, decDeg: 7.41, distLy: 548, // 距离争议大（Hipparcos 498 / 常用 548，区间约 500–700）
    spec: 'M1-2Ia-Iab', tempK: 3590, mass: 16.5, mag: 0.42, lumFactor: 1.5, showLabel: true, featured: true,
    desc: '猎户座 α；红超巨星；直径约太阳的 700 倍（估计值，不同研究约 600–1000）。变星；预计在未来 10 万年内可能以超新星爆发。',
    source: 'SIMBAD/Hipparcos 标准值' },

  { id: 'rigel', name: '参宿七', en: 'Rigel', raDeg: 78.63, decDeg: -8.20, distLy: 863.0,
    spec: 'B8Ia', tempK: 12100, mass: 21, mag: 0.13, lumFactor: 1.6, showLabel: true, featured: true,
    desc: '猎户座 β；蓝超巨星；亮度约为太阳的 12 万倍。',
    source: 'SIMBAD/Hipparcos 标准值' },
];
