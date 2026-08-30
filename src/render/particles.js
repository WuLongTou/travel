// 渲染域：普通物质粒子 + 径向速度流线（streakLines）
// 目录梳理阶段 3：从 createCosmosRenderer 巨型闭包提取的第二个独立
// 子系统。工厂 createParticles(scene, sim, state) 创建粒子点云与流线，
// 返回 update(dtReal, audioLevels) 每帧刷新位置/颜色/大小。
import * as THREE from 'three';
import { levelColor } from './colors.js';

export function createParticles(scene, sim, state) {
  // ---------- 普通物质粒子 ----------
  const pN = sim.particles.length;
  const pPos = new Float32Array(pN * 3);
  const pCol = new Float32Array(pN * 3);
  const pSize = new Float32Array(pN);
  for (let i = 0; i < pN; i++) {
    pCol[i * 3] = 0.9;
    pCol[i * 3 + 1] = 0.75;
    pCol[i * 3 + 2] = 0.55;
    pSize[i] = 0.055;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (360.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.08, 1.0, d)) * 0.92;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
  });
  const particlePoints = new THREE.Points(pGeo, pMat);
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);

  // ---------- 径向速度流线：让“爆炸喷射”一眼可见 ----------
  const lineN = pN * 2;
  const linePos = new Float32Array(lineN * 3);
  const lineCol = new Float32Array(lineN * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const streakLines = new THREE.LineSegments(lineGeo, lineMat);
  streakLines.frustumCulled = false;
  scene.add(streakLines);

  function update(dtReal, audioLevels) {
    const pp = pGeo.attributes.position.array;
    const pc = pGeo.attributes.color.array;
    const ps = pGeo.attributes.aSize.array;
    const heat = Math.max(0, 1 - sim.gravityStrength);
    const earlyGlow = Math.exp(-sim.time * 1.8);

    for (let i = 0; i < pN; i++) {
      const p = sim.particles[i];
      pp[i * 3] = p.pos[0]; pp[i * 3 + 1] = p.pos[1]; pp[i * 3 + 2] = p.pos[2];
      let cr, cg, cb, size;
      if (p.seed >= 0) {
        const seed = sim.seeds[p.seed];
        const c = levelColor(seed.level);
        cr = c.r; cg = c.g; cb = c.b;
        const lv = seed.level;
        if (lv === 'void' || lv === 'dust') {
          size = 0.035 + heat * 0.05 + earlyGlow * 0.05;
        } else if (lv === 'planet') {
          size = 0.025 + seed.mass * 0.02;
        } else if (lv === 'star' || lv === 'cluster') {
          size = 0.040 + seed.mass * 0.02;
        } else if (lv === 'galaxy' || lv === 'supercluster') {
          size = 0.030 + seed.mass * 0.012;
        } else {
          size = 0.035;
          cr = 1.0; cg = 0.62; cb = 0.25;
        }
      } else {
        cr = 0.95; cg = 0.72; cb = 0.5;
        size = 0.055;
      }
      const mix = Math.min(1, heat * 1.35 + earlyGlow * 0.35);
      pc[i * 3] = cr * (1 - mix) + 0.98 * mix;
      pc[i * 3 + 1] = cg * (1 - mix) + 0.78 * mix;
      pc[i * 3 + 2] = cb * (1 - mix) + 0.55 * mix;
      ps[i] = size * (0.9 + audioLevels.beat * state.musicIntensity * 0.25);
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;

    // 径向流线：速度越快线越长、越亮
    const lp = lineGeo.attributes.position.array;
    const lc = lineGeo.attributes.color.array;
    for (let i = 0; i < pN; i++) {
      const p = sim.particles[i];
      const vx = p.vel[0], vy = p.vel[1], vz = p.vel[2];
      const sp = Math.hypot(vx, vy, vz);
      const len = Math.min(11, 0.08 + sp * 0.045 + heat * 0.5);
      const inv = sp > 1e-5 ? len / sp : 0;
      const i6 = i * 6;
      lp[i6] = p.pos[0] - vx * inv;
      lp[i6 + 1] = p.pos[1] - vy * inv;
      lp[i6 + 2] = p.pos[2] - vz * inv;
      lp[i6 + 3] = p.pos[0];
      lp[i6 + 4] = p.pos[1];
      lp[i6 + 5] = p.pos[2];
      let a = 0.10;
      if (sim.time < 1.2) a = 0.30 + heat * 0.55;
      else if (sim.time < 4.5) a = 0.10 + heat * 0.30;
      else if (p.bound && sp > 0.5) a = 0.12;
      const tw = 0.85 + Math.sin(sim.time * 3 + i) * 0.15;
      lc[i6] = 1.0 * tw;
      lc[i6 + 1] = (0.72 + heat * 0.25) * tw;
      lc[i6 + 2] = (0.45 + heat * 0.42) * tw;
      const j6 = i6 + 3;
      lc[j6] = lc[i6] * a;
      lc[j6 + 1] = lc[i6 + 1] * a;
      lc[j6 + 2] = lc[i6 + 2] * a;
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;
  }

  return { particlePoints, streakLines, update };
}
