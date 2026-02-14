/* global Module, localforage */
/**
 * Minimal DeSmuME-wasm wrapper with:
 * - ROM loaded from a URL (no file picker)
 * - Autosave to IndexedDB via localForage (+ export/import backup)
 * - Side-by-side top/bottom screens (fits window)
 *
 * IMPORTANT: If you embed this in Google Sites and saves don't persist,
 * the iframe may be blocking storage. Use "Export save" as a workaround or open directly.
 */

// ====== CONFIG ======
const ROM_URL = "https://files.catbox.moe/35lx11.nds"; // <- change this
const AUTO_SAVE_EVERY_FRAMES = 30; // ~0.5s at 60fps
// ====================

const $ = (id) => document.getElementById(id);

const topCanvas = $("top");
const bottomCanvas = $("bottom");
const ctxTop = topCanvas.getContext("2d", { alpha: false });
const ctxBottom = bottomCanvas.getContext("2d", { alpha: false });
ctxTop.imageSmoothingEnabled = false;
ctxBottom.imageSmoothingEnabled = false;

let FB = null;             // [ImageData, ImageData]
let ptrFrontBuffer = 0;    // returned by _getSymbol(5)
let audioBuffer = null;    // Int16Array view into wasm memory
let audioContext = null;
let audioWorkletNode = null;

let emuKeyState = new Array(15).fill(false);
const KEY = {
  right: 0, left: 1, down: 2, up: 3,
  select: 4, start: 5,
  b: 6, a: 7, y: 8, x: 9,
  l: 10, r: 11,
  debug: 12, lid: 13,
  mic: 14
};
const keyboardMap = new Map([
  ["ArrowRight", KEY.right],
  ["ArrowLeft", KEY.left],
  ["ArrowDown", KEY.down],
  ["ArrowUp", KEY.up],
  ["Shift", KEY.select],
  ["Enter", KEY.start],
  ["z", KEY.b],
  ["x", KEY.a],
  ["a", KEY.y],
  ["s", KEY.x],
  ["q", KEY.l],
  ["w", KEY.r],          // also sets MIC below
]);

let touched = 0;
let touchX = 0;
let touchY = 0;

let emuIsRunning = false;
let emuGameID = "unknown";
let prevSaveFlag = 0;
let frameCount = 0;

function setSaveStatus(text) {
  $("saveStatus").textContent = text;
}

function fmtMB(bytes){ return (bytes/(1024*1024)).toFixed(bytes < 10*1024*1024 ? 1 : 0) + " MB"; }
function fmtSpeed(bps){
  if (!isFinite(bps) || bps <= 0) return "—";
  const mbps = bps/(1024*1024);
  return mbps.toFixed(mbps < 10 ? 1 : 0) + " MB/s";
}
function fmtETA(sec){
  if (!isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return (m ? `${m}m ` : "") + `${s}s`;
}

async function fetchWithProgress(url, onProgress){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`ROM download failed: HTTP ${r.status}`);
  const total = Number(r.headers.get("content-length")) || 0;

  if (r.body && r.body.getReader) {
    const reader = r.body.getReader();
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(received, total);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
  }

  const buf = new Uint8Array(await r.arrayBuffer());
  onProgress(buf.byteLength, total || buf.byteLength);
  return buf;
}

function getGameIdFromRom(romU8) {
  // DS header game code at 0x0C..0x0F (ASCII). DS Player uses this too.
  if (!romU8 || romU8.length < 0x10) return "unknown";
  const c0 = romU8[0x0C];
  if (c0 === 35 /* '#' */) return "unknown";
  const code = String.fromCharCode(romU8[0x0C], romU8[0x0D], romU8[0x0E], romU8[0x0F]);
  // basic sanity
  if (!/^[A-Z0-9]{4}$/.test(code)) return "unknown";
  return code;
}

function resizeSideBySide() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const halfW = W / 2;
  const s = Math.min(halfW / 256, H / 192);

  topCanvas.style.transform = `translate(-50%, -50%) scale(${s})`;
  bottomCanvas.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener("resize", resizeSideBySide, { passive: true });
resizeSideBySide();

// ===== Storage helpers =====
async function storagePing() {
  try {
    await localforage.setItem("__ping__", 1);
    await localforage.removeItem("__ping__");
    return true;
  } catch {
    return false;
  }
}

async function loadSaveForGame(gameID) {
  try {
    const u8 = await localforage.getItem("sav-" + gameID);
    if (u8 && u8.byteLength) return new Uint8Array(u8);
  } catch {}
  return null;
}

async function storeSaveForGame(gameID, u8) {
  // u8 must be Uint8Array
  return localforage.setItem("sav-" + gameID, u8);
}

// Copy save bytes from emulator memory.
function emuCopySavBuffer() {
  const size = Module._savGetSize();
  if (size <= 0 || size > 2.5 * 1024 * 1024) return null;
  const ptr = Module._savGetPointer(0);
  return new Uint8Array(Module.HEAPU8.subarray(ptr, ptr + size));
}

async function checkSaveGame() {
  const saveUpdateFlag = Module._savUpdateChangeFlag();
  if (saveUpdateFlag === prevSaveFlag) return;
  prevSaveFlag = saveUpdateFlag;

  const u8 = emuCopySavBuffer();
  if (!u8) return;

  try {
    await storeSaveForGame(emuGameID, u8);
    setSaveStatus("Save: OK");
  } catch (e) {
    console.warn(e);
    setSaveStatus("Save: blocked");
  }
}

// ===== Audio =====
async function tryInitSound() {
  try {
    if (audioContext) {
      if (audioContext.state !== "running") await audioContext.resume();
      return;
    }
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 0.0001,
      sampleRate: 48000
    });

    if (!audioContext.audioWorklet) {
      console.warn("AudioWorklet not supported");
      return;
    }
    await audioContext.audioWorklet.addModule("js/audio-worklet.js");
    audioWorkletNode = new AudioWorkletNode(audioContext, "my-worklet", { outputChannelCount: [2] });
    audioWorkletNode.connect(audioContext.destination);
    await audioContext.resume();
  } catch (e) {
    console.warn(e);
  }
}

// ===== Input =====
window.addEventListener("keydown", (e) => {
  if (!emuIsRunning) return;
  // ESC toggles modal.
  if (e.key === "Escape") {
    toggleControls(true);
    e.preventDefault();
    return;
  }

  const key = keyboardMap.get(e.key.toLowerCase?.() ?? e.key);
  if (key !== undefined) {
    emuKeyState[key] = true;
    // W also simulates mic blowing.
    if (key === KEY.r) emuKeyState[KEY.mic] = true;
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener("keyup", (e) => {
  if (!emuIsRunning) return;
  const key = keyboardMap.get(e.key.toLowerCase?.() ?? e.key);
  if (key !== undefined) {
    emuKeyState[key] = false;
    if (key === KEY.r) emuKeyState[KEY.mic] = false;
    e.preventDefault();
  }
}, { passive: false });

// Mouse/touch for bottom screen
function updateTouchFromPointer(clientX, clientY, isDown) {
  const r = bottomCanvas.getBoundingClientRect();
  const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  touched = (isDown && inside) ? 1 : 0;
  if (inside) {
    touchX = (clientX - r.left) / r.width * 256;
    touchY = (clientY - r.top) / r.height * 192;
  }
}
window.addEventListener("mousedown", (e) => {
  if (!emuIsRunning) return;
  tryInitSound();
  updateTouchFromPointer(e.clientX, e.clientY, true);
}, { passive: false });
window.addEventListener("mousemove", (e) => {
  if (!emuIsRunning) return;
  updateTouchFromPointer(e.clientX, e.clientY, (e.buttons !== 0));
}, { passive: false });
window.addEventListener("mouseup", (e) => {
  if (!emuIsRunning) return;
  updateTouchFromPointer(e.clientX, e.clientY, false);
}, { passive: false });

// ===== Video + frame loop =====
function emuRunFrame() {
  let keyMask = 0;
  for (let i = 0; i < 14; i++) if (emuKeyState[i]) keyMask |= (1 << i);
  if (emuKeyState[KEY.mic]) keyMask |= (1 << KEY.mic);

  // Run emulator
  Module._runFrame(1, keyMask, touched, touchX, touchY);

  // Present frames
  ctxTop.putImageData(FB[0], 0, 0);
  ctxBottom.putImageData(FB[1], 0, 0);

  // Audio
  if (audioWorkletNode && audioBuffer) {
    try {
      const samplesRead = Module._fillAudioBuffer(4096);
      // Copy the slice because postMessage detaches in some browsers
      const tmp = new Int16Array(samplesRead * 2);
      tmp.set(audioBuffer.subarray(0, samplesRead * 2));
      audioWorkletNode.port.postMessage(tmp);
    } catch (e) {
      // ignore
    }
  }

  frameCount++;
  if (frameCount % AUTO_SAVE_EVERY_FRAMES === 0) checkSaveGame();
}

let prevRunFrameTime = performance.now();
function emuLoop() {
  requestAnimationFrame(emuLoop);
  if (!emuIsRunning) return;

  // crude pacing
  const now = performance.now();
  if (now - prevRunFrameTime < 15) return;
  prevRunFrameTime = now;

  emuRunFrame();
}
emuLoop();

// ===== Load ROM + boot emulator =====
async function loadRomAndStart() {
  $("loaderTitle").textContent = "Loading ROM";
  $("sub").textContent = "Downloading game data…";

  // progress bar
  let lastT = performance.now(), lastB = 0, ema = 0;
  const bar = $("bar");
  const pct = $("pct");
  const dl = $("dl");
  const eta = $("eta");

  const romU8 = await fetchWithProgress(ROM_URL, (received, total) => {
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    if (dt >= 0.25) {
      const db = received - lastB;
      const inst = db / dt;
      ema = ema ? (ema * 0.75 + inst * 0.25) : inst;
      lastT = now; lastB = received;
    }
    const p = total ? Math.min(1, received / total) : 0;
    bar.style.width = total ? (p*100).toFixed(1) + "%" : "18%";
    pct.textContent = total ? Math.floor(p*100) + "%" : "…";
    dl.textContent = total ? `${fmtMB(received)} / ${fmtMB(total)}` : fmtMB(received);
    const e = (total && ema > 0) ? (total - received) / ema : NaN;
    eta.textContent = `${fmtSpeed(ema)} • ETA ${fmtETA(e)}`;
  });

  $("sub").textContent = "Initializing emulator…";

  emuGameID = getGameIdFromRom(romU8);
  if (emuGameID === "unknown") {
    // make it stable per ROM URL if no header code
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ROM_URL));
    const hex = Array.from(new Uint8Array(h)).slice(0, 6).map(b => b.toString(16).padStart(2,"0")).join("");
    emuGameID = "rom-" + hex;
  }

  // Storage availability check
  const ok = await storagePing();
  setSaveStatus(ok ? "Save: ready" : "Save: blocked");

  // Allocate ROM buffer and copy
  const romSize = romU8.byteLength;
  const romBufPtr = Module._prepareRomBuffer(romSize);
  Module.HEAPU8.set(romU8, romBufPtr);

  // Restore save (if present)
  const saveData = await loadSaveForGame(emuGameID);
  if (saveData && saveData.byteLength > 0) {
    Module.HEAPU8.set(saveData, Module._savGetPointer(saveData.length));
  }
  Module._savUpdateChangeFlag();

  const ret = Module._loadROM(romSize);
  if (ret !== 1) throw new Error("Failed to load ROM in emulator.");

  // Setup framebuffers
  ptrFrontBuffer = Module._getSymbol(5);
  const fb = Module._getSymbol(4);
  const fbU8 = Module.HEAPU8.subarray(fb, fb + 256 * 192 * 4 * 2);
  FB = [
    new ImageData(new Uint8ClampedArray(fbU8.buffer, fbU8.byteOffset, 256 * 192 * 4), 256, 192),
    new ImageData(new Uint8ClampedArray(fbU8.buffer, fbU8.byteOffset + 256 * 192 * 4, 256 * 192 * 4), 256, 192)
  ];

  // Audio buffer view
  const ptrAudio = Module._getSymbol(6);
  audioBuffer = Module.HEAP16.subarray(ptrAudio >> 1, (ptrAudio >> 1) + 8192);

  // Hide loader + start
  $("loader").style.display = "none";
  emuIsRunning = true;

  // Kick audio on user gesture, but try init anyway
  tryInitSound();
}

// ===== Modal + HUD actions =====
const modalBack = $("modalBack");
function toggleControls(show) { modalBack.style.display = show ? "block" : "none"; }
$("btnControls").onclick = () => toggleControls(true);
$("btnClose").onclick = () => toggleControls(false);
modalBack.addEventListener("click", (e) => { if (e.target === modalBack) toggleControls(false); });

$("btnSaveNow").onclick = async () => {
  if (!emuIsRunning) return;
  await checkSaveGame();
};

$("btnExport").onclick = async () => {
  if (!emuIsRunning) return;
  await checkSaveGame();
  const u8 = await loadSaveForGame(emuGameID);
  if (!u8) return alert("No save data found yet. Save in-game first.");
  const blob = new Blob([u8], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sav-${emuGameID}.dsv`;
  a.click();
};

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".dsv")) {
    alert("Only .dsv save files are supported.");
    e.target.value = "";
    return;
  }
  const u8 = new Uint8Array(await file.arrayBuffer());
  try {
    await storeSaveForGame(emuGameID, u8);
    alert("Save imported. Reloading…");
    location.reload();
  } catch (err) {
    console.warn(err);
    alert("Import failed (storage blocked?). Use a different browser or open the page directly.");
  }
});

// Flush on close if possible
window.addEventListener("beforeunload", () => {
  try { if (emuIsRunning) { Module._savUpdateChangeFlag(); } } catch {}
});

// ===== Boot sequence =====
(async function boot() {
  try {
    // Wait for localforage shim to finish (if it needs to fetch the real library).
    for (let i = 0; i < 200; i++) {
      if (window.localforage) break;
      await new Promise(r => setTimeout(r, 25));
    }
    if (!window.localforage) throw new Error("localforage failed to load.");

    // Set the runtime init hook BEFORE loading the core.
    Module.onRuntimeInitialized = async () => {
      try {
        Module._setSampleRate(47860);
        await loadRomAndStart();
      } catch (err) {
        console.error(err);
        $("sub").textContent = "Error starting emulator: " + (err?.message || err);
      }
    };

    // Now load the emulator core (nds.js + nds.wasm).
    $("loaderTitle").textContent = "Loading emulator";
    $("sub").textContent = "Downloading emulator core…";
    await window.loadEmuCore();

    // If the core finished init before our hook (rare), start anyway.
    if (Module._getSymbol && !emuIsRunning) {
      // Give Emscripten a tick; onRuntimeInitialized will usually fire.
      setTimeout(() => { if (!emuIsRunning) loadRomAndStart().catch(console.error); }, 50);
    }
  } catch (err) {
    console.error(err);
    $("sub").textContent = "Startup failed: " + (err?.message || err);
  }
})();