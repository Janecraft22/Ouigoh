import {
  ACCELERATION,
  ARENA_RADIUS,
  BACK_SPEED_MULT,
  BTN_SPRINT,
  DEATH_RESPAWN_DELAY,
  FRICTION,
  HEAVY_ATTACK,
  HIT_STUN,
  LIGHT_ATTACK,
  MAX_HEALTH,
  MAX_PLAYERS_PER_ROOM,
  MAX_STAMINA,
  PLAYER_RADIUS,
  PRESS_HEAVY,
  PRESS_LIGHT,
  RUN_SPEED,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  STRAFE_SPEED_MULT,
  TICK_DT,
  WALK_SPEED,
  type ActionState,
  type AttackKind,
  type ClientInput,
  type GameEvent,
  type PlayerSnapshot,
  type ServerSnapshot,
} from "@ouigoh/shared";

interface AttackParams {
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  staminaCost: number;
  poiseDamage: number;
  range: number;
  arc: number;
  comboWindow: number;
}

const ATTACK_PARAMS: Record<AttackKind, AttackParams> = {
  light: LIGHT_ATTACK,
  heavy: HEAVY_ATTACK,
};

const SPRINT_STAMINA_DRAIN = 18; // stamina per second while sprinting

interface PendingAttack {
  kind: AttackKind;
  combo: number;
  timeInState: number;
  /** Players already hit during this active swing (avoid double-hits). */
  hitTargets: Set<string>;
}

export class ServerPlayer {
  id: string;
  name: string;
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  health = MAX_HEALTH;
  stamina = MAX_STAMINA;
  state: ActionState = "idle";
  combo = 0;
  hue: number;
  kills = 0;
  deaths = 0;

  /** Time spent in current state (s). */
  stateT = 0;
  /** Last input received from client. */
  input: ClientInput = { seq: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0, pressed: 0 };
  /** Whether sprint button is held. */
  sprint = false;
  /** Time since last stamina spend (for regen delay). */
  lastSpendT = 0;
  /** Combo timer — when in attack_recovery, time we'll accept next swing. */
  comboT = 0;
  /** Time remaining until respawn. */
  respawnT = 0;
  /** Currently executing attack (if in attack_* state). */
  attack: PendingAttack | null = null;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = (name || "player").slice(0, 16);
    this.hue = hashHue(id);
  }

  snapshot(): PlayerSnapshot {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      vx: this.vx,
      vz: this.vz,
      health: this.health,
      stamina: this.stamina,
      state: this.state,
      combo: this.combo,
      hue: this.hue,
      kills: this.kills,
      deaths: this.deaths,
    };
  }

  setState(s: ActionState) {
    this.state = s;
    this.stateT = 0;
  }
}

export class Room {
  id: string;
  players = new Map<string, ServerPlayer>();
  tick = 0;
  /** Pending events to broadcast in next snapshot. */
  events: GameEvent[] = [];
  /** Time in ms since epoch when the room started. */
  startMs = Date.now();

  constructor(id: string) {
    this.id = id;
  }

  hasSpace() {
    return this.players.size < MAX_PLAYERS_PER_ROOM;
  }

  addPlayer(id: string, name: string): ServerPlayer {
    const p = new ServerPlayer(id, name);
    this.spawn(p);
    this.players.set(id, p);
    this.events.push({ kind: "spawn", id, x: p.x, z: p.z });
    return p;
  }

  removePlayer(id: string) {
    this.players.delete(id);
  }

  spawn(p: ServerPlayer) {
    const angle = Math.random() * Math.PI * 2;
    const r = ARENA_RADIUS * 0.55 * Math.sqrt(Math.random());
    p.x = Math.cos(angle) * r;
    p.z = Math.sin(angle) * r;
    p.yaw = Math.atan2(-p.x, -p.z); // face center
    p.vx = 0;
    p.vz = 0;
    p.health = MAX_HEALTH;
    p.stamina = MAX_STAMINA;
    p.combo = 0;
    p.attack = null;
    p.setState("idle");
    p.respawnT = 0;
  }

  setInput(id: string, input: ClientInput) {
    const p = this.players.get(id);
    if (!p) return;
    // Only accept newer sequences
    if (input.seq < p.input.seq) return;
    // Edge-triggered "pressed" bits OR with previous so we don't lose them between ticks
    p.input = {
      ...input,
      pressed: input.pressed | p.input.pressed,
    };
  }

  step(dt: number): ServerSnapshot {
    this.tick++;
    for (const p of this.players.values()) {
      this.stepPlayer(p, dt);
    }
    // Hit resolution happens during stepPlayer (attack_active checks).
    // Build snapshot
    const snap: ServerSnapshot = {
      t: Date.now(),
      tick: this.tick,
      players: Array.from(this.players.values(), (p) => p.snapshot()),
      events: this.events,
    };
    this.events = [];
    // Clear pressed bits — they were consumed this tick
    for (const p of this.players.values()) {
      p.input = { ...p.input, pressed: 0 };
    }
    return snap;
  }

  private stepPlayer(p: ServerPlayer, dt: number) {
    p.stateT += dt;
    p.lastSpendT += dt;

    // Dead -> respawn
    if (p.state === "dead") {
      p.respawnT -= dt;
      if (p.respawnT <= 0) this.spawn(p);
      return;
    }

    // Process facing — always allow facing changes (mouselook)
    p.yaw = p.input.yaw;

    // Buttons
    p.sprint = (p.input.buttons & BTN_SPRINT) !== 0 && p.stamina > 0;

    // Edge actions (consume bits)
    const wantLight = (p.input.pressed & PRESS_LIGHT) !== 0;
    p.input.pressed &= ~(PRESS_LIGHT | PRESS_HEAVY);

    // Stamina regen logic
    let regen = STAMINA_REGEN;
    if (p.state === "attack_windup" || p.state === "attack_active") regen = 0;
    if (p.lastSpendT < STAMINA_REGEN_DELAY) regen = 0;
    if (p.stamina < MAX_STAMINA) p.stamina = Math.min(MAX_STAMINA, p.stamina + regen * dt);

    // Sprint drains stamina while moving; when empty, sprint automatically stops.
    const moveMag = Math.hypot(p.input.moveX, p.input.moveZ);
    if (p.sprint && moveMag > 0.05) {
      p.stamina = Math.max(0, p.stamina - SPRINT_STAMINA_DRAIN * dt);
      p.lastSpendT = 0;
      if (p.stamina <= 0) p.sprint = false;
    }

    // Per-state behavior
    switch (p.state) {
      case "idle":
      case "moving":
        // First try edge actions, then movement
        if (wantLight && this.tryAttack(p, "light", 0)) break;
        this.applyMovement(p, dt, 1);
        break;

      case "attack_windup": {
        if (!p.attack) {
          p.setState("idle");
          break;
        }
        // Slight forward drift during windup (slow)
        this.applyMovement(p, dt, 0.18);
        const params = ATTACK_PARAMS[p.attack.kind];
        if (p.stateT >= params.windup) {
          p.attack.timeInState = 0;
          p.setState("attack_active");
          this.events.push({ kind: "swing", id: p.id, kind2: p.attack.kind, combo: p.attack.combo });
        }
        break;
      }

      case "attack_active": {
        if (!p.attack) {
          p.setState("idle");
          break;
        }
        // Lunge forward during active
        this.applyMovement(p, dt, 0.35);
        // Resolve hits
        this.resolveAttackHits(p);
        const params = ATTACK_PARAMS[p.attack.kind];
        if (p.stateT >= params.active) {
          p.setState("attack_recovery");
          // Allow next combo step within window
          p.comboT = params.comboWindow;
        }
        break;
      }

      case "attack_recovery": {
        // Comboing: queued light attack chains if pressed during recovery
        p.comboT -= dt;
        if (p.attack && wantLight && p.comboT > 0 && p.attack.combo < 2 && p.stamina >= LIGHT_ATTACK.staminaCost) {
          this.tryAttack(p, "light", p.attack.combo + 1);
          break;
        }
        this.applyMovement(p, dt, 0.45);
        const params = p.attack ? ATTACK_PARAMS[p.attack.kind] : null;
        if (!params || p.stateT >= params.recovery) {
          p.attack = null;
          p.combo = 0;
          p.setState("idle");
        }
        break;
      }

      case "stunned":
        // No movement input; just decel
        this.decelerate(p, dt);
        if (p.stateT >= HIT_STUN * 1.5) p.setState("idle");
        break;

      case "hit":
        this.decelerate(p, dt);
        if (p.stateT >= HIT_STUN) p.setState("idle");
        break;

    }
  }

  private tryAttack(p: ServerPlayer, kind: AttackKind, combo: number): boolean {
    const params = ATTACK_PARAMS[kind];
    if (p.stamina < params.staminaCost) return false;
    p.stamina -= params.staminaCost;
    p.lastSpendT = 0;
    p.combo = combo;
    p.attack = { kind, combo, timeInState: 0, hitTargets: new Set() };
    p.setState("attack_windup");
    return true;
  }

  private applyMovement(p: ServerPlayer, dt: number, speedMult: number) {
    const mx = p.input.moveX;
    const mz = p.input.moveZ;
    const mag = Math.hypot(mx, mz);
    let targetSpeed = 0;
    if (mag > 0.05) {
      const baseSpeed = p.sprint ? RUN_SPEED : WALK_SPEED;
      // Strafing/backward penalties (mz < 0 means backwards in local space)
      let dirMult = 1;
      if (mz < -0.4) dirMult = BACK_SPEED_MULT;
      else if (Math.abs(mx) > 0.6 && Math.abs(mz) < 0.4) dirMult = STRAFE_SPEED_MULT;
      targetSpeed = baseSpeed * dirMult * speedMult;
    }

    // Compute world-space desired velocity
    const cy = Math.cos(p.yaw),
      sy = Math.sin(p.yaw);
    let desiredVx = 0,
      desiredVz = 0;
    if (mag > 0.05) {
      const nx = mx / mag;
      const nz = mz / mag;
      desiredVx = (nx * cy + nz * sy) * targetSpeed;
      desiredVz = (-nx * sy + nz * cy) * targetSpeed;
    }

    // Accel toward desired
    const accel = mag > 0.05 ? ACCELERATION : FRICTION;
    p.vx = approach(p.vx, desiredVx, accel * dt);
    p.vz = approach(p.vz, desiredVz, accel * dt);

    this.integrate(p, dt);
    if (mag > 0.05) {
      if (p.state === "idle") p.setState("moving");
    } else {
      if (p.state === "moving") p.setState("idle");
    }
  }

  private decelerate(p: ServerPlayer, dt: number) {
    p.vx = approach(p.vx, 0, FRICTION * dt);
    p.vz = approach(p.vz, 0, FRICTION * dt);
    this.integrate(p, dt);
  }

  private integrate(p: ServerPlayer, dt: number) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // Arena boundary — soft clamp
    const r = Math.hypot(p.x, p.z);
    const maxR = ARENA_RADIUS - PLAYER_RADIUS;
    if (r > maxR) {
      const s = maxR / r;
      p.x *= s;
      p.z *= s;
      // Reflect velocity along normal
      const nx = p.x / maxR;
      const nz = p.z / maxR;
      const vdotn = p.vx * nx + p.vz * nz;
      if (vdotn > 0) {
        p.vx -= nx * vdotn;
        p.vz -= nz * vdotn;
      }
    }
    // Resolve pairwise capsule overlap
    for (const other of this.players.values()) {
      if (other === p) continue;
      if (other.state === "dead") continue;
      const dx = p.x - other.x;
      const dz = p.z - other.z;
      const d = Math.hypot(dx, dz);
      const minD = PLAYER_RADIUS * 2;
      if (d > 0 && d < minD) {
        const push = (minD - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        p.x += nx * push;
        p.z += nz * push;
        other.x -= nx * push;
        other.z -= nz * push;
      }
    }
  }

  private resolveAttackHits(attacker: ServerPlayer) {
    if (!attacker.attack) return;
    const params = ATTACK_PARAMS[attacker.attack.kind];
    const halfArc = (params.arc * Math.PI) / 360; // degrees -> radians, then half
    const cy = Math.cos(attacker.yaw),
      sy = Math.sin(attacker.yaw);
    // Forward vector (local +Z forward) into world
    const fx = sy;
    const fz = cy;

    for (const target of this.players.values()) {
      if (target === attacker) continue;
      if (target.state === "dead") continue;
      if (attacker.attack.hitTargets.has(target.id)) continue;
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const d = Math.hypot(dx, dz);
      const reach = params.range + PLAYER_RADIUS;
      if (d > reach || d < 0.001) continue;
      const dot = (dx * fx + dz * fz) / d;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > halfArc) continue;

      // Hit confirmed
      attacker.attack.hitTargets.add(target.id);

      // Damage
      target.health -= params.damage;
      this.events.push({
        kind: "hit",
        attackerId: attacker.id,
        targetId: target.id,
        damage: params.damage,
        x: target.x,
        z: target.z,
        light: attacker.attack.kind === "light",
      });

      if (target.health <= 0) {
        target.health = 0;
        target.setState("dead");
        target.deaths++;
        attacker.kills++;
        target.respawnT = DEATH_RESPAWN_DELAY;
        this.events.push({ kind: "kill", attackerId: attacker.id, targetId: target.id });
      } else {
        // Stagger — relative direction for hit reaction
        target.setState("hit");
        target.vx = (dx / d) * 2.5;
        target.vz = (dz / d) * 2.5;
      }
    }
  }
}

function approach(cur: number, target: number, maxDelta: number) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

function hashHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h % 360) / 360;
}

export { ATTACK_PARAMS, TICK_DT };
