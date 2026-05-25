import * as THREE from "three";

/**
 * Third-person orbit camera. Smoothly follows the player from behind,
 * orbits using mouse yaw/pitch (provided by InputController).
 */
export class ThirdPersonCamera {
  cam: THREE.PerspectiveCamera;
  /** Distance behind player. */
  distance = 4.2;
  /** Pivot height offset from player feet. */
  pivotHeight = 1.55;
  /** Smoothed position for follow. */
  private smoothPos = new THREE.Vector3();
  /** Smoothed pivot. */
  private smoothPivot = new THREE.Vector3();
  private initialized = false;

  constructor() {
    this.cam = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
  }

  resize(width: number, height: number) {
    this.cam.aspect = width / height;
    this.cam.updateProjectionMatrix();
  }

  update(targetX: number, targetZ: number, yaw: number, pitch: number, dt: number) {
    // Compute desired camera position behind player
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    const pivot = new THREE.Vector3(targetX, this.pivotHeight, targetZ);
    // Behind = -forward. Forward (yaw=0) is +Z. So behind = -Z rotated by yaw.
    // World forward dir = (sin(yaw), 0, cos(yaw)) => behind = (-sin(yaw), 0, -cos(yaw))
    const offset = new THREE.Vector3(
      -sy * cp * this.distance,
      sp * this.distance,
      -cy * cp * this.distance,
    );

    const desired = pivot.clone().add(offset);

    if (!this.initialized) {
      this.smoothPos.copy(desired);
      this.smoothPivot.copy(pivot);
      this.initialized = true;
    } else {
      // Critically-damped follow
      const t = 1 - Math.pow(0.0001, dt); // ~very stiff
      this.smoothPos.lerp(desired, t);
      this.smoothPivot.lerp(pivot, t);
    }

    this.cam.position.copy(this.smoothPos);
    this.cam.lookAt(this.smoothPivot);
  }
}
