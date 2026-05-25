import type { PlayerSnapshot } from "@ouigoh/shared";

export function setLoading(msg: string) {
  const el = document.getElementById("loading");
  if (el) el.textContent = msg;
}

export function setConnection(state: "connecting" | "ok" | "bad", detail?: string) {
  const el = document.getElementById("connectionStatus");
  if (!el) return;
  el.classList.remove("ok", "bad");
  if (state === "ok") el.classList.add("ok");
  if (state === "bad") el.classList.add("bad");
  el.textContent = detail ?? state;
}

export function updateBars(health: number, stamina: number, maxHealth: number, maxStamina: number) {
  const h = document.querySelector<HTMLDivElement>("#health .fill");
  const hl = document.querySelector<HTMLDivElement>("#health .label");
  const s = document.querySelector<HTMLDivElement>("#stamina .fill");
  const sl = document.querySelector<HTMLDivElement>("#stamina .label");
  if (h && hl) {
    const pct = Math.max(0, Math.min(100, (health / maxHealth) * 100));
    h.style.width = `${pct}%`;
    hl.textContent = `HP ${Math.round(health)}`;
  }
  if (s && sl) {
    const pct = Math.max(0, Math.min(100, (stamina / maxStamina) * 100));
    s.style.width = `${pct}%`;
    sl.textContent = `STAM ${Math.round(stamina)}`;
  }
}

export function updateScoreboard(players: PlayerSnapshot[], myId: string) {
  const body = document.getElementById("scoreboardBody");
  if (!body) return;
  const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const rows: string[] = [];
  for (const p of sorted) {
    const me = p.id === myId ? "me" : "";
    rows.push(
      `<tr class="${me}"><td>${escapeHTML(p.name)}</td><td class="k">${p.kills}</td><td class="d">${p.deaths}</td></tr>`,
    );
  }
  body.innerHTML = rows.join("");
}

const killfeedQueue: HTMLDivElement[] = [];
export function addKillFeed(text: string) {
  const feed = document.getElementById("killfeed");
  if (!feed) return;
  const item = document.createElement("div");
  item.className = "item";
  item.textContent = text;
  feed.prepend(item);
  killfeedQueue.push(item);
  setTimeout(() => {
    item.remove();
  }, 5200);
  while (killfeedQueue.length > 5) {
    const old = killfeedQueue.shift();
    old?.remove();
  }
}

export function setDeathOverlay(show: boolean) {
  const el = document.getElementById("deathOverlay");
  if (!el) return;
  if (show) el.classList.add("show");
  else el.classList.remove("show");
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
