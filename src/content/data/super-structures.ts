// 室女超星系团 / 拉尼亚凯亚（宇宙网）层结构目录
// 数据来源：Wikipedia "Virgo Cluster"/"Laniakea"/"Shapley Supercluster"/NED 标准公开数据
// 单位：Mpc；坐标 RA/Dec 用于可视化方向（真实位置有红移分量；本教学简化）。
// dive：下潜到该结构内更精细的视图（暂全部返回本地星系群视图）。

import type { DiveTarget } from '../../types.js';

export interface StructureRecord {
  id: string; name: string; en?: string; type: string;
  distMpc: number; raDeg: number; decDeg: number; sizeKpc?: number;
  seed?: number; color?: string; labelSize?: number; kind?: string;
  facts: [string, string][]; note?: string; source?: string; dive?: DiveTarget;
  visRadiusMpc?: number; count?: number; label?: boolean;
}

export const SUPER_STRUCTURES: StructureRecord[] = [
  {
    id: 'virgo-cluster', name: '室女星系团', en: 'Virgo Cluster', type: 'clusterMark',
    distMpc: 16.5, raDeg: 186.75, decDeg: 12.72, sizeKpc: 1500, // 中心 M87 方向；团质量约 1.2e15 M☉（2.2 Mpc 内）
    seed: 11,
    color: '#d8d0ff', labelSize: 4.5,
    kind: '星系团',
    facts: [
      ['距离', '约 5380 万光年（16.5 Mpc）'],
      ['成员', '约 1300 个星系'],
      ['大质量星系', 'M87（巨椭圆，M87* 于 2019 年发布首张黑洞影像，数据取自 2017）'],
      ['本星系群', '正被室女团引力拖曳（数百 km/s 量级）'],
    ],
    note: '离银河系最近的富星系团。M87 是其中心巨椭圆星系（第二亮，最亮为 M49）；2019 年事件视界望远镜发布了 M87* 的首张黑洞影像。',
    source: 'NASA/NED 标准值',
    dive: { toWorld: 'local', at: [0.05, 0, 0], dist: 0.5, targetName: '本星系群视角' },
  },

  {
    id: 'fornax-cluster', name: '天炉星系团', en: 'Fornax Cluster', type: 'clusterMark',
    distMpc: 19.0, raDeg: 54.66, decDeg: -35.31, sizeKpc: 1300,
    seed: 22,
    color: '#ffe2c9', labelSize: 4,
    kind: '星系团',
    facts: [['距离', '约 6200 万光年']],
    note: '南天较近的星系团之一；包含大量椭圆星系。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'coma-cluster', name: '后发星系团', en: 'Coma Cluster (Abell 1656)', type: 'clusterMark',
    distMpc: 103.0, raDeg: 194.95, decDeg: 27.98, sizeKpc: 2000,
    seed: 33,
    color: '#cfe6ff', labelSize: 5.5,
    kind: '富星系团',
    facts: [
      ['距离', '约 3.36 亿光年（103 Mpc，h=0.705 口径）'],
      ['成员', '约 1000+ 个星系'],
      ['暗物质', '暗物质存在的早期证据（1933 年 Zwicky，1937 年续篇）'],
    ],
    note: '富星系团，1933 年 Zwicky 通过观测星系速度首次提出"暗物质"假设（1937 年续篇）。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'hydra-cluster', name: '长蛇星系团', en: 'Hydra Cluster (Abell 1060)', type: 'clusterMark',
    distMpc: 58.3, raDeg: 139.52, decDeg: -27.52, sizeKpc: 1500,
    seed: 44,
    color: '#d0f0ff', labelSize: 4.5,
    kind: '星系团',
    facts: [['距离', '约 1.90 亿光年']],
    note: '南天最亮的星系团之一；最大星系为 NGC 3309/3311，旋涡 NGC 3312 宽约 15 万光年。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'centaurus-cluster', name: '半人马星系团', en: 'Centaurus Cluster (Abell 3526)', type: 'clusterMark',
    distMpc: 52.4, raDeg: 192.20, decDeg: -41.30, sizeKpc: 1400,
    seed: 55,
    color: '#ffd0e6', labelSize: 4.5,
    kind: '星系团',
    facts: [
      ['距银河', '约 1.71 亿光年'],
      ['星系', 'NGC 4696（中心巨椭圆）'],
    ],
    note: '距银河系较近的星系团之一；中心星系为巨椭圆 NGC 4696。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'perseus-cluster', name: '英仙星系团', en: 'Perseus Cluster (Abell 426)', type: 'clusterMark',
    distMpc: 73.6, raDeg: 49.95, decDeg: 41.51, sizeKpc: 1800,
    seed: 66,
    color: '#d6c9ff', labelSize: 5,
    kind: '星系团',
    facts: [['距离', '约 2.40 亿光年']],
    note: '距银河系较近的富星系团之一；X 射线波段天空中最亮的星系团（最亮成员 NGC 1275）。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'shapley-supercluster', name: '沙普利超星系团', en: 'Shapley Supercluster', type: 'clusterMark',
    distMpc: 200.0, raDeg: 200.0, decDeg: -31.0, sizeKpc: 9000,
    seed: 77,
    color: '#ffc9c9', labelSize: 7,
    kind: '超星系团',
    facts: [
      ['距离', '约 6.5 亿光年'],
      ['星系团', '约 25–30 个'],
      ['影响', '与巨引源区共同拖曳本星系群（重要贡献者之一）'],
    ],
    note: '已知最大的超星系团之一（本地宇宙最大物质集中之一）；与巨引源区（150–250 Mly）共同拖曳本星系群，位于其后方约 6.5 亿光年处。',
    source: 'NASA/NED 标准值',
  },

  {
    id: 'laniakea', name: '拉尼亚凯亚超星系团', en: 'Laniakea Supercluster', type: 'clusterMark',
    distMpc: 0.001, raDeg: 16.0, decDeg: -30.0, sizeKpc: 120000, // 跨度约 120 Mpc（4 亿光年）
    seed: 88,
    color: '#a8e0ff', labelSize: 9,
    kind: '超星系团',
    facts: [
      ['含义', '夏威夷语"无垠天堂"'],
      ['包含', '约 10 万个星系，总质量 ~1e17 太阳质量'],
      ['本星系群', '正被其引力拖曳'],
    ],
    note: '2014 年 Tully 等人通过本星系群和邻近星系的本动速度（peculiar velocity）场重构出的大型引力流域。本星系群（含银河系）位于其边缘。',
    source: 'Nature 2014 / NASA 标准值',
  },

  {
    id: 'bootes-void', name: '牧夫座空洞', en: 'Boötes Void', type: 'clusterMark',
    distMpc: 215.0, raDeg: 220.0, decDeg: 50.0, sizeKpc: 124000, // 中心距地约 7 亿光年，半径约 62 Mpc
    seed: 99,
    color: '#222b3c', labelSize: 6,
    kind: '巨洞',
    facts: [
      ['直径', '约 4 亿光年（半径约 62 Mpc，已知最大空洞之一）'],
      ['星系数量', '约 60 个（同等体积内应有约 2000 个）'],
    ],
    note: '已知的最大空洞之一——内部几乎没有任何星系。',
    source: 'NASA 标准值',
  },
];
