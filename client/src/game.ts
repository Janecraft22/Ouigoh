import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  ARENA_RADIUS,
  EV_HELLO,
  MAX_HEALTH,
  MAX_STAMINA,
  type ClientInput,
  type GameEvent,
  type PlayerSnapshot,
  type ServerSnapshot,
  type WelcomeMessage,
} from "@ouigoh/shared";
import { ThirdPersonCamera } from "./camera";
import { InputController } from "./input";
import { NetClient } from "./network";
import { PlayerView } from "./playerView";
import { buildArena } from "./arena";
import { addKillFeed, setConnection, setDeathOverlay, updateBars, updateScoreboard } from "./ui";

interface GameOpts {
  name: string;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private opts: GameOpts;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: ThirdPersonCamera;
  private clock = new THREE.Clock();
  private input!: InputController;
  private net!: NetClient;

  private sourceModel: THREE.Group | null = null;
  private sourceClips: THREE.AnimationClip[] = [];

  private players = new Map<string, PlayerView>();
  private myId: string | null = null;

  /** Last input sent — to throttle network rate. */
  private inputSendT = 0;
  private inputRateHz = 30;

  /** Active hit-flash & VFX nodes to clean up. */
  private vfxNodes: { obj: THREE.Object3D; until: number }[] = [];

  constructor(canvas: HTMLCanvasElement, opts: GameOpts) {
    this.canvas = canvas;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new ThirdPersonCamera();

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Load 3D assets (zombie model, textures, animations). */
  async preload() {
    buildArena(this.scene, ARENA_RADIUS);

    const loader = new FBXLoader();
    const fbx: THREE.Group = await new Promise((resolve, reject) => {
      loader.load(
        "/assets/models/zombie.fbx",
        (g) => resolve(g),
        (e) => {
          // eslint-disable-next-line no-console
          if (e.loaded && e.total) console.log(`[ouigoh] model ${Math.round((e.loaded / e.total) * 100)}%`);
        },
        (err) => reject(err),
      );
    });

    // FBXLoader returns the model with animations baked into `.animations`
    this.sourceClips = fbx.animations.slice();
    // eslint-disable-next-line no-console
    console.log(
      "[ouigoh] FBX loaded:",
      this.sourceClips.length,
      "clips:",
      this.sourceClips.map((c) => c.name).join(", "),
    );

    // Scale: the model is in Unity-ish meters but raw FBX often is centimeters.
    // The base mesh height we expect is ~1.85m. Sample bounding box and rescale.
    const bbox = new THREE.Box3().setFromObject(fbx);
    const size = bbox.getSize(new THREE.Vector3());
    const desiredHeight = 1.85;
    let scale = 1;
    if (size.y > 5) scale = desiredHeight / size.y; // probably cm
    else if (size.y < 0.5) scale = desiredHeight / size.y;
    else scale = desiredHeight / size.y;
    fbx.scale.setScalar(scale);

    // Apply PBR-ish material to skinned meshes using our PNG textures.
    const texLoader = new THREE.TextureLoader();
    const [diffuse, metalness, roughness] = await Promise.all([
      texLoader.loadAsync("/assets/textures/zombie_diffuse.png"),
      texLoader.loadAsync("/assets/textures/zombie_metalness.png"),
      texLoader.loadAsync("/assets/textures/zombie_roughness.png"),
    ]);
    diffuse.colorSpace = THREE.SRGBColorSpace;
    diffuse.anisotropy = 8;
    diffuse.flipY = false;
    metalness.flipY = false;
    roughness.flipY = false;
    metalness.colorSpace = THREE.NoColorSpace;
    roughness.colorSpace = THREE.NoColorSpace;

    fbx.traverse((obj) => {
      const m = obj as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        const mat = new THREE.MeshStandardMaterial({
          map: diffuse,
          metalnessMap: metalness,
          roughnessMap: roughness,
          metalness: 1.0,
          roughness: 1.0,
        });
        m.material = mat;
        m.frustumCulled = false;
      }
    });

    // Hide source model — only used as a template for cloning
    fbx.visible = false;
    fbx.position.set(0, -1000, 0);
    this.scene.add(fbx);
    this.sourceModel = fbx;
  }

  connect() {
    this.net = new NetClient(this.opts.name, {
      onWelcome: (w: WelcomeMessage) => {
        this.myId = w.id;
        setConnection("ok", `connected • ${w.tickRate}Hz`);
      },
      onSnapshot: (s: ServerSnapshot) => {
        this.applySnapshot(s);
      },
      onConnectChange: (c) => {
        setConnection(c ? "ok" : "bad", c ? "connected" : "disconnected");
      },
      onPing: (rtt) => {
        setConnection("ok", `ping ${rtt}ms`);
      },
    });
    this.net.connect();
    // Workaround for stale TS: ensure EV_HELLO is referenced (sent inside NetClient.connect)
    void EV_HELLO;
  }

  start() {
    this.input = new InputController(this.canvas);
    this.animate();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.resize(w, h);
  }

  private animate = () => {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.tick(dt);
    requestAnimationFrame(this.animate);
  };

  private tick(dt: number) {
    // Send input at fixed Hz
    this.inputSendT += dt;
    const interval = 1 / this.inputRateHz;
    if (this.inputSendT >= interval && this.net) {
      this.inputSendT = 0;
      const i = this.input.state;
      const msg: Omit<ClientInput, "seq"> = {
        moveX: i.moveX,
        moveZ: i.moveZ,
        yaw: i.yaw,
        buttons: i.buttons,
        pressed: this.input.consumePressed(),
      };
      this.net.sendInput(msg);
    }

    // Local player view follows server snapshot, but we drive its yaw for instant feel
    const me = this.myId ? this.players.get(this.myId) : null;
    if (me) {
      // Apply mouse yaw to local view immediately
      me.targetYaw = this.input.state.yaw;
    }

    // Update player views
    for (const view of this.players.values()) {
      view.update(dt, view.id === this.myId);
      // Billboard label + health bar to camera
      const camPos = this.camera.cam.position;
      view.label.lookAt(camPos);
      view.healthBar.lookAt(camPos);
      view.healthBarBg.lookAt(camPos);
    }

    // Camera follow
    if (me) {
      this.camera.update(me.smoothX, me.smoothZ, this.input.state.yaw, this.input.state.pitch, dt);
    } else {
      // Spectator orbit before joining
      const t = performance.now() / 4000;
      this.camera.update(0, 0, t, 0.3, dt);
    }

    // Update HUD bars from latest snapshot for local player
    if (me) {
      updateBars(me.last.health, me.last.stamina, MAX_HEALTH, MAX_STAMINA);
      setDeathOverlay(me.last.state === "dead");
    }

    // Decay VFX
    const now = performance.now();
    for (const v of this.vfxNodes) {
      if (now > v.until) {
        v.obj.removeFromParent();
      }
    }
    this.vfxNodes = this.vfxNodes.filter((v) => now <= v.until);

    this.renderer.render(this.scene, this.camera.cam);
  }

  private applySnapshot(s: ServerSnapshot) {
    // Track which ids appeared
    const seen = new Set<string>();
    for (const ps of s.players) {
      seen.add(ps.id);
      let view = this.players.get(ps.id);
      if (!view) {
        if (!this.sourceModel) continue;
        view = new PlayerView(ps, this.sourceModel, this.sourceClips);
        this.players.set(ps.id, view);
        this.scene.add(view.group);
      }
      // Decide attack kind from state transitions (when going into windup with new combo)
      if (ps.state === "attack_windup" && view.last.state !== "attack_windup") {
        // We don't have explicit "kind" in snapshot; infer: combo=0 with longer windup = heavy
        // For simplicity, use server "swing" event to set kind (handled below). Default light.
        view.lastAttackKind = view.lastAttackKind || "light";
      }
      view.applySnapshot(ps);
    }
    // Remove views for players that left
    for (const [id, view] of this.players) {
      if (!seen.has(id)) {
        view.dispose();
        this.players.delete(id);
      }
    }
    // Process events
    for (const ev of s.events) {
      this.handleEvent(ev, s.players);
    }
  }

  private handleEvent(ev: GameEvent, players: PlayerSnapshot[]) {
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id.slice(0, 4);
    switch (ev.kind) {
      case "hit":
        this.spawnHitSpark(ev.x, ev.z, 0xff4040);
        if (ev.targetId === this.myId) this.cameraShake(0.18);
        break;
      case "block":
        this.spawnHitSpark(ev.x, ev.z, 0xffd060);
        break;
      case "parry":
        this.spawnHitSpark(ev.x, ev.z, 0x6cf3a8, 1.4);
        addKillFeed(`${nameOf(ev.defenderId)} parried ${nameOf(ev.attackerId)}!`);
        break;
      case "kill":
        addKillFeed(`${nameOf(ev.attackerId)} killed ${nameOf(ev.targetId)}`);
        break;
      case "spawn":
        // small flash at spawn position
        this.spawnHitSpark(ev.x, ev.z, 0x88c0ff, 0.7);
        break;
      case "swing": {
        const view = this.players.get(ev.id);
        if (view) view.lastAttackKind = ev.kind2;
        break;
      }
    }
    // Scoreboard update
    if (this.myId) updateScoreboard(players, this.myId);
  }

  private spawnHitSpark(x: number, z: number, color: number, scale = 1) {
    const geom = new THREE.SphereGeometry(0.18 * scale, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, 1.1, z);
    this.scene.add(m);
    const until = performance.now() + 220;
    this.vfxNodes.push({ obj: m, until });
    // Quick fade — animate via tick decay
    const startTime = performance.now();
    const startScale = m.scale.x;
    const interval = setInterval(() => {
      const t = (performance.now() - startTime) / 220;
      if (t >= 1) {
        clearInterval(interval);
        return;
      }
      m.scale.setScalar(startScale * (1 + t * 2.4));
      mat.opacity = 0.95 * (1 - t);
    }, 16);
  }

  private cameraShake(strength: number) {
    const origin = this.camera.cam.position.clone();
    const start = performance.now();
    const duration = 220;
    const shake = () => {
      const t = (performance.now() - start) / duration;
      if (t >= 1) {
        return;
      }
      const k = 1 - t;
      this.camera.cam.position.set(
        origin.x + (Math.random() - 0.5) * strength * k,
        origin.y + (Math.random() - 0.5) * strength * k,
        origin.z + (Math.random() - 0.5) * strength * k,
      );
      requestAnimationFrame(shake);
    };
    shake();
  }
}
