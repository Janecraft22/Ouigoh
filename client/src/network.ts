import { io, type Socket } from "socket.io-client";
import {
  EV_HELLO,
  EV_INPUT,
  EV_SNAPSHOT,
  EV_WELCOME,
  type ClientInput,
  type HelloMessage,
  type ServerSnapshot,
  type WelcomeMessage,
} from "@ouigoh/shared";

export interface NetCallbacks {
  onWelcome(w: WelcomeMessage): void;
  onSnapshot(s: ServerSnapshot): void;
  onConnectChange(connected: boolean): void;
  onPing(rtt: number): void;
}

export class NetClient {
  socket: Socket | null = null;
  myId: string | null = null;
  /** Server time at last welcome — for time syncing. */
  serverTimeOffset = 0;
  rtt = 0;
  private cbs: NetCallbacks;
  private inputSeq = 0;
  private name: string;

  constructor(name: string, cbs: NetCallbacks) {
    this.name = name;
    this.cbs = cbs;
  }

  connect() {
    // Vite dev server proxies /socket.io to backend. In prod, same origin.
    this.socket = io({
      transports: ["websocket"],
      reconnection: true,
    });

    this.socket.on("connect", () => {
      this.cbs.onConnectChange(true);
      const hello: HelloMessage = { name: this.name };
      this.socket?.emit(EV_HELLO, hello);
    });

    this.socket.on("disconnect", () => {
      this.cbs.onConnectChange(false);
    });

    this.socket.on(EV_WELCOME, (w: WelcomeMessage) => {
      this.myId = w.id;
      this.serverTimeOffset = w.t - Date.now();
      this.cbs.onWelcome(w);
    });

    this.socket.on(EV_SNAPSHOT, (s: ServerSnapshot) => {
      this.cbs.onSnapshot(s);
    });

    // Track RTT via periodic ping
    setInterval(() => {
      if (!this.socket || !this.socket.connected) return;
      const t = Date.now();
      this.socket.timeout(2000).emit("ping2", () => {
        this.rtt = Date.now() - t;
        this.cbs.onPing(this.rtt);
      });
    }, 1500);
  }

  sendInput(input: Omit<ClientInput, "seq">) {
    if (!this.socket || !this.socket.connected) return;
    this.inputSeq++;
    const msg: ClientInput = { ...input, seq: this.inputSeq };
    this.socket.volatile.emit(EV_INPUT, msg);
  }
}
