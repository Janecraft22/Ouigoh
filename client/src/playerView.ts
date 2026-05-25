import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MAX_HEALTH, type PlayerSnapshot } from "@ouigoh/shared";
import { AnimController, buildAnimSet } from "./animations";
import { makeKnife } from "./knife";

/**
 * Each PlayerView wraps a cloned skinned character and animation mixer.
 * Holds the smoothed (interpolated) transform between server snapshots.
 */
export class PlayerView {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  anim: AnimController;
  /** Player ID for matching against snapshots. */
  id: string;
  /** Cached last applied snapshot. */
  last: PlayerSnapshot;
  /** Smoothed/rendered position. */
  smoothX: number;
  smoothZ: number;
  smoothYaw: number;
  /** Target from the latest snapshot (lerped toward each frame). */
  targetX: number;
  targetZ: number;
  targetYaw: number;
  /** Velocity for animation speed sampling. */
  velX = 0;
  velZ = 0;
  /** Name label (above head). */
  label: THREE.Sprite;
  /** Health bar mesh above head. */
  healthBar: THREE.Mesh;
  healthBarBg: THREE.Mesh;
  /** Tint color from hue. */
  tint: THREE.Color;
  /** Currently displayed attack kind (for animation picking). */
  lastAttackKind: "light" | "heavy" = "light";

  constructor(snapshot: PlayerSnapshot, sourceModel: THREE.Group, clips: THREE.AnimationClip[]) {
    this.id = snapshot.id;
    this.last = snapshot;
    this.targetX = this.smoothX = snapshot.x;
    this.targetZ = this.smoothZ = snapshot.z;
    this.targetYaw = this.smoothYaw = snapshot.yaw;

    this.group = new THREE.Group();
    const cloned = skeletonClone(sourceModel) as THREE.Group;
    // Source model is hidden in Game.preload() because it is only a clone template.
    // Ensure each spawned player clone is force-enabled for rendering.
    cloned.visible = true;
    cloned.traverse((obj) => {
      obj.visible = true;
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.SkinnedMesh).isSkinnedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    this.group.add(cloned);

    // Tint via emissive/color modulation for friend/foe distinction
    this.tint = new THREE.Color().setHSL(snapshot.hue, 0.42, 0.55);
    cloned.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (std && "emissive" in std) {
            // Slight tint via emissive
            std.emissive = this.tint.clone().multiplyScalar(0.12);
            std.emissiveIntensity = 1.0;
          }
        }
      }
    });

    // Attach a knife model to the right hand for visual flavor
    const knife = makeKnife();
    const rightHand = findBoneByName(cloned, ["RightHand", "right_hand", "Bip01_R_Hand", "R Hand", "RHand", "Hand_R"]);
    if (rightHand) {
      rightHand.add(knife);
    } else {
      // Fallback — pin to root, won't follow hand but at least visible
      cloned.add(knife);
    }

    this.mixer = new THREE.AnimationMixer(cloned);
    const animSet = buildAnimSet(this.mixer, clips);
    this.anim = new AnimController(this.mixer, animSet);

    // Name label
    this.label = makeNameSprite(snapshot.name, this.tint);
    this.label.position.set(0, 2.15, 0);
    this.group.add(this.label);

    // Health bar (mini, above head)
    const barBgGeom = new THREE.PlaneGeometry(1.0, 0.09);
    const barBgMat = new THREE.MeshBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.85, depthTest: false });
    this.healthBarBg = new THREE.Mesh(barBgGeom, barBgMat);
    this.healthBarBg.position.set(0, 1.92, 0);
    this.healthBarBg.renderOrder = 998;
    this.group.add(this.healthBarBg);

    const barGeom = new THREE.PlaneGeometry(1.0, 0.07);
    const barMat = new THREE.MeshBasicMaterial({ color: 0x6cf3a8, transparent: true, opacity: 0.95, depthTest: false });
    this.healthBar = new THREE.Mesh(barGeom, barMat);
    this.healthBar.position.set(0, 1.92, 0.001);
    this.healthBar.renderOrder = 999;
    this.group.add(this.healthBar);

    // Initial pose
    this.group.position.set(snapshot.x, 0, snapshot.z);
    this.group.rotation.y = snapshot.yaw;
  }

  applySnapshot(s: PlayerSnapshot) {
    this.last = s;
    this.targetX = s.x;
    this.targetZ = s.z;
    // Shortest-arc yaw delta to avoid wrap snap
    const cur = this.targetYaw;
    let delta = s.yaw - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.targetYaw = cur + delta;
    this.velX = s.vx;
    this.velZ = s.vz;
  }

  update(dt: number, isLocal: boolean) {
    // Interpolate toward target — for remote players this smooths between snapshots,
    // for local player this just snaps because we apply snapshots more eagerly.
    const k = isLocal ? 1 - Math.pow(0.0001, dt) : 1 - Math.pow(0.0005, dt);
    this.smoothX += (this.targetX - this.smoothX) * k;
    this.smoothZ += (this.targetZ - this.smoothZ) * k;

    // Yaw: lerp angularly via the shortest-arc target we maintain in applySnapshot
    this.smoothYaw += (this.targetYaw - this.smoothYaw) * k;

    this.group.position.x = this.smoothX;
    this.group.position.z = this.smoothZ;
    this.group.rotation.y = this.smoothYaw;

    // Animation driver
    const speed = Math.hypot(this.velX, this.velZ);
    // Compute local-space movement vector from world velocity & current yaw
    const cy = Math.cos(this.smoothYaw),
      sy = Math.sin(this.smoothYaw);
    const localZ = this.velX * sy + this.velZ * cy;
    const localX = this.velX * cy - this.velZ * sy;

    this.anim.apply({
      state: this.last.state,
      localMoveX: localX,
      localMoveZ: localZ,
      speed,
      sprint: speed > 4.0,
      combo: this.last.combo,
      attackKind: this.lastAttackKind,
    });
    this.anim.update(dt);

    // Health bar update
    const hp = Math.max(0, Math.min(1, this.last.health / MAX_HEALTH));
    this.healthBar.scale.x = Math.max(0.001, hp);
    this.healthBar.position.x = (hp - 1) * 0.5;
    (this.healthBar.material as THREE.MeshBasicMaterial).color.setHSL(0.34 * hp, 0.7, 0.55);

    // Face billboard items toward camera (label & health bar) — done in Game.render with cam orientation
  }

  dispose() {
    this.group.removeFromParent();
    this.mixer.stopAllAction();
  }
}

function makeNameSprite(name: string, tint: THREE.Color): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 36px ui-sans-serif, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.fillStyle = `#${tint.getHexString()}`;
  ctx.strokeText(name, 128, 32);
  ctx.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

function findBoneByName(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  const lower = names.map((n) => n.toLowerCase());
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (lower.includes(obj.name.toLowerCase())) {
      found = obj;
    }
  });
  return found;
}
