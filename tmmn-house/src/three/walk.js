// ============================================================================
//  歩行 — 一人称の移動・視点・当たり判定・階段の上り下り
// ============================================================================
//
//  PC : クリックでポインタロック → マウスで視線、WASD／矢印で移動、Shiftで速歩き
//  スマホ: 画面の左半分をなぞると移動、右半分をなぞると視線
//
//  当たり判定は、shell.js が壁を組み立てるときに一緒に作った
//  「塞がれている格子」をそのまま使います。描いた壁と当たる壁が必ず一致します。
// ============================================================================

import * as THREE from 'three';
import { build3d } from '../../data/house.js';
import { GRID, CELLS } from './shell.js';

const SPEED = 2.4;        // m/s
const RUN = 4.2;
const ACCEL = 12;
const LOOK_SENS = 0.0022;
const TOUCH_LOOK = 0.005;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

export class Walker {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom  イベントを取る要素（canvasの親）
   * @param {{id:string, level:number, blocked:Uint8Array}[]} levels
   * @param {object[]} stairs  shell.stairProfile() の配列
   */
  constructor(camera, dom, levels, stairs) {
    this.camera = camera;
    this.dom = dom;
    this.levels = levels;
    this.stairs = stairs;

    this.yaw = 0;                // 0 = 北を向く（カメラの正面は -z ＝ 北）
    this.pitch = 0;
    this.position = new THREE.Vector3(5.9, 0, 9.4);
    this.velocity = new THREE.Vector3();
    this.floorIndex = 0;
    this.enabled = false;

    this.keys = new Set();
    this.touchMove = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.touchLook = { active: false, id: null, x: 0, y: 0 };

    this._bind();
  }

  // ── 入力 ────────────────────────────────────────────────
  _bind() {
    const d = this.dom;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== d) return;
      this.yaw -= e.movementX * LOOK_SENS;
      this.pitch = clamp(this.pitch - e.movementY * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onLockChange = () => {
      this.locked = document.pointerLockElement === d;
      this.onLockChange?.(this.locked);
    };
    document.addEventListener('pointerlockchange', this._onLockChange);

    // タッチ：左半分＝移動、右半分＝視線
    const half = () => d.getBoundingClientRect();
    d.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const r = half();
        const left = (t.clientX - r.left) < r.width / 2;
        if (left && !this.touchMove.active) {
          this.touchMove = { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
        } else if (!left && !this.touchLook.active) {
          this.touchLook = { active: true, id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });

    d.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (this.touchMove.active && t.identifier === this.touchMove.id) {
          this.touchMove.dx = clamp((t.clientX - this.touchMove.ox) / 60, -1, 1);
          this.touchMove.dy = clamp((t.clientY - this.touchMove.oy) / 60, -1, 1);
        }
        if (this.touchLook.active && t.identifier === this.touchLook.id) {
          this.yaw -= (t.clientX - this.touchLook.x) * TOUCH_LOOK;
          this.pitch = clamp(this.pitch - (t.clientY - this.touchLook.y) * TOUCH_LOOK, -PITCH_LIMIT, PITCH_LIMIT);
          this.touchLook.x = t.clientX;
          this.touchLook.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchMove.id) this.touchMove = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
        if (t.identifier === this.touchLook.id) this.touchLook = { active: false, id: null, x: 0, y: 0 };
      }
    };
    d.addEventListener('touchend', end);
    d.addEventListener('touchcancel', end);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() { this.dom.requestPointerLock?.(); }
  releaseLock() { document.exitPointerLock?.(); }

  // ── 位置の指定（視点ジャンプ／ツアー） ──────────────────
  teleport(floorIndex, x, z, dirDeg) {
    this.floorIndex = floorIndex;
    this.position.set(x, this.levels[floorIndex].level, z);
    // data の dir は 0=北・90=東。カメラの正面は yaw=0 のとき -z（＝北）なので、
    // 東（+x）を向くには yaw を負に回す。
    this.yaw = -THREE.MathUtils.degToRad(dirDeg ?? 0);
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  // ── 毎フレーム ──────────────────────────────────────────
  update(dt) {
    const k = this.keys;
    let fwd = 0; let side = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) side += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) side -= 1;
    if (this.touchMove.active) { fwd -= this.touchMove.dy; side += this.touchMove.dx; }

    const speed = (k.has('ShiftLeft') || k.has('ShiftRight')) ? RUN : SPEED;
    const len = Math.hypot(fwd, side) || 1;
    // 正面 = (-sin yaw, 0, -cos yaw)、右 = (cos yaw, 0, -sin yaw)
    const target = new THREE.Vector3(
      (-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side) / len * speed,
      0,
      (-Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side) / len * speed,
    );
    if (fwd === 0 && side === 0) target.set(0, 0, 0);

    this.velocity.lerp(target, Math.min(1, ACCEL * dt));

    // XとZを別々に判定して、壁ぎわを滑らせる
    const next = this.position.clone();
    const stepX = this.velocity.x * dt;
    const stepZ = this.velocity.z * dt;
    if (this._free(next.x + stepX, next.z)) next.x += stepX;
    if (this._free(next.x, next.z + stepZ)) next.z += stepZ;

    this.position.x = next.x;
    this.position.z = next.z;
    this._resolveHeight();
    this._apply();
  }

  /**
   * その位置に立てるか（体の半径ぶんをサンプルする）。
   * 階段の範囲にかかるサンプルは、床が無くても通れるものとして無視する。
   * （そうしないと、階段室の抜きに体の半分がかかった時点で登れなくなる）
   */
  _free(x, z) {
    const grid = this.levels[this.floorIndex].blocked;
    const r = build3d.bodyRadius;
    for (const [dx, dz] of OFFSETS) {
      const px = x + dx * r;
      const pz = z + dz * r;
      if (this._onStair(px, pz)) continue;
      const i = Math.floor(px / GRID);
      const j = Math.floor(pz / GRID);
      if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) return false;
      if (grid[j * CELLS + i]) return false;
    }
    return true;
  }

  _onStair(x, z) {
    return this.stairs.some((s) => s.contains(x, z));
  }

  /** 階段の上では高さを補間し、階をまたいだら現在階を切り替える */
  _resolveHeight() {
    const s = this.stairs.find((st) => st.contains(this.position.x, this.position.z));
    if (s) {
      this.position.y = s.heightAt(this.position.x, this.position.z);
      // 階段の途中で、より近い方の階を「現在階」にする
      const idx = this.position.y > (s.base + s.top) / 2 ? 1 : 0;
      if (this.floorIndex !== idx) this.floorIndex = idx;
      return;
    }
    // 階段の外に出たら、いまいる階の床に吸着させる
    const lv = this.levels[this.floorIndex];
    this.position.y = lv.level;
  }

  _apply() {
    this.camera.position.set(this.position.x, this.position.y + build3d.eyeHeight, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }
}

/** 体の周り8方向＋中心をサンプルして、壁めり込みを防ぐ */
const OFFSETS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
