import * as THREE from "three";
import type { ActionState, AttackKind } from "@ouigoh/shared";

/**
 * Picks the best animation clip for a given desired logical name.
 * Searches clip names with loose substring matching to be tolerant of FBX
 * naming conventions (e.g. "murderer_idle", "AnimStack::idle").
 */
export function findClip(clips: THREE.AnimationClip[], aliases: string[]): THREE.AnimationClip | null {
  // Lowercase & strip common prefixes
  for (const alias of aliases) {
    const want = canonical(alias);
    const exact = clips.find((c) => normalize(c.name) === want);
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const want = canonical(alias);
    const sub = clips.find((c) => {
      const got = normalize(c.name);
      // Match both directions to handle cases like "leftstrafe" vs "strafeleft"
      return got.includes(want) || want.includes(got);
    });
    if (sub) return sub;
  }
  return null;
}

function normalize(name: string): string {
  return canonical(
    name
      .toLowerCase()
      .replace(/^.*?::/, "")
      .replace(/^(take_?\d+|takeoo1|take 001)\b/, "")
      .replace(/^(murderer|zombie|character)[_\s-]?/, ""),
  );
}

function canonical(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface AnimSet {
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  backpedal: THREE.AnimationAction | null;
  strafeLeft: THREE.AnimationAction | null;
  strafeRight: THREE.AnimationAction | null;
  slash1: THREE.AnimationAction | null;
  slashStart: THREE.AnimationAction | null;
  slashLoop: THREE.AnimationAction | null;
  slashEnd: THREE.AnimationAction | null;
  hitFront: THREE.AnimationAction | null;
  hitBack: THREE.AnimationAction | null;
  hitLeft: THREE.AnimationAction | null;
  hitRight: THREE.AnimationAction | null;
  death: THREE.AnimationAction | null;
  spawn: THREE.AnimationAction | null;
  roar: THREE.AnimationAction | null;
  sneak: THREE.AnimationAction | null;
}

export function buildAnimSet(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): AnimSet {
  const mk = (aliases: string[], loop = true): THREE.AnimationAction | null => {
    const clip = findClip(clips, aliases);
    if (!clip) return null;
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    if (!loop) action.clampWhenFinished = true;
    return action;
  };
  const set: AnimSet = {
    idle: mk(["idle"], true),
    walk: mk(["walk", "walking"], true),
    run: mk(["run", "running", "jog"], true),
    backpedal: mk(["backpedal", "back", "backward"], true),
    strafeLeft: mk(["strafe_left", "shuffle_left", "sidestep_left", "left"], true),
    strafeRight: mk(["strafe_right", "shuffle_right", "sidestep_right", "right"], true),
    slash1: mk(["slash_1", "slash1", "slash", "attack", "melee"], false),
    slashStart: mk(["slash_start"], false),
    slashLoop: mk(["slash_loop"], true),
    slashEnd: mk(["slash_end"], false),
    hitFront: mk(["hit_forward", "get_hit_from_front", "hit_front"], false),
    hitBack: mk(["hit_backward", "get_hit_from_behind", "hit_back"], false),
    hitLeft: mk(["hit_left", "get_hit_from_left"], false),
    hitRight: mk(["hit_right", "get_hit_from_right"], false),
    death: mk(["death"], false),
    spawn: mk(["spawn"], false),
    roar: mk(["roar"], false),
    sneak: mk(["sneak"], true),
  };

  // Safety fallback: if key locomotion clips are missing but clips exist, use first clip.
  // This prevents "frozen statue" behavior on unusual FBX naming conventions.
  if (clips.length > 0) {
    const first = mixer.clipAction(clips[0]);
    first.enabled = true;
    first.setLoop(THREE.LoopRepeat, Infinity);
    if (!set.idle) set.idle = first;
    if (!set.walk) set.walk = first;
    if (!set.run) set.run = first;
  }

  return set;
}

/**
 * Per-player animation controller. Crossfades between locomotion / action
 * clips based on logical state from the server snapshot.
 */
export class AnimController {
  mixer: THREE.AnimationMixer;
  anims: AnimSet;
  current: THREE.AnimationAction | null = null;
  /** Cached locomotion direction-based action. */
  private lastLocomotionId = "";
  private lastState: ActionState | null = null;
  private lastCombo = -1;

  constructor(mixer: THREE.AnimationMixer, anims: AnimSet) {
    this.mixer = mixer;
    this.anims = anims;
    // Kick off idle by default
    if (anims.idle) {
      anims.idle.play();
      this.current = anims.idle;
    }
  }

  update(dt: number) {
    this.mixer.update(dt);
  }

  /**
   * Drive animation based on player state, movement vector (local-space),
   * and combo step. attackKind is needed for windup/active/recovery actions.
   */
  apply(opts: {
    state: ActionState;
    localMoveX: number;
    localMoveZ: number;
    speed: number;
    sprint: boolean;
    combo: number;
    attackKind: AttackKind;
  }) {
    const { state, localMoveX, localMoveZ, speed, sprint, combo, attackKind } = opts;

    // For action states, blend to specific clip
    switch (state) {
      case "dead":
        if (this.lastState !== "dead") this.fadeTo(this.anims.death, 0.15);
        this.lastState = state;
        return;
      case "attack_windup":
        if (this.lastState !== "attack_windup" || this.lastCombo !== combo) {
          const action = attackKind === "heavy" ? this.anims.slashStart ?? this.anims.slash1 : this.anims.slash1;
          this.fadeTo(action, 0.05, true);
        }
        break;
      case "attack_active":
        if (this.lastState !== "attack_active" || this.lastCombo !== combo) {
          const action = attackKind === "heavy" ? this.anims.slashLoop ?? this.anims.slash1 : this.anims.slash1;
          this.fadeTo(action, 0.04, attackKind === "heavy");
        }
        break;
      case "attack_recovery":
        if (this.lastState !== "attack_recovery" || this.lastCombo !== combo) {
          this.fadeTo(this.anims.slashEnd ?? this.anims.slash1, 0.08, false);
        }
        break;
      case "hit":
        if (this.lastState !== "hit") {
          const dirAction = pickHitDir(this.anims, localMoveX, localMoveZ);
          this.fadeTo(dirAction, 0.05, false);
        }
        break;
      case "stunned":
        if (this.lastState !== "stunned") this.fadeTo(this.anims.hitFront ?? this.anims.hitBack, 0.05, false);
        break;
      case "dodging":
        if (this.lastState !== "dodging") {
          // No dedicated dodge clip — reuse strafe for visual; could improve with custom anim
          const dir = pickStrafeDir(this.anims, localMoveX, localMoveZ);
          this.fadeTo(dir, 0.05, true);
        }
        break;
      case "blocking":
      case "parry_window": {
        // Use sneak/idle as block-stance approximation
        const action = this.anims.sneak ?? this.anims.idle;
        if (this.lastState !== "blocking" && this.lastState !== "parry_window") {
          this.fadeTo(action, 0.12, true);
        }
        break;
      }
      case "idle":
      case "moving": {
        // Locomotion blend
        const locoId = pickLocomotionId(localMoveX, localMoveZ, speed, sprint);
        if (locoId !== this.lastLocomotionId || (this.lastState !== "idle" && this.lastState !== "moving")) {
          const action = pickLocomotion(this.anims, locoId);
          this.fadeTo(action, 0.18, true);
          // Speed up walk if sprinting and using walk fallback
          if (action && locoId === "run_fallback") action.timeScale = 1.6;
          else if (action) action.timeScale = 1.0;
          this.lastLocomotionId = locoId;
        } else if (this.current && (locoId === "walk" || locoId === "run" || locoId === "run_fallback")) {
          // Adapt timeScale to actual speed for nicer foot-sliding
          const ref = locoId === "walk" ? 2.6 : 5.2;
          this.current.timeScale = Math.max(0.6, Math.min(1.6, speed / ref));
        }
        break;
      }
    }
    this.lastState = state;
    this.lastCombo = combo;
  }

  private fadeTo(action: THREE.AnimationAction | null, fade: number, restart = true) {
    if (!action) return;
    if (this.current === action) return;
    if (restart) {
      action.reset();
    }
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.fadeIn(fade);
    action.play();
    if (this.current && this.current !== action) {
      this.current.fadeOut(fade);
    }
    this.current = action;
  }
}

function pickLocomotionId(mx: number, mz: number, speed: number, sprint: boolean): string {
  if (speed < 0.1) return "idle";
  if (mz < -0.4) return "backpedal";
  if (Math.abs(mx) > 0.6 && Math.abs(mz) < 0.4) return mx > 0 ? "strafe_right" : "strafe_left";
  return sprint || speed > 4.0 ? "run" : "walk";
}

function pickLocomotion(a: AnimSet, id: string): THREE.AnimationAction | null {
  switch (id) {
    case "idle":
      return a.idle;
    case "walk":
      return a.walk ?? a.run;
    case "run":
      return a.run ?? a.walk;
    case "run_fallback":
      return a.walk;
    case "backpedal":
      return a.backpedal ?? a.walk;
    case "strafe_left":
      return a.strafeLeft ?? a.walk;
    case "strafe_right":
      return a.strafeRight ?? a.walk;
    default:
      return a.idle;
  }
}

function pickStrafeDir(a: AnimSet, mx: number, _mz: number): THREE.AnimationAction | null {
  if (mx > 0.3) return a.strafeRight ?? a.run;
  if (mx < -0.3) return a.strafeLeft ?? a.run;
  return a.run ?? a.walk;
}

function pickHitDir(a: AnimSet, mx: number, mz: number): THREE.AnimationAction | null {
  // Use last move dir as proxy for hit direction
  const ax = Math.abs(mx),
    az = Math.abs(mz);
  if (ax > az) {
    return mx > 0 ? a.hitRight ?? a.hitFront : a.hitLeft ?? a.hitFront;
  } else {
    return mz >= 0 ? a.hitFront : a.hitBack ?? a.hitFront;
  }
}
