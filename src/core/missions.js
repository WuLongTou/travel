// 任务链：把「真实物理漫游」串成一条从地球到可观测宇宙边缘的玩法主线。
// 每个任务声明 { id, title, desc, done(ctx) }，ctx 由 main 每帧构建：
//   { layer, idx, selectedId, selType, branch, distToSel, targetRadius,
//     distToSun, rFromCenter, everLeft, wellId, wellSpeedGain }
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
  // ---- 挑战任务：只有手动飞行才能完成（自动导航永远减速泊车）----
  {
    id: 'slingshot', title: '挑战 · 引力弹弓', desc: '泊入木星后，手动把速度再拉高 20 km/s（贴近飞越借引力最省）',
    done: (c) => c.wellId === 'jupiter' && c.wellSpeedGain > 20,
  },
  {
    id: 'sun-knight', title: '挑战 · 掠日骑士', desc: '手动冲进距太阳 0.05 AU 以内并活到下一帧',
    done: (c) => c.layer === 'solar' && c.distToSun < 0.05,
  },
  {
    id: 'low-orbit', title: '挑战 · 低轨信使', desc: '贴近任一天体至 1.5 倍半径内伴飞（比自动泊距近得多）',
    done: (c) => !!c.targetRadius && c.branch === 'rendezvous' && c.distToSel < c.targetRadius * 1.5,
  },
];
