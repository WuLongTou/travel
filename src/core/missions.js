// 任务链：把「真实物理漫游」串成一条从地球到可观测宇宙边缘的玩法主线。
// 每个任务声明 { id, title, desc, done(ctx) }，ctx 由 main 每帧构建：
//   { layer, idx, selectedId, branch, distToSel, distToSun, rFromCenter, everLeft }
// 线性推进；条件天然满足时自动完成（如面包屑直达会跳过中间任务）。
export const MISSIONS = [
  {
    id: 'first-lock', title: '首次接触', desc: '点击眼前的天体，锁定自动导航目标',
    done: (c) => !!c.selectedId,
  },
  {
    id: 'park-planet', title: '泊入行星', desc: '自动导向伴飞任一行星（推荐：土星，带环）',
    done: (c) => c.selType === 'planet' && (c.branch === 'rendezvous' || c.branch === 'station'),
  },
  {
    id: 'sun-graze', title: '贴日掠过', desc: '冲进距太阳 0.3 AU 以内并存活（自动导航会替你拉起）',
    done: (c) => c.layer === 'solar' && c.distToSun < 0.3,
  },
  {
    id: 'leave-home', title: '冲出摇篮', desc: '朝任意方向飞出层界，浮升进入星际近邻',
    done: (c) => c.idx >= 1,
  },
  {
    id: 'proxima', title: '比邻之行', desc: '在星际近邻锁定比邻星并伴飞（跨 4.2 光年）',
    done: (c) => c.layer === 'stellar' && c.selectedId === 'proxima-centauri'
      && (c.branch === 'rendezvous' || c.branch === 'station'),
  },
  {
    id: 'dive-home', title: '回到家园', desc: '锁定太阳系，按 F 下潜返回内太阳系',
    done: (c) => c.everLeft && c.layer === 'solar',
  },
  {
    id: 'sgr-a', title: '银河之心', desc: '前往银河系层，点击银心的超大质量黑洞',
    done: (c) => c.layer === 'galaxy' && c.selectedId === 'sgrA',
  },
  {
    id: 'cosmos-edge', title: '宇宙边缘', desc: '抵达可观测宇宙层，直面 CMB 边界壳',
    done: (c) => c.layer === 'cosmos',
  },
];
