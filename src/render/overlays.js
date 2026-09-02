// 渲染域：全屏叠加层（大爆炸闪光 / 虫洞跃迁）
import * as THREE from 'three';
import { randomUnit } from '../core/utils.js';
import { COLLECTION_LEVELS } from '../core/config.js';

export function createFlashOverlay() {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uAlpha;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        vec2 dir = r > 0.0001 ? p / r : vec2(1.0, 0.0);

        // 奇点白闪：前 ~0.2 秒整屏过曝（大爆炸就是一瞬间）
        float flash = exp(-uTime * 13.0) * 2.4;
        // 暴胀冲击波环：5.2/s 扫过全屏（0.3s 内越过视野）、4/s 快速衰减
        // ——扫过即熄灭，不残留光环
        float shockR = uTime * 5.2;
        float ring = exp(-pow((r - shockR) * 5.5, 2.0)) * exp(-uTime * 4.0);
        // 放射状能量射线：密集、快消（超光速扩张的"能量喷射"感）
        float ang = atan(p.y, p.x);
        float rays = pow(max(0.0, abs(sin(ang * 18.0 + uTime * 5.0))), 24.0);
        rays *= exp(-uTime * 4.5) * 0.7 * (1.0 - smoothstep(0.15, 1.45, r));
        // 中心余晖：主脉冲后快速熄灭
        float core = exp(-r * r * 16.0) * exp(-uTime * 7.0) * 1.2;

        // 色散：冲击波边缘红蓝略微分离，更像高温等离子体
        float ca = ring * 0.20 + core * 0.12;
        vec3 col = vec3(0.0);
        col += vec3(1.10, 0.98, 0.88) * flash;
        col += vec3(1.00, 0.72, 0.42) * ring;
        col += vec3(0.65, 0.78, 1.00) * rays;
        col += vec3(1.00, 0.92, 0.72) * core;
        col.r += ca * (0.6 + dir.x * 0.4);
        col.b += ca * (0.6 - dir.x * 0.4);

        float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * uAlpha;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, mat, quad };
}

// 虫洞跃迁的全屏叠加层：屏幕中心出现一个旋转的能量环，逐渐扩张然后消失
export function createWormholeOverlay() {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDur: { value: 1.4 },
      uProgress: { value: 0 }, // 0..1
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uDur;
      uniform float uProgress;
      void main() {
        if (uProgress <= 0.0 || uProgress >= 1.0) { gl_FragColor = vec4(0.0); return; }
        vec2 p = vUv * 2.0 - 1.0;
        // 拉伸感：让圆环在水平方向上略微椭圆
        p.x *= 1.0;
        float r = length(p);
        // 环半径随时间 0 → 1 增长
        float ringR = mix(0.05, 0.95, uProgress);
        // 环厚度也随时间拉宽
        float ringW = mix(0.05, 0.20, uProgress);
        float ring = exp(-pow((r - ringR) / ringW, 2.0));
        // 旋转条纹
        float ang = atan(p.y, p.x);
        float spiral = 0.5 + 0.5 * sin(ang * 6.0 + uProgress * 18.0);
        ring *= 0.55 + 0.45 * spiral;
        // 进入时整屏白闪（0.0~0.15）
        float flash = exp(-pow((uProgress - 0.0) * 6.0, 2.0)) * 0.55;
        // 中心向外扩张的能量波
        float wave = smoothstep(0.0, 1.0, 1.0 - abs(r - ringR) * 4.0) * (1.0 - uProgress);
        vec3 col = vec3(0.0);
        col += vec3(0.45, 0.75, 1.0) * ring * 0.85;
        col += vec3(1.0, 0.92, 0.78) * ring * 0.45 * spiral;
        col += vec3(1.0) * flash;
        col += vec3(0.5, 0.7, 1.0) * wave * 0.4;
        // 离开时（0.85~1.0）整屏轻微蓝色过曝
        col += vec3(0.55, 0.75, 1.0) * smoothstep(0.85, 1.0, uProgress) * 0.25;
        float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, mat, quad };
}

