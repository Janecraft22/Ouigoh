/**
 * Shared protocol & game constants between Ouigoh server and client.
 * Server is authoritative — clients send inputs, receive state snapshots.
 */

// ---------- Tickrate / world ----------

/** Server simulation tick rate (Hz). */
export const TICK_RATE = 30;
/** Server tick delta in seconds. */
export const TICK_DT = 1 / TICK_RATE;
/** Snapshot broadcast rate (Hz). Equal to tick rate by default. */
export const SNAPSHOT_RATE = 20;
/** Max players per room. */
export const MAX_PLAYERS_PER_ROOM = 8;
/** Arena radius (meters); circular kill-zone outside. */
export const ARENA_RADIUS = 28;

// ---------- Movement ----------

/** Maximum walking speed (m/s). */
export const WALK_SPEED = 3.0;
/** Maximum running speed (m/s). */
export const RUN_SPEED = 5.6;
/** Backward speed multiplier vs forward. */
export const BACK_SPEED_MULT = 0.55;
/** Strafe speed multiplier vs forward. */
export const STRAFE_SPEED_MULT = 0.8;
/** Player capsule radius (m). */
export const PLAYER_RADIUS = 0.45;
/** Player capsule height (m). */
export const PLAYER_HEIGHT = 1.85;
/** Acceleration when changing direction (m/s^2). */
export const ACCELERATION = 28;
/** Friction when no input (m/s^2). */
export const FRICTION = 22;

// ---------- Combat ----------

export const MAX_HEALTH = 100;
export const MAX_STAMINA = 100;
/** Stamina regen per second when not blocking/attacking. */
export const STAMINA_REGEN = 22;
/** Stamina regen per second while blocking. */
export const STAMINA_REGEN_BLOCK = 6;
/** Delay (s) after spending stamina before regen resumes. */
export const STAMINA_REGEN_DELAY = 0.8;

export const LIGHT_ATTACK = {
  windup: 0.18,
  active: 0.10,
  recovery: 0.32,
  damage: 14,
  staminaCost: 14,
  poiseDamage: 18,
  range: 2.1,
  arc: 70, // degrees in front of player
  comboWindow: 0.45,
};

export const HEAVY_ATTACK = {
  windup: 0.42,
  active: 0.12,
  recovery: 0.55,
  damage: 32,
  staminaCost: 28,
  poiseDamage: 55,
  range: 2.4,
  arc: 95,
  comboWindow: 0,
};

export const BLOCK = {
  /** Stamina drained per damage point absorbed. */
  staminaPerDamage: 1.1,
  /** Damage multiplier when fully blocking. */
  damageMult: 0.15,
  /** Parry window (s) at the start of a block. */
  parryWindow: 0.18,
  /** Parry stun duration applied to attacker (s). */
  parryStun: 1.1,
  /** Movement multiplier while blocking. */
  moveMult: 0.45,
};

export const DODGE = {
  duration: 0.45,
  iFrameStart: 0.06,
  iFrameEnd: 0.32,
  distance: 4.0,
  staminaCost: 22,
  cooldown: 0.55,
};

export const HIT_STUN = 0.55;
export const DEATH_RESPAWN_DELAY = 3.0;

// ---------- Animations ----------
// We try to be lenient with the FBX clip names — see client/src/animations.ts
export const ANIM_NAMES = [
  "idle",
  "walk",
  "run",
  "backpedal",
  "strafe_left",
  "strafe_right",
  "shuffle_left",
  "shuffle_right",
  "slash_1",
  "slash_start",
  "slash_loop",
  "slash_end",
  "throw_knife",
  "roar",
  "spawn",
  "death",
  "hit_front",
  "hit_back",
  "hit_left",
  "hit_right",
  "sneak",
] as const;
export type AnimName = (typeof ANIM_NAMES)[number];

// ---------- Player state ----------

export type ActionState =
  | "idle"
  | "moving"
  | "attack_windup"
  | "attack_active"
  | "attack_recovery"
  | "blocking"
  | "parry_window"
  | "stunned"
  | "dodging"
  | "hit"
  | "dead";

export type AttackKind = "light" | "heavy";

export interface PlayerSnapshot {
  id: string;
  name: string;
  /** Position xz (y always 0 on flat arena). */
  x: number;
  z: number;
  /** Facing yaw in radians (rotation around world Y). */
  yaw: number;
  /** Current velocity (for client-side interp smoothing). */
  vx: number;
  vz: number;
  health: number;
  stamina: number;
  state: ActionState;
  /** Combo step (0,1,2) for current attack chain — used by client anim picker. */
  combo: number;
  /** Hue (0..1) for player tint, derived from name. */
  hue: number;
  /** Kills/deaths for scoreboard. */
  kills: number;
  deaths: number;
}

// ---------- Networking ----------

/** Client -> Server: input snapshot sent every frame. */
export interface ClientInput {
  /** Monotonically increasing input sequence number. */
  seq: number;
  /** Movement axes in player-local space, components in [-1, 1]. */
  moveX: number;
  moveZ: number;
  /** Desired facing yaw (radians). */
  yaw: number;
  /** Bitfield of held buttons. */
  buttons: number;
  /** Edge-triggered actions to consume this tick (bitfield). */
  pressed: number;
}

// Held button bits
export const BTN_BLOCK = 1 << 0;
export const BTN_SPRINT = 1 << 1;

// Pressed (edge) bits
export const PRESS_LIGHT = 1 << 0;
export const PRESS_HEAVY = 1 << 1;
export const PRESS_DODGE = 1 << 2;

/** Server -> Client snapshot containing all players for a tick. */
export interface ServerSnapshot {
  /** Server time in ms when this snapshot was produced. */
  t: number;
  /** Tick index. */
  tick: number;
  /** Per-player states. */
  players: PlayerSnapshot[];
  /** Visual/audio events triggered this tick (hits, parries, deaths, etc). */
  events: GameEvent[];
}

export type GameEvent =
  | { kind: "hit"; attackerId: string; targetId: string; damage: number; x: number; z: number; light: boolean }
  | { kind: "parry"; attackerId: string; defenderId: string; x: number; z: number }
  | { kind: "block"; attackerId: string; defenderId: string; x: number; z: number }
  | { kind: "kill"; attackerId: string; targetId: string }
  | { kind: "spawn"; id: string; x: number; z: number }
  | { kind: "swing"; id: string; kind2: AttackKind; combo: number };

// ---------- Lobby messages ----------

export interface HelloMessage {
  name: string;
}
export interface WelcomeMessage {
  id: string;
  /** Server time in ms when the welcome was sent. */
  t: number;
  arenaRadius: number;
  tickRate: number;
}

// Socket.IO event names
export const EV_HELLO = "hello";
export const EV_WELCOME = "welcome";
export const EV_INPUT = "input";
export const EV_SNAPSHOT = "snap";
export const EV_CHAT = "chat";
