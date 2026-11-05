import { settings } from './Settings.js';
import { bus } from './Bus.js';

// Action -> keyboard codes. C is the primary descend key (Ctrl+W closes tabs in some browsers).
const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['KeyC', 'ControlLeft', 'ControlRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  torch: ['KeyF'],
  journal: ['KeyJ'],
  photo: ['KeyP'],
  pause: ['Escape'],
  sonar: ['KeyR'],
  skip: ['Enter', 'NumpadEnter', 'Tab'],
  alt: ['KeyQ'],
  shutter: ['Enter', 'NumpadEnter'],
};

// Standard gamepad mapping
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, left: false, right: false, leftPressed: false, rightPressed: false, leftReleased: false, rightReleased: false };
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0, z: 0 }; // strafe, vertical, forward (−1..1)
    this.locked = false;
    this.wantLock = false;
    this.lockSupported = 'pointerLockElement' in document;
    this.lastLockFail = 0;
    this.gamepad = null;
    this.padPrev = [];
    this.enabled = true;
    this.lastDevice = 'kbm';
    this._bind();
  }

  _bind() {
    const kd = (e) => {
      if (e.repeat) { if (this._isGameKey(e.code)) e.preventDefault(); return; }
      this.lastDevice = 'kbm';
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
      if (this._isGameKey(e.code)) e.preventDefault();
    };
    const ku = (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; });
    const mm = (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) {
        // guard against the large spikes some browsers emit when pointer lock engages
        const dx = Math.abs(e.movementX) > 300 ? 0 : e.movementX;
        const dy = Math.abs(e.movementY) > 300 ? 0 : e.movementY;
        this.mouse.dx += dx; this.mouse.dy += dy;
      } else if (this.dragLook && (this.mouse.left || this.mouse.right)) {
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      }
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mousedown', (e) => {
      this.lastDevice = 'kbm';
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      if (this.wantLock && !this.locked && e.target === this.canvas) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.mouse.leftReleased = true; }
      if (e.button === 2) { this.mouse.right = false; this.mouse.rightReleased = true; }
    });
    window.addEventListener('contextmenu', (e) => { if (this.wantLock || this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) bus.emit('pointerunlock');
      if (!was && this.locked) bus.emit('pointerlock');
    });
    document.addEventListener('pointerlockerror', () => { this.lastLockFail = performance.now(); this.dragLook = true; });
    window.addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad.index; bus.emit('gamepad', true); });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad = null; bus.emit('gamepad', false); });
  }

  _isGameKey(code) {
    for (const k in KEYMAP) if (KEYMAP[k].includes(code)) return true;
    return false;
  }

  requestLock() {
    if (!this.lockSupported) { this.dragLook = true; return; }
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => { this.dragLook = true; });
    } catch (e) {
      this.dragLook = true;
    }
  }

  exitLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
  }

  isDown(action) {
    if (!this.enabled) return false;
    for (const c of KEYMAP[action] || []) if (this.down.has(c)) return true;
    return this._padDown(action);
  }

  pressed(action) {
    if (!this.enabled) return false;
    for (const c of KEYMAP[action] || []) if (this.pressedSet.has(c)) return true;
    return this._padPressed(action);
  }

  released(action) {
    for (const c of KEYMAP[action] || []) if (this.releasedSet.has(c)) return true;
    return false;
  }

  _padButtons() {
    if (this.gamepad === null || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.gamepad];
    return gp || null;
  }

  _padMap(action) {
    switch (action) {
      case 'interact': return [PAD.a];
      case 'torch': return [PAD.y];
      case 'journal': return [PAD.back];
      case 'pause': return [PAD.start];
      case 'photo': return [PAD.up];
      case 'sonar': return [PAD.x];
      case 'sprint': return [PAD.ls];
      case 'up': return [PAD.rb];
      case 'down': return [PAD.lb];
      case 'skip': return [PAD.b];
      case 'alt': return [PAD.down];
      case 'shutter': return [PAD.a];
      default: return [];
    }
  }

  _padDown(action) {
    const gp = this._padButtons();
    if (!gp) return false;
    for (const b of this._padMap(action)) if (gp.buttons[b]?.pressed) return true;
    return false;
  }

  _padPressed(action) {
    const gp = this._padButtons();
    if (!gp) return false;
    for (const b of this._padMap(action)) if (gp.buttons[b]?.pressed && !this.padPrev[b]) return true;
    return false;
  }

  /** Call once per frame before game logic. */
  update(dt) {
    const sens = settings.get('sensitivity');
    const inv = settings.get('invertY') ? -1 : 1;
    this.look.x = this.mouse.dx * 0.0022 * sens;
    this.look.y = this.mouse.dy * 0.0022 * sens * inv;
    this.mouse.dx = 0; this.mouse.dy = 0;
    let mx = 0, mz = 0, my = 0;
    if (this.isDown('forward')) mz += 1;
    if (this.isDown('back')) mz -= 1;
    if (this.isDown('right')) mx += 1;
    if (this.isDown('left')) mx -= 1;
    if (this.isDown('up')) my += 1;
    if (this.isDown('down')) my -= 1;
    const gp = this._padButtons();
    this.padLT = 0; this.padRT = 0;
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
      if (lx || ly || rx || ry) this.lastDevice = 'pad';
      mx += lx; mz -= ly;
      this.look.x += rx * 2.6 * dt * sens;
      this.look.y += ry * 2.6 * dt * sens * inv;
      this.padLT = gp.buttons[PAD.lt]?.value || 0;
      this.padRT = gp.buttons[PAD.rt]?.value || 0;
      my += this.padRT * 0 ; // triggers are used by the pod (arm / grab)
    }
    this.move.x = Math.max(-1, Math.min(1, mx));
    this.move.y = Math.max(-1, Math.min(1, my));
    this.move.z = Math.max(-1, Math.min(1, mz));
    if (!this.enabled) { this.move.x = this.move.y = this.move.z = 0; this.look.x = this.look.y = 0; }
  }

  /** Call once per frame after game logic. */
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mouse.leftPressed = this.mouse.rightPressed = false;
    this.mouse.leftReleased = this.mouse.rightReleased = false;
    const gp = this._padButtons();
    if (gp) this.padPrev = gp.buttons.map((b) => b.pressed);
  }

  /** Primary click (left mouse or pad A). */
  clickPressed() { return this.enabled && (this.mouse.leftPressed || this._padPressedRaw(PAD.a) || this._padPressedRaw(PAD.rt)); }
  clickDown() { const gp = this._padButtons(); return this.enabled && (this.mouse.left || !!(gp && (gp.buttons[PAD.a]?.pressed || (gp.buttons[PAD.rt]?.value || 0) > 0.5))); }
  altDown() { const gp = this._padButtons(); return this.enabled && (this.mouse.right || !!(gp && (gp.buttons[PAD.lt]?.value || 0) > 0.5)); }
  _padPressedRaw(b) { const gp = this._padButtons(); return !!(gp && gp.buttons[b]?.pressed && !this.padPrev[b]); }
}
