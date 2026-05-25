# Ouigoh

Online multiplayer 3rd-person skill-based melee combat arena. Built with Three.js
(client) and a Node.js + Socket.IO authoritative server. No jumping, no shortcuts —
just timing, footwork and blade discipline.

> Ouigoh ("we-go") is a small arena duelling game. Pick a name, enter the arena,
> trade blows with whoever else is online.

## Features

- **Skill-based melee combat**
  - Light attacks chain into a 3-step combo (LMB)
  - Heavy attacks deal big damage with a slow windup (RMB)
  - Hold **Q** to block — opens a parry window in the first ~180 ms
  - **Space** to dodge roll with i-frames (~260 ms)
  - Stamina-gated everything; running out leaves you exposed
- **Authoritative server simulation** at 30 Hz
  - Server runs the entire combat state machine (hitboxes, parry, block, dodge i-frames, stagger, death)
  - Clients send inputs; server broadcasts snapshots — no client-side cheats
- **3D character with full animation set**
  - Uses the provided zombie murderer model & its animation library
  - Idle / walk / run / strafe / backpedal locomotion blending
  - Distinct slash, hit-reaction and death anims
- **Third-person orbit camera** with mouse look and pointer lock
- **Movement only** — no jump, deliberate ground combat
- **HUD**: HP & stamina bars, killfeed, scoreboard, death overlay
- **Atmospheric arena**: torch-lit boundary, fog, soft shadows, billboard nameplates

## Controls

| Action | Binding |
| --- | --- |
| Move | `WASD` |
| Look | Mouse (pointer lock) |
| Sprint | `Shift` |
| Light attack (combo) | LMB / `F` |
| Heavy attack | RMB / `R` |
| Block / parry | Hold `Q` |
| Dodge roll | `Space` |
| Release pointer | `Esc` |

## Project Structure

```
ouigoh/
├── shared/   # Protocol & gameplay constants shared by client and server
├── server/   # Node.js + Socket.IO authoritative simulation
└── client/   # Three.js + Vite browser client
```

## Develop

Requires Node.js 20+.

```bash
npm install
npm run dev      # runs server (3000) + Vite client (5173 with /socket.io proxy)
```

Then open <http://localhost:5173>.

## Production

```bash
npm run build
npm start        # runs Node server on PORT (default 3000), serving the built client
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Concurrent server + client dev with HMR & socket proxy |
| `npm run build` | Builds `shared`, `client`, `server` into `dist/` outputs |
| `npm start` | Runs the production server (serves built client + socket.io) |
| `npm run lint` | ESLint over the workspace |
| `npm run typecheck` | TypeScript noEmit across all packages |
| `npm run format` | Prettier write |

## Assets

The zombie character mesh + animations + textures live in
`client/public/assets/`. The diffuse / metalness / roughness PNGs are
downscaled-from-TGA versions of the originals shipped with the project.

## Design Notes

- The server is the source of truth. Clients send `ClientInput` (move axes,
  yaw, button bitfield + edge-triggered "pressed" bitfield). The server runs
  a fixed 30 Hz simulation in `server/src/room.ts` and broadcasts a
  `ServerSnapshot` of all players + events each tick.
- The remote player render is smoothed with exponential interpolation between
  snapshots. The local player's yaw is applied immediately on the client for
  responsive aiming; positions still come from server snapshots, so any
  client-side prediction error gets corrected on the next snapshot.
- Hits are resolved server-side during a player's `attack_active` state:
  a forward arc check vs other capsules, with parry / block / dodge i-frame
  resolution.
