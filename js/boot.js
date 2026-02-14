// boot.js — ROM loader, responsive layout, virtual gamepad, save management
(() => {
  "use strict";

  // ═══════════════ CONFIG ═══════════════
  const DEFAULT_ROM_URL = "https://files.catbox.moe/35lx11.nds";
  // ══════════════════════════════════════

  const $ = (id) => document.getElementById(id);
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);

  // ── Override desmond's showMsg ──
  let _toastTimer = 0;
  window.showMsg = (msg) => {
    const t = $("tagSave");
    if (!t) return;
    t.textContent = msg;
    t.className = "tag ok";
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => updateSaveTag(), 2000);
  };

  // ── Modal ──
  function openModal(panel) {
    $("overlay").classList.add("open");
    $("modalTitle").textContent = panel === "controls" ? "Controls" : "Saves";
    $("panelControls").style.display = panel === "controls" ? "" : "none";
    $("panelSaves").style.display = panel === "saves" ? "" : "none";
    if (panel === "saves") refreshSaveStatus();
  }
  function closeModal() { $("overlay").classList.remove("open"); }

  $("btnControls").onclick = () => openModal("controls");
  $("btnSaves").onclick = () => openModal("saves");
  $("btnClose").onclick = closeModal;
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("overlay").classList.contains("open")) {
      e.stopPropagation(); closeModal();
    }
  });

  // ── Formatting ──
  const fmtMB = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB";

  // ── ROM cache ──
  function romCache() {
    if (!window.localforage) return null;
    return window.localforage.createInstance({ name: "nds_player", storeName: "rom_cache" });
  }

  // ── Streaming download ──
  async function fetchROM(url, onProgress) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const total = Number(r.headers.get("content-length")) || 0;

    if (r.body?.getReader) {
      const reader = r.body.getReader();
      const chunks = [];
      let received = 0;
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
    // Fallback for browsers without ReadableStream
    const buf = new Uint8Array(await r.arrayBuffer());
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  // ═══════════════════════════════════════
  // RESPONSIVE SCREEN LAYOUT
  // ═══════════════════════════════════════
  let screenTop = null, screenBot = null;
  let layoutMode = "none"; // "side-by-side" | "stacked"

  function applyLayout(player) {
    const setup = () => {
      const sr = player.shadowRoot;
      if (!sr) return false;
      const cvs = sr.querySelectorAll("canvas");
      if (cvs.length < 2) return false;
      screenTop = cvs[0];
      screenBot = cvs[1];

      const base = "position:fixed;image-rendering:pixelated;z-index:1;transform-origin:50% 50%;";
      screenTop.style.cssText = base;
      screenBot.style.cssText = base;

      resize();
      return true;
    };

    if (setup()) return;
    const iv = setInterval(() => { if (setup()) clearInterval(iv); }, 80);
    setTimeout(() => clearInterval(iv), 8000);
  }

  function resize() {
    if (!screenTop || !screenBot) return;

    const W = innerWidth;
    const H = innerHeight;
    const gpH = isTouch ? getGamepadHeight() : 0;
    const hudH = 40;
    const availH = H - gpH;
    const portrait = W < 640 && W < H;

    if (portrait) {
      // Stacked: top screen above, bottom screen below
      layoutMode = "stacked";
      const gap = 4;
      const halfH = (availH - hudH - gap) / 2;
      const s = Math.min(W / 256, halfH / 192);
      const totalScreenH = s * 192 * 2 + gap;
      const topY = hudH + (availH - hudH - totalScreenH) / 2 + s * 192 / 2;
      const botY = topY + s * 192 + gap;

      screenTop.style.left = W / 2 + "px";
      screenTop.style.top = topY + "px";
      screenTop.style.transform = `translate(-50%,-50%) scale(${s})`;

      screenBot.style.left = W / 2 + "px";
      screenBot.style.top = botY + "px";
      screenBot.style.transform = `translate(-50%,-50%) scale(${s})`;
    } else {
      // Side-by-side
      layoutMode = "side-by-side";
      const half = W / 2;
      const s = Math.min(half / 256, availH / 192);
      const cy = (availH) / 2;

      screenTop.style.left = half * 0.5 + "px";
      screenTop.style.top = cy + "px";
      screenTop.style.transform = `translate(-50%,-50%) scale(${s})`;

      screenBot.style.left = half * 1.5 + "px";
      screenBot.style.top = cy + "px";
      screenBot.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
  }

  function getGamepadHeight() {
    const gp = $("gamepad");
    if (!gp || !gp.classList.contains("active")) return 0;
    return gp.offsetHeight || 200;
  }

  addEventListener("resize", () => { resize(); }, { passive: true });

  // ═══════════════════════════════════════
  // VIRTUAL GAMEPAD (touch controls)
  // ═══════════════════════════════════════
  //
  // emuKeyState indices:
  //   0:right 1:left 2:down 3:up 4:select 5:start
  //   6:b 7:a 8:y 9:x 10:l 11:r
  //
  // Screen touch: touched, touchX, touchY (globals from desmond)

  let soundInited = false;
  function ensureSound() {
    if (soundInited) return;
    if (typeof tryInitSound === "function") {
      try { tryInitSound(); soundInited = true; } catch (e) { console.warn("sound:", e); }
    }
  }

  function initGamepad() {
    if (!isTouch) return;
    const gp = $("gamepad");
    gp.classList.add("active");

    // After showing gamepad, recalc layout
    requestAnimationFrame(() => resize());

    // ── Track active touches ──
    const activeTouches = new Map(); // touchId -> { type, data }

    function handleTouchEvent(e) {
      // Don't interfere with modal or HUD buttons
      if ($("overlay").classList.contains("open")) return;
      if (e.target.closest(".hud")) return;
      if (e.target.closest("#unmute")) return;

      ensureSound();

      if (typeof emuIsRunning !== "undefined" && !emuIsRunning) return;

      e.preventDefault();

      // Process all current touches
      const gpButtons = new Set(); // button indices pressed by gamepad
      let screenTouch = null;

      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const result = classifyTouch(t);

        if (result.type === "button") {
          for (const b of result.buttons) gpButtons.add(b);
        } else if (result.type === "dpad") {
          for (const b of result.buttons) gpButtons.add(b);
        } else if (result.type === "screen") {
          screenTouch = result;
        }
      }

      // Update emuKeyState for gamepad buttons
      if (typeof emuKeyState !== "undefined") {
        for (let i = 0; i < 12; i++) {
          emuKeyState[i] = gpButtons.has(i);
        }
      }

      // Update screen touch
      if (typeof touched !== "undefined") {
        if (screenTouch) {
          window.touched = 1;
          window.touchX = screenTouch.x;
          window.touchY = screenTouch.y;
        } else {
          window.touched = 0;
        }
      }

      // Update visual feedback
      updateVisuals(gpButtons);
    }

    function classifyTouch(t) {
      const el = document.elementFromPoint(t.clientX, t.clientY);

      // Check gamepad buttons (data-btn attribute)
      if (el) {
        const btnEl = el.closest("[data-btn]");
        if (btnEl) {
          return { type: "button", buttons: [parseInt(btnEl.dataset.btn)] };
        }
      }

      // Check D-pad
      const dpadEl = $("dpad");
      if (dpadEl) {
        const rect = dpadEl.parentElement.getBoundingClientRect();
        if (t.clientX >= rect.left && t.clientX <= rect.right &&
            t.clientY >= rect.top && t.clientY <= rect.bottom) {
          return classifyDpad(t, rect);
        }
      }

      // Check ABXY area (touches between button centers)
      const abxyEl = $("abxy");
      if (abxyEl) {
        const rect = abxyEl.getBoundingClientRect();
        if (t.clientX >= rect.left && t.clientX <= rect.right &&
            t.clientY >= rect.top && t.clientY <= rect.bottom) {
          return classifyABXY(t, rect);
        }
      }

      // Check bottom screen
      if (screenBot) {
        const rect = screenBot.getBoundingClientRect();
        if (t.clientX >= rect.left && t.clientX <= rect.right &&
            t.clientY >= rect.top && t.clientY <= rect.bottom) {
          const x = ((t.clientX - rect.left) / rect.width) * 256;
          const y = ((t.clientY - rect.top) / rect.height) * 192;
          return { type: "screen", x: Math.max(0, Math.min(255, x)), y: Math.max(0, Math.min(191, y)) };
        }
      }

      return { type: "none" };
    }

    function classifyDpad(t, rect) {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = t.clientX - cx;
      const dy = t.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const deadzone = rect.width * 0.10;
      const buttons = [];

      if (dist > deadzone) {
        const angle = Math.atan2(dy, dx); // Right=0, Down=+π/2, Left=±π, Up=-π/2
        // Each direction covers 90° centered on its axis, giving 45° diagonal overlap
        const SLICE = Math.PI * 3 / 8; // 67.5° half-width
        if (Math.abs(angle) < SLICE) buttons.push(0);                // right (index 0)
        if (angle > Math.PI / 2 - SLICE && angle < Math.PI / 2 + SLICE) buttons.push(2); // down
        if (Math.abs(angle) > Math.PI - SLICE) buttons.push(1);      // left
        if (angle < -Math.PI / 2 + SLICE && angle > -Math.PI / 2 - SLICE) buttons.push(3); // up
      }

      return { type: "dpad", buttons };
    }

    function classifyABXY(t, rect) {
      // Find closest face button
      const wrap = $("abxy");
      const fbtns = wrap.querySelectorAll(".face-btn");
      let closest = null, closestDist = Infinity;

      for (const fb of fbtns) {
        const r = fb.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(t.clientX - cx, t.clientY - cy);
        if (d < closestDist) {
          closestDist = d;
          closest = fb;
        }
      }

      if (closest && closestDist < 50) {
        return { type: "button", buttons: [parseInt(closest.dataset.btn)] };
      }
      return { type: "none" };
    }

    // ── Visual feedback ──
    function updateVisuals(pressed) {
      // D-pad arrows
      $("arr-up").classList.toggle("lit", pressed.has(3));
      $("arr-down").classList.toggle("lit", pressed.has(2));
      $("arr-left").classList.toggle("lit", pressed.has(1));
      $("arr-right").classList.toggle("lit", pressed.has(0));

      // All [data-btn] elements
      document.querySelectorAll("[data-btn]").forEach((el) => {
        el.classList.toggle("pressed", pressed.has(parseInt(el.dataset.btn)));
      });
    }

    // ── Touch end: clear everything ──
    function handleTouchEnd(e) {
      if ($("overlay").classList.contains("open")) return;
      if (e.target.closest(".hud")) return;
      if (e.target.closest("#unmute")) return;

      e.preventDefault();

      // Re-process remaining touches
      const gpButtons = new Set();
      let screenTouch = null;

      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const result = classifyTouch(t);
        if (result.type === "button" || result.type === "dpad") {
          for (const b of result.buttons) gpButtons.add(b);
        } else if (result.type === "screen") {
          screenTouch = result;
        }
      }

      if (typeof emuKeyState !== "undefined") {
        for (let i = 0; i < 12; i++) emuKeyState[i] = gpButtons.has(i);
      }
      if (typeof touched !== "undefined") {
        window.touched = screenTouch ? 1 : 0;
        if (screenTouch) {
          window.touchX = screenTouch.x;
          window.touchY = screenTouch.y;
        }
      }
      updateVisuals(gpButtons);
    }

    // Register on window to catch all touches
    window.addEventListener("touchstart", handleTouchEvent, { passive: false, capture: true });
    window.addEventListener("touchmove", handleTouchEvent, { passive: false, capture: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: false, capture: true });
  }

  // ═══════════════════════════════════════
  // DESKTOP MOUSE → SCREEN TOUCH
  // ═══════════════════════════════════════
  // Desmond's mouse handler works but depends on screenCanvas[1] which
  // references the shadow DOM canvas. It should work as-is for desktop.
  // We only need gamepad touch handling for mobile.

  // ═══════════════════════════════════════
  // SOUND INIT
  // ═══════════════════════════════════════
  function initSoundOverlay() {
    const el = $("unmute");
    el.classList.add("show");

    const handler = () => {
      el.classList.remove("show");
      ensureSound();
      document.removeEventListener("click", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", handler, true);
    };
    document.addEventListener("click", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", handler, true);
  }

  // ═══════════════════════════════════════
  // SAVE HELPERS
  // ═══════════════════════════════════════
  function getSaveKey() {
    return (typeof gameID !== "undefined" && gameID) ? "sav-" + gameID : null;
  }

  function updateSaveTag() {
    const key = getSaveKey();
    const tag = $("tagSave");
    if (!window.localforage || !key) {
      tag.textContent = "save: —";
      tag.className = "tag";
      return;
    }
    localforage.getItem(key).then((d) => {
      if (d?.length) {
        tag.textContent = "save: " + (d.length / 1024).toFixed(0) + " kb";
        tag.className = "tag ok";
      } else {
        tag.textContent = "save: none";
        tag.className = "tag warn";
      }
    }).catch(() => {
      tag.textContent = "save: err";
      tag.className = "tag warn";
    });
  }

  async function refreshSaveStatus() {
    const key = getSaveKey();
    $("saveKey").textContent = "key: " + (key || "—");
    if (!window.localforage || !key) {
      $("saveStatus").textContent = "not ready";
      return;
    }
    try {
      const d = await localforage.getItem(key);
      $("saveStatus").textContent = d
        ? `${(d.length / 1024).toFixed(0)} KB stored`
        : "empty — save in-game first";
    } catch {
      $("saveStatus").textContent = "storage error";
    }
  }

  $("btnExport").onclick = async () => {
    const key = getSaveKey();
    if (!localforage || !key) return;
    const d = await localforage.getItem(key);
    if (!d) return alert("No save data yet.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([d]));
    a.download = key + ".dsv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  $("importFile").addEventListener("change", async (e) => {
    const key = getSaveKey();
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!localforage || !key || !f) return;
    if (f.size > 3145728) return alert("Too large for a DS save.");
    const buf = new Uint8Array(await f.arrayBuffer());
    await localforage.setItem(key, buf);
    location.reload();
  });

  $("btnClear").onclick = async () => {
    const key = getSaveKey();
    if (!localforage || !key) return;
    if (!confirm("Delete save data?")) return;
    await localforage.removeItem(key);
    location.reload();
  };

  // ── HUD auto-dim ──
  let dimTimer = 0;
  function resetHudDim() {
    $("hud").classList.remove("dim");
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => $("hud").classList.add("dim"), 5000);
  }
  ["mousemove", "touchstart", "keydown"].forEach((ev) =>
    document.addEventListener(ev, resetHudDim, { passive: true })
  );
  resetHudDim();

  // ═══════════════════════════════════════
  // WASM READY CHECK
  // ═══════════════════════════════════════
  // Desmond's WASM loads asynchronously. On slow connections (mobile),
  // our ROM might be ready before the WASM. Wait for Module to be usable.
  function waitForWasm(timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (typeof Module !== "undefined" && Module._prepareRomBuffer) {
        return resolve();
      }
      const start = Date.now();
      const iv = setInterval(() => {
        if (typeof Module !== "undefined" && Module._prepareRomBuffer) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - start > timeout) {
          clearInterval(iv);
          reject(new Error("WASM load timeout — try refreshing"));
        }
      }, 100);
    });
  }

  // ═══════════════════════════════════════
  // MAIN BOOT
  // ═══════════════════════════════════════
  async function boot() {
    const params = new URLSearchParams(location.search);
    const ROM_URL = params.get("rom") || DEFAULT_ROM_URL;

    if (!ROM_URL) {
      $("loaderTitle").textContent = "No ROM";
      $("sub").textContent = "Set DEFAULT_ROM_URL in js/boot.js or use ?rom=<url>";
      return;
    }

    // Request persistent storage
    try { await navigator.storage?.persist?.(); } catch {}

    // ── Wait for WASM ──
    $("sub").textContent = "Loading emulator core…";
    try {
      await waitForWasm();
    } catch (err) {
      $("sub").textContent = err.message;
      return;
    }

    // ── Download or cache ROM ──
    let romU8 = null;
    const cache = romCache();

    if (cache) {
      try {
        const cached = await cache.getItem(ROM_URL);
        if (cached?.byteLength > 1024) {
          romU8 = new Uint8Array(cached);
          $("bar").style.width = "100%";
          $("pct").textContent = "cached";
          $("dl").textContent = fmtMB(romU8.byteLength);
          $("sub").textContent = "Loaded from cache";
        }
      } catch {}
    }

    if (!romU8) {
      $("sub").textContent = "Downloading ROM…";
      let lastT = performance.now(), lastB = 0, ema = 0;
      try {
        romU8 = await fetchROM(ROM_URL, (recv, total) => {
          const now = performance.now();
          const dt = (now - lastT) / 1000;
          if (dt >= 0.25) {
            ema = ema ? ema * 0.75 + ((recv - lastB) / dt) * 0.25 : (recv - lastB) / dt;
            lastT = now; lastB = recv;
          }
          const p = total ? Math.min(100, recv / total * 100) : 50;
          $("bar").style.width = p.toFixed(1) + "%";
          $("pct").textContent = total ? Math.floor(p) + "%" : "…";
          $("dl").textContent = fmtMB(recv) + (total ? " / " + fmtMB(total) : "");
        });
      } catch (err) {
        $("sub").textContent = "Download failed: " + err.message;
        return;
      }

      $("bar").style.width = "100%";
      $("pct").textContent = "100%";

      if (cache) {
        try { await cache.setItem(ROM_URL, romU8.buffer.slice(0)); } catch {}
      }
    }

    // ── Start emulator ──
    $("sub").textContent = "Starting emulator…";

    const blobUrl = URL.createObjectURL(new Blob([romU8], { type: "application/octet-stream" }));
    const player = $("player");

    player.loadURL(blobUrl, () => {
      // Hide loader
      $("loader").style.display = "none";

      // Layout
      applyLayout(player);

      // Virtual gamepad (mobile)
      initGamepad();

      // Sound overlay
      initSoundOverlay();

      // Save tracking
      setTimeout(updateSaveTag, 500);
      setInterval(updateSaveTag, 4000);

      console.log("[boot] ROM loaded, emuIsRunning:", typeof emuIsRunning !== "undefined" ? emuIsRunning : "n/a");
    });

    // Fallback timeout
    setTimeout(() => {
      if ($("loader").style.display !== "none") {
        applyLayout(player);
        initGamepad();
        $("loader").style.display = "none";
        console.warn("[boot] Fallback: forced loader hide");
      }
    }, 8000);
  }

  addEventListener("load", () => {
    boot().catch((err) => {
      console.error("[boot]", err);
      $("sub").textContent = "Error: " + err.message;
    });
  });
})();
