import { Game } from "./game";
import { setLoading } from "./ui";

const menu = document.getElementById("menu") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const joinBtn = document.getElementById("joinBtn") as HTMLButtonElement;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

const savedName = localStorage.getItem("ouigoh.name");
if (savedName) nameInput.value = savedName;

let game: Game | null = null;

async function start() {
  joinBtn.disabled = true;
  const name = (nameInput.value || "anon").trim();
  localStorage.setItem("ouigoh.name", name);
  try {
    setLoading("Loading assets…");
    game = new Game(canvas, { name });
    await game.preload();
    setLoading("Connecting…");
    game.connect();
    setLoading("");
    menu.style.display = "none";
    hud.classList.remove("hidden");
    game.start();
    // Request pointer lock on first click after entering
    canvas.requestPointerLock();
  } catch (err) {
    setLoading(`Error: ${err instanceof Error ? err.message : String(err)}`);
    joinBtn.disabled = false;
  }
}

joinBtn.addEventListener("click", start);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") start();
});

// Re-request pointer lock on canvas click while in game
canvas.addEventListener("click", () => {
  if (game && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

window.addEventListener("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[ouigoh] error", e.error ?? e.message);
});
