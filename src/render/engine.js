// 渲染引擎核心：场景/相机/渲染循环/后处理(Bloom)
// 一个场景常驻；世界切换 = 更换 content group + 相机初始位。
// 背景（天球星空）按层配置；CMB 壳只在 cosmos 层。
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildAmbient } from './background.js';

export class CosmicEngine {
  constructor(canvas) {
    // 对数深度缓冲：真实尺度宇宙要求 1e-7 AU（万 km 级特写）到 1e7 AU
    // 宏观视野连续覆盖，普通深度缓冲精度无法支撑
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);
    const w = window.innerWidth, h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 1e-7, 2e7);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.7, 0.55);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.bloom = bloom;
    // 常驻：内容组（当前世界实体）+ 远景背景组 + 标签组
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);
    this.backgroundGroup = new THREE.Group();
    this.scene.add(this.backgroundGroup);
    this._resizeHandlers = [];
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w/h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // 世界加载：清空内容组与背景组，加入新组
  loadWorld(world, entitiesGroup, backgroundObjects = []) {
    this._disposeGroup(this.contentGroup);
    this._disposeGroup(this.backgroundGroup);
    if (entitiesGroup) this.contentGroup.add(entitiesGroup);
    // 世界背景：跟随相机的星空（永远围绕相机）
    this.ambientGroup = buildAmbient(world.ambient || {}, this.camera);
    this.backgroundGroup.add(this.ambientGroup);
    for (const o of backgroundObjects) this.backgroundGroup.add(o);
  }

  // 每帧更新背景跟随相机
  updateAmbient() {
    if (this.ambientGroup) this.ambientGroup.position.copy(this.camera.position);
  }

  _disposeGroup(g) {
    g.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      }
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  render(dtReal) {
    this.updateAmbient();
    this.composer.render();
  }

  dispose() {
    this._disposeGroup(this.contentGroup);
    this._disposeGroup(this.backgroundGroup);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
