// 无头冒烟：跑一遍仿真，量化「渐进发现」的实际节奏，并做健康断言
// 用法: node scripts/smoke-discovery.mjs [模拟秒数]
// 退出码：0 = 通过；1 = 异常或断言失败（供 CI / 提交前检查使用）
import { CosmicSimulation } from '../src/cosmos.js';
import { PROBE_MAX_SPEED } from '../src/core/config.js';

const SECONDS = Number(process.argv[2] || 600);
const sim = new CosmicSimulation({});
const DT = 0.02;
const steps = Math.round(SECONDS / DT);

// 每个系统：detail 生命周期内，小球到系统中心的最近距离（以 detailRadius 为单位）
const stat = new Map(); // idx -> { level, total, minR, last, gen, trace }
let error = null;
// 健康断言的采样：越界速度步数 / 非有限位置
let speedViolations = 0;
let nonFinitePos = 0;

const TRACE_CAP = 40000; // 每步采样一条，超长仿真时截断，避免内存无上限增长

try {
  for (let i = 0; i < steps; i++) {
    sim.step(DT);
    // ---- 健康采样 ----
    const pr = sim.probe;
    const sp = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
    // 暴胀窗口（t<1.2s）内豁免限速；之后速度上限是硬截断，越界即物理 bug
    if (sim.time > 1.3 && sp > PROBE_MAX_SPEED * 1.01) speedViolations++;
    if (!pr.pos.every(Number.isFinite)) nonFinitePos++;
    for (const s of sim.seeds) {
      if (!s.detail) continue;
      const r = sim._detailRadius(s);
      const d = Math.hypot(
        sim.probe.pos[0] - s.pos[0], sim.probe.pos[1] - s.pos[1], sim.probe.pos[2] - s.pos[2],
      ) / r;
      let st = stat.get(s.idx);
      if (!st || st.gen !== s.detail) {
        st = { level: s.level, total: s.detail.bodies.length, minR: d, last: 0, gen: s.detail, trace: [] };
        stat.set(s.idx, st);
      }
      if (d < st.minR) st.minR = d;
      st.last = s.detail.foundCount;
      if (st.trace.length < TRACE_CAP) st.trace.push(s.detail.foundCount);
    }
  }
} catch (e) {
  error = e;
}

const rows = [...stat.values()].sort((a, b) => a.minR - b.minR);
console.log('=== 冒烟 ===');
console.log(`模拟 ${SECONDS}s | 异常: ${error ? (error.stack || error.message) : '无'}`);
console.log(`事件 ${sim.events.length} 条 | 第 ${sim.probe.generation} 代 | 重生 ${sim.probe.respawns} 次`);

console.log('\n=== 各系统：最近接近程度 vs 最终发现数 ===');
console.log('档位          成员数  最近距离(×R)  已发现  发现率');
for (const st of rows) {
  const pct = st.total ? (st.last / st.total * 100).toFixed(0) : '-';
  console.log(
    `${st.level.padEnd(13)} ${String(st.total).padStart(4)}   ${st.minR.toFixed(2).padStart(8)}` +
    `      ${String(st.last).padStart(4)}   ${String(pct).padStart(4)}%`,
  );
}

// 渐进性：进入最深的那个系统，从"发现第 1 个"到"发现 90%"用了多久
const deepest = rows[0];
if (deepest && deepest.last > 0) {
  const t = deepest.trace;
  const i1 = t.findIndex((v) => v > 0);
  const i9 = t.findIndex((v) => v >= deepest.total * 0.9);
  console.log('\n=== 渐进性（进入最深的系统）===');
  console.log(`档位 ${deepest.level} | 成员 ${deepest.total} | 最近 ${deepest.minR.toFixed(2)}R`);
  console.log(`首个发现 → 90%：${i1 >= 0 && i9 >= 0 ? ((i9 - i1) * DT).toFixed(1) + 's' : '未达到 90%'}`);
  const picked = [];
  for (let i = i1 >= 0 ? i1 : 0; i < t.length && picked.length < 14; i += 20) picked.push(t[i]);
  console.log(`轨迹（每 0.4s 采样）：${picked.join(' → ')}`);
}

// 分桶：不同接近深度下的平均发现率
const buckets = [[0, 0.5], [0.5, 0.8], [0.8, 1.1], [1.1, 1.5], [1.5, 9]];
console.log('\n=== 按接近深度分桶 ===');
console.log('深度(×R)      系统数  平均发现率  全空的系统数');
for (const [lo, hi] of buckets) {
  const g = rows.filter((s) => s.minR >= lo && s.minR < hi);
  if (!g.length) { console.log(`${lo}~${hi}        0        -          -`); continue; }
  const avg = g.reduce((a, s) => a + s.last / Math.max(1, s.total), 0) / g.length;
  const zero = g.filter((s) => s.last === 0).length;
  console.log(`${String(lo + '~' + hi).padEnd(12)} ${String(g.length).padStart(4)}      ${(avg * 100).toFixed(0).padStart(3)}%        ${zero}`);
}

// ---- 健康断言（阈值刻意宽松，只拦"坏了"，不卡"手感波动"）----
const failures = [];
if (error) failures.push('仿真抛出异常');
if (nonFinitePos > 0) failures.push(`小球位置出现非有限值 ${nonFinitePos} 步`);
if (speedViolations > 0) failures.push(`限速截断失效：${speedViolations} 步速度超过 PROBE_MAX_SPEED(${PROBE_MAX_SPEED})`);
// 深入腹地（<0.5R）却一个成员都没发现 → 渐进发现管线断裂
const deep = rows.filter((s) => s.minR < 0.5);
if (deep.length > 0 && deep.every((s) => s.last === 0)) failures.push('深入腹地（<0.5R）的系统发现数全为 0，渐进发现疑似失效');
// 重生次数异常高 → 死亡连环（respawnGrace 失效或投放穿心回归）
if (sim.probe.respawns > 80) failures.push(`重生 ${sim.probe.respawns} 次（>80），疑似死亡连环`);

console.log('\n=== 断言 ===');
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  console.log('结果：FAIL');
  process.exit(1);
}
console.log('FAIL 无');
console.log('结果：PASS');
process.exit(0);
