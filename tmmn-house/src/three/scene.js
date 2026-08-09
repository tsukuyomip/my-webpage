// ============================================================================
//  3Dウォークスルーの組み立て — 光・環境・敷地・レンダリング
// ============================================================================

import * as THREE from 'three';
import { RoomEnvironment } from '../../vendor/addons/RoomEnvironment.js';
import { Reflector } from '../../vendor/addons/Reflector.js';
import { floors, build3d, meta } from '../../data/house.js';
import { findView } from '../geometry.js';
import { buildFloorShell, stairProfile, registerFurniture, checkDoorClearance } from './shell.js';
import { furnishRoom } from './furniture.js';
import { buildBackgroundTree } from './tree.js';
import { sharedMaterials, box } from './materials.js';
import { Walker } from './walk.js';

export class Walkthrough {
  constructor(container) {
    this.container = container;
    this.disposed = false;
    this.ready = false;
    this._build();
  }

  // ── 初期化 ──────────────────────────────────────────────
  _build() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, w / h, 0.05, 200);

    this._sky();
    this._environment();
    this._lights();
    this._house();
    this._site();

    // 歩行
    const levels = floors.map((f, i) => ({
      id: f.id, level: f.level, blocked: this.shells[i].blocked,
    }));
    const stairs = [stairProfile(floors[0], floors[1].level)].filter(Boolean);
    this.walker = new Walker(this.camera, this.renderer.domElement, levels, stairs);

    // 玄関に立たせる
    this.walker.teleport(0, 5.9, 9.4, 0);

    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.ready = true;
  }

  // ── 空 ──────────────────────────────────────────────────
  _sky() {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, '#6f9dc9');
    grad.addColorStop(0.42, '#a8c6de');
    grad.addColorStop(0.52, '#dfe6e6');
    grad.addColorStop(0.60, '#cfc7bb');
    grad.addColorStop(1.00, '#9d958a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    this.scene.fog = new THREE.Fog(0xc4ccd2, 40, 130);
  }

  // ── 環境光（PBRの映り込み） ─────────────────────────────
  _environment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  // ── 光 ──────────────────────────────────────────────────
  _lights() {
    // 太陽。中庭に光が落ちる角度に振る
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
    sun.position.set(9, 14, 7);
    sun.target.position.set(6.2, 0, 5.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 46;
    const s = 12;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.022;
    this.scene.add(sun, sun.target);

    // 空と地面からの回り込み
    this.scene.add(new THREE.HemisphereLight(0xdcebff, 0x8c8172, 0.95));

    // 室内の要所に、影を落とさない補助光
    const spots = [
      [5.4, 2.1, 8.8, 0xffe6c4, 8, 5],    // 玄関土間
      [3.9, 2.1, 4.0, 0xffe6c4, 6, 4.5],  // 中庭沿いの廊下
      [1.7, 2.1, 1.7, 0xffe0bd, 5, 4],    // 主寝室
      [6.2, 2.1, 1.2, 0xffdcb0, 8, 5],    // 書斎
      [6.2, 2.2, 2.9, 0xffe6c4, 4, 3.5],  // ヌック
      [9.0, 2.1, 1.5, 0xf2f6ff, 5, 4],    // 洗面
      [2.2, 2.1, 2.0, 0xffe0bd, 4, 3.5],  // 主寝室の間接
      [8.3, 2.1, 8.8, 0xdfe9ff, 5, 4],    // ジム
      [1.7, 5.0, 8.3, 0xffe6c4, 7, 5],    // 2F リビング
      [1.7, 5.0, 5.0, 0xffe6c4, 7, 5],    // 2F ダイニング
      [1.7, 5.0, 2.0, 0xfff0dc, 6, 4.5],  // 2F キッチン
      [9.0, 5.0, 5.0, 0xffe6c4, 5, 4],    // 2F 書庫
      [6.2, 1.6, 5.2, 0xfff3e0, 6, 5],    // 中庭のアッパーライト
    ];
    for (const [x, y, z, color, intensity, dist] of spots) {
      const p = new THREE.PointLight(color, intensity, dist, 2);
      p.position.set(x, y, z);
      this.scene.add(p);
    }
  }

  // ── 建物 ────────────────────────────────────────────────
  _house() {
    this.shells = [];
    this.house = new THREE.Group();

    floors.forEach((floor, i) => {
      const upper = floors[i + 1];
      // 上階の吹抜と階段室は、この階の天井に穴として開ける
      const holesAbove = upper
        ? [...(upper.slabHoles ?? []), ...(upper.voids ?? []).map((v) => v.polygon)]
        : [];

      const shell = buildFloorShell(floor, {
        isTop: i === floors.length - 1,
        holesAbove,
        riseToNext: upper ? upper.level - floor.level : undefined,
      });
      this.shells.push(shell);
      this.house.add(shell.group);

      for (const area of [...floor.rooms, ...(floor.voids ?? [])]) {
        const f = furnishRoom(area, floor.level, floor.openings ?? []);
        if (!f) continue;
        this.house.add(f);
        // 家具もすり抜けられないようにする
        registerFurniture(f, floor.level, shell.blocked);
      }
    });

    // 家具を置いたあとで、建具の前後がふさがっていないかを実測する
    this.clearance = floors.map((floor, i) => ({
      floor, results: checkDoorClearance(floor, this.shells[i].blocked),
    }));
    const bad = this.clearance.flatMap(({ floor, results }) =>
      results.filter((r) => !r.ok).map((r) => `${floor.name} ${r.label}: ${r.detail}`));
    if (bad.length) console.warn('[tmmn-house] 建具の前後がふさがっています:\n' + bad.join('\n'));
    else console.info('[tmmn-house] 建具の前後の空き: すべてOK');

    this._gymMirror();
    this.scene.add(this.house);
  }

  /** ジムの east 面いっぱいのミラー（実際に映り込む） */
  _gymMirror() {
    const mirror = new Reflector(new THREE.PlaneGeometry(2.24, 2.2), {
      textureWidth: 512,
      textureHeight: 512,
      color: 0xa6adaf,
    });
    mirror.position.set(9.88, 1.22, 8.82);
    mirror.rotation.y = -Math.PI / 2;
    this.house.add(mirror);
    this.mirror = mirror;
  }

  // ── 敷地・周辺 ──────────────────────────────────────────
  _site() {
    const S = sharedMaterials();
    const g = new THREE.Group();
    const { w, d } = meta.footprint;
    // 地盤面（GL）は1Fの床（FL=0）より450mm下。中庭の床（−120mm）より
    // さらに下げておかないと、地面が中庭の芝を隠してしまう。
    const GL = -0.45;

    // 地面
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w / 2, GL, d / 2);
    ground.receiveShadow = true;
    g.add(ground);

    // 前面道路
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 6),
      new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.95 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(w / 2, GL + 0.01, d + 5.2);
    road.receiveShadow = true;
    g.add(road);

    // アプローチ
    const approach = box(3.2, 0.04, 2.2, S.stoneTop);
    approach.position.set(5.6, GL + 0.03, d + 1.1);
    g.add(approach);
    // 玄関ポーチの段（GL → FL）
    for (let i = 0; i < 3; i++) {
      const st = box(2.4 - i * 0.0, 0.15, 0.32, S.stoneTop);
      st.position.set(5.9, GL + 0.075 + i * 0.15, d + 0.16 + (2 - i) * 0.32);
      st.receiveShadow = true;
      g.add(st);
    }
    // 建物の基礎の立ち上がり
    const plinth = box(w + 0.1, 0.5, d + 0.1, new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.95 }));
    plinth.position.set(w / 2, GL + 0.25 - 0.2, d / 2);
    g.add(plinth);
    // ガレージの前面は乗り入れるためスロープにする
    const ramp = box(3.4, 0.04, 2.6, new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.95 }));
    ramp.position.set(1.7, GL + 0.24, d + 1.3);
    ramp.rotation.x = -Math.atan2(0.45, 2.6);
    g.add(ramp);

    // 敷地の塀（北・東・西）。南は道路なので低く
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.92 });
    const fence = [
      [-2.2, -2.2, w + 2.2, -2.2, 2.0],
      [-2.2, -2.2, -2.2, d + 2.2, 2.0],
      [w + 2.2, -2.2, w + 2.2, d + 2.2, 2.0],
      [-2.2, d + 2.2, w + 2.2, d + 2.2, 0.6],
    ];
    for (const [x0, z0, x1, z1, hh] of fence) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const m = box(horiz ? len : 0.16, hh, horiz ? 0.16 : len, wallMat);
      m.position.set((x0 + x1) / 2, GL + hh / 2, (z0 + z1) / 2);
      m.receiveShadow = true;
      m.castShadow = true;
      g.add(m);
    }

    // 植栽
    for (const [x, z, s] of [[-1.2, 1.5, 1.0], [-1.3, 6.5, 0.85], [11.4, 2.0, 0.95],
      [11.2, 7.5, 1.1], [2.0, -1.2, 0.9], [8.4, -1.3, 1.0]]) {
      g.add(buildBackgroundTree(x, GL, z, s));
    }

    // 遠景の家並み（輪郭だけ）
    const far = new THREE.MeshStandardMaterial({ color: 0xb6b0a6, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const bw = 6 + Math.random() * 5;
      const bh = 5 + Math.random() * 3;
      const m = box(bw, bh, 6 + Math.random() * 4, far);
      const a = (i / 14) * Math.PI * 2;
      m.position.set(w / 2 + Math.cos(a) * (26 + Math.random() * 14), GL + bh / 2, d / 2 + Math.sin(a) * (26 + Math.random() * 14));
      m.rotation.y = Math.random() * Math.PI;
      g.add(m);
    }

    this.scene.add(g);
    this.site = g;
  }

  // ── 公開API ─────────────────────────────────────────────

  /** 平面図の視点マーカーと同じ位置・向きに立たせる */
  gotoView(viewId) {
    const hit = findView(floors, viewId);
    if (!hit) return false;
    const idx = floors.indexOf(hit.floor);
    const [x, z] = hit.view.at;
    this.walker.teleport(idx, x, z, hit.view.dir);
    return true;
  }

  /** 階を指定して、その階の代表位置に立たせる */
  gotoFloor(floorId) {
    const idx = floors.findIndex((f) => f.id === floorId);
    if (idx < 0) return;
    const spot = idx === 0 ? [5.9, 9.4, 0] : [3.9, 8.6, 0];
    this.walker.teleport(idx, spot[0], spot[1], spot[2]);
  }

  get currentFloorId() { return floors[this.walker.floorIndex]?.id; }

  start() {
    if (this.running) return;
    this.running = true;
    this.walker.enabled = true;
    this.clock = new THREE.Clock();
    const loop = () => {
      if (!this.running || this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.walker.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.();
    };
    loop();
  }

  stop() {
    this.running = false;
    this.walker.enabled = false;
    cancelAnimationFrame(this.raf);
  }

  resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    this.stop();
    this.disposed = true;
    removeEventListener('resize', this._resize);
    this.walker.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [].concat(o.material)) {
          for (const k of ['map', 'normalMap', 'roughnessMap']) m[k]?.dispose?.();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { build3d };
