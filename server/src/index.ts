import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as SocketIOServer, type Socket } from "socket.io";
import {
  EV_HELLO,
  EV_INPUT,
  EV_SNAPSHOT,
  EV_WELCOME,
  TICK_DT,
  TICK_RATE,
  ARENA_RADIUS,
  type ClientInput,
  type HelloMessage,
  type WelcomeMessage,
} from "@ouigoh/shared";
import { Room } from "./room.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
// In production (compiled), serve the client build from ../../client/dist
// In dev (tsx), the client is served by Vite — this static path simply doesn't exist yet.
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, t: Date.now() });
});
app.use(express.static(CLIENT_DIST));
// SPA fallback for direct navigation
app.get(/^\/(?!socket\.io|healthz).*/, (_req, res, next) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) next();
  });
});

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: true },
  pingInterval: 5000,
  pingTimeout: 10000,
});

// Single-room MVP (room "arena"). Easy to extend to multi-room matchmaking later.
const room = new Room("arena");

io.on("connection", (socket: Socket) => {
  let joined = false;

  socket.on(EV_HELLO, (msg: HelloMessage) => {
    if (joined) return;
    if (!room.hasSpace()) {
      socket.emit("error", { reason: "room_full" });
      socket.disconnect(true);
      return;
    }
    const name = sanitizeName(msg?.name);
    room.addPlayer(socket.id, name);
    joined = true;
    const welcome: WelcomeMessage = {
      id: socket.id,
      t: Date.now(),
      arenaRadius: ARENA_RADIUS,
      tickRate: TICK_RATE,
    };
    socket.emit(EV_WELCOME, welcome);
  });

  socket.on(EV_INPUT, (input: ClientInput) => {
    if (!joined) return;
    room.setInput(socket.id, input);
  });

  socket.on("ping2", (cb: () => void) => {
    if (typeof cb === "function") cb();
  });

  socket.on("disconnect", () => {
    if (joined) room.removePlayer(socket.id);
  });
});

// Authoritative tick loop
let acc = 0;
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  acc += (now - last) / 1000;
  last = now;
  while (acc >= TICK_DT) {
    acc -= TICK_DT;
    const snap = room.step(TICK_DT);
    io.emit(EV_SNAPSHOT, snap);
  }
}, Math.max(4, 1000 / TICK_RATE / 2));

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[ouigoh] server listening on http://localhost:${PORT}`);
});

function sanitizeName(raw: string | undefined): string {
  if (!raw) return "anon";
  return raw.replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 16) || "anon";
}
