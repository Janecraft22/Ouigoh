import {
  BTN_SPRINT,
  PRESS_LIGHT,
} from "@ouigoh/shared";

export interface InputState {
  /** Movement local-axes (-1..1). +Z forward, +X right. */
  moveX: number;
  moveZ: number;
  /** Player facing yaw (radians) accumulated from mouse. */
  yaw: number;
  /** Camera pitch (radians) accumulated from mouse — used for camera only. */
  pitch: number;
  buttons: number;
  /** Pending press bits, consumed by the network sender each tick. */
  pressed: number;
}

export class InputController {
  state: InputState = {
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0.18,
    buttons: 0,
    pressed: 0,
  };

  /** Whether mouse can rotate the camera (pointer lock). */
  get mouseActive(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private canvas: HTMLCanvasElement;
  private keys = new Set<string>();
  private mouseSensitivity = 0.0024;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", () => {
      // Clear keys/buttons when pointer lock lost
      if (!this.mouseActive) {
        this.keys.clear();
        this.state.buttons = 0;
        this.updateMovement();
      }
    });
  }

  /** Consume pressed bits — returns current pressed and resets. */
  consumePressed(): number {
    const p = this.state.pressed;
    this.state.pressed = 0;
    return p;
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("mousemove", this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const k = normalizeKey(e);
    this.keys.add(k);
    this.updateMovement();
    if (k === "shift") this.state.buttons |= BTN_SPRINT;
    if (k === "f") this.state.pressed |= PRESS_LIGHT; // alt binding
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = normalizeKey(e);
    this.keys.delete(k);
    this.updateMovement();
    if (k === "shift") this.state.buttons &= ~BTN_SPRINT;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.mouseActive) {
      // First click acquires pointer lock; don't fire attack
      return;
    }
    if (e.button === 0) this.state.pressed |= PRESS_LIGHT;
  };

  private onMouseUp = (_e: MouseEvent) => {
    // no-op
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.mouseActive) return;
    // Horizontal look should match previous in-game expectation.
    this.state.yaw -= e.movementX * this.mouseSensitivity;
    this.state.pitch += e.movementY * this.mouseSensitivity;
    // Wrap yaw to (-PI, PI]
    if (this.state.yaw > Math.PI) this.state.yaw -= Math.PI * 2;
    if (this.state.yaw < -Math.PI) this.state.yaw += Math.PI * 2;
    // Clamp pitch — third-person friendly range
    const minP = -0.45;
    const maxP = 1.15;
    if (this.state.pitch < minP) this.state.pitch = minP;
    if (this.state.pitch > maxP) this.state.pitch = maxP;
  };

  private updateMovement() {
    let mx = 0,
      mz = 0;
    if (this.keys.has("w")) mz += 1;
    if (this.keys.has("s")) mz -= 1;
    // Left/right were reversed; flip local X sign mapping.
    if (this.keys.has("a")) mx += 1;
    if (this.keys.has("d")) mx -= 1;
    this.state.moveX = mx;
    this.state.moveZ = mz;
  }
}

function normalizeKey(e: KeyboardEvent): string {
  if (e.key === "Shift") return "shift";
  if (e.key === " ") return " ";
  return e.key.toLowerCase();
}
