// 渲染域：小球轨迹（朝向相机的渐细缎带）
// 目录梳理阶段 3：从 createCosmosRenderer 巨型闭包提取的第三个独立
// 子系统。工厂 createTrail(scene, sim, camera) 创建 trail 网格与缓冲，
// 返回 { trail, pushTrail(x,y,z,speed), syncTrailRibbon(), clearTrail() }。
// 注意：依赖 camera 矩阵（syncTrailRibbon 每帧需计算 ribbon 朝向），
// 所以工厂接收 camera 参数；调用方负责在镜头更新后调用 syncTrail。
import * as THREE from 'three';

export function createTrail(scene, sim, camera) {
  const TRAIL_MAX = 3000;
  const TRAIL_HALF_WIDTH = 0.13;   // 头部（最新点）半宽，世界单位（细、不高光）
  const trailPos = new Float32Array(TRAIL_MAX * 3);
  const trailCol = new Float32Array(TRAIL_MAX * 3); // 每个采样点的颜色（速度映射）
  // 缎带几何：每个采样点展开为左右两个顶点（2×N），用三角形条带连接
  const ribbonPos = new Float32Array(TRAIL_MAX * 2 * 3);
  const ribbonCol = new Float32Array(TRAIL_MAX * 2 * 3);
  const ribbonIdx = new Uint32Array((TRAIL_MAX - 1) * 6);
  for (let i = 0, k = 0; i < TRAIL_MAX - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    ribbonIdx[k++] = a; ribbonIdx[k++] = b; ribbonIdx[k++] = c;
    ribbonIdx[k++] = c; ribbonIdx[k++] = b; ribbonIdx[k++] = d;
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPos, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(ribbonCol, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setIndex(new THREE.BufferAttribute(ribbonIdx, 1));
  const trailMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.renderOrder = 4;
  scene.add(trail);
  let trailCount = 0;

  // 速度 → 颜色映射（纯函数）
  const _sc = [0, 0, 0];
  function speedColor(speed, out) {
    const v = Math.min(1, Math.max(0, speed / 45));
    // 冷端 (0.45,0.72,1.0) → 暖端 (1.0,0.62,0.30)，整体压暗 0.55 倍，
    // 让轨迹是"细淡的指示线"而不是高光发光带（bloom 阈值附近不爆）
    out[0] = (0.45 + 0.55 * v) * 0.55;
    out[1] = (0.72 - 0.10 * v) * 0.55;
    out[2] = (1.00 - 0.70 * v) * 0.55;
  }

  function pushTrail(x, y, z, speed) {
    if (trailCount >= TRAIL_MAX) {
      trailPos.copyWithin(0, 3);
      trailCount = TRAIL_MAX - 1;
    }
    const i3 = trailCount * 3;
    trailPos[i3] = x; trailPos[i3 + 1] = y; trailPos[i3 + 2] = z;
    speedColor(speed, _sc);
    trailCol[i3] = _sc[0]; trailCol[i3 + 1] = _sc[1]; trailCol[i3 + 2] = _sc[2];
    trailCount++;
  }

  // 把采样点展开成朝向相机的渐细缎带（每帧在镜头定位后调用）
  const _va = new THREE.Vector3();
  const _vb = new THREE.Vector3();
  const _side = new THREE.Vector3();
  function syncTrailRibbon() {
    const N = Math.max(8, Math.min(TRAIL_MAX, Math.round(sim.config.trailLength || 750)));
    const start = Math.max(0, trailCount - N);
    const show = trailCount - start;
    if (show < 2) { trail.visible = false; return; }
    trail.visible = true;

    const eye = camera.position;
    const lastIdx = (trailCount - 1) * 3;
    for (let i = 0; i < show; i++) {
      const s3 = (start + i) * 3;
      const px = trailPos[s3], py = trailPos[s3 + 1], pz = trailPos[s3 + 2];
      // 切线：中央差分，首尾退化为单边差分（避免头部/尾部切向为零）
      const iPrev = (s3 - 3 >= start * 3) ? s3 - 3 : s3;
      const iNext = (s3 + 3 <= lastIdx) ? s3 + 3 : s3;
      _vb.set(
        trailPos[iNext] - trailPos[iPrev],
        trailPos[iNext + 1] - trailPos[iPrev + 1],
        trailPos[iNext + 2] - trailPos[iPrev + 2],
      );
      // 侧向 = 视线方向 × 切线 → 始终朝向相机的宽度方向
      _va.set(px - eye.x, py - eye.y, pz - eye.z);
      _side.crossVectors(_va, _vb);
      const sl = _side.length();
      if (sl < 1e-6) _side.set(1, 0, 0);
      else _side.multiplyScalar(1 / sl);

      const t = show > 1 ? i / (show - 1) : 1;
      const w = TRAIL_HALF_WIDTH;                      // 恒定宽度，近端不加粗
      const fade = Math.pow(t, 1.5);                   // 消散只靠 alpha 淡出
      const cr = trailCol[s3] * fade;
      const cg = trailCol[s3 + 1] * fade;
      const cb = trailCol[s3 + 2] * fade;
      const sx = _side.x * w, sy = _side.y * w, sz = _side.z * w;
      const d3 = i * 6; // 左顶点(2i)、右顶点(2i+1)
      ribbonPos[d3] = px + sx; ribbonPos[d3 + 1] = py + sy; ribbonPos[d3 + 2] = pz + sz;
      ribbonCol[d3] = cr; ribbonCol[d3 + 1] = cg; ribbonCol[d3 + 2] = cb;
      ribbonPos[d3 + 3] = px - sx; ribbonPos[d3 + 4] = py - sy; ribbonPos[d3 + 5] = pz - sz;
      ribbonCol[d3 + 3] = cr; ribbonCol[d3 + 4] = cg; ribbonCol[d3 + 5] = cb;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    trailGeo.setDrawRange(0, (show - 1) * 6);
  }

  function clearTrail() {
    trailCount = 0;
    trail.visible = false;
    trailGeo.setDrawRange(0, 0);
    boundsCache = null; // 轨迹清空后缓存立即失效
  }

  // ---- 轨迹包围球（镜头"轨迹感知框距"的数据源，2026-09-03 恢复）----
  // 返回最近 maxPoints 个采样点（按 0.045s/点 ≈ 显示秒）的包围球：
  // { cx, cy, cz, r, exR }。r = 包围球半径；exR = 窗口内最远采样点到
  // 小球当前显示位置 (px,py,pz) 的距离——框距用它（视点在小球附近、
  // 带前向偏置，以"小球→轨迹最远端"张角 fit 画面才准确）。
  // 0.25s 节流缓存——镜头每帧消费但几何变化慢，O(N) 重算每秒 4 次
  // 足够（750 点全量重算 <0.1ms）。
  let boundsCache = null;
  let boundsTimer = 0;
  const _b = { cx: 0, cy: 0, cz: 0, r: 0, exR: 0 };
  function getBounds(maxPoints, dtReal, px, py, pz) {
    boundsTimer -= dtReal || 0;
    if (boundsCache && boundsTimer > 0) return boundsCache;
    boundsTimer = 0.25;
    const n = Math.min(trailCount, Math.max(8, maxPoints | 0));
    if (n < 8) { boundsCache = null; return null; }
    const start = trailCount - n;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let ex2 = 0;
    for (let i = start; i < trailCount; i++) {
      const i3 = i * 3;
      const x = trailPos[i3], y = trailPos[i3 + 1], z = trailPos[i3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (px !== undefined) {
        const dx = x - px, dy = y - py, dz = z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > ex2) ex2 = d2;
      }
    }
    _b.cx = (minX + maxX) / 2;
    _b.cy = (minY + maxY) / 2;
    _b.cz = (minZ + maxZ) / 2;
    // 包围球半径（以小球当前位置为球面上一点，保证轨迹端点+小球都入画）
    const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
    _b.r = Math.sqrt(hx * hx + hy * hy + hz * hz);
    _b.exR = px !== undefined ? Math.sqrt(ex2) : _b.r;
    boundsCache = { cx: _b.cx, cy: _b.cy, cz: _b.cz, r: _b.r, exR: _b.exR };
    return boundsCache;
  }

  return { trail, pushTrail, syncTrailRibbon, clearTrail, getBounds };
}