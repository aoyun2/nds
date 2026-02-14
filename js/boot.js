// boot.js — chunk-based ROM loader, virtual gamepad, responsive layout
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const isTouchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

  // ══════════════════════════════════════
  // Override desmond's showMsg
  // ══════════════════════════════════════
  let _tt = 0;
  window.showMsg = (msg) => {
    const t = $("tagSave");
    if (!t) return;
    t.textContent = msg;
    t.className = "tag ok";
    clearTimeout(_tt);
    _tt = setTimeout(updateSaveTag, 2200);
  };

  // ══════════════════════════════════════
  // Modal
  // ══════════════════════════════════════
  function openModal(p) {
    $("overlay").classList.add("open");
    $("modalTitle").textContent = p === "controls" ? "Controls" : "Saves";
    $("panelControls").style.display = p === "controls" ? "" : "none";
    $("panelSaves").style.display = p === "saves" ? "" : "none";
    if (p === "saves") refreshSaveStatus();
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

  // ══════════════════════════════════════
  // ROM loading: local chunks OR remote URL
  // ══════════════════════════════════════
  const fmtMB = (b) => (b / 1048576).toFixed(1) + " MB";

  async function loadROMChunks(onProgress) {
    // Fetch manifest
    const mResp = await fetch("./rom/manifest.json");
    if (!mResp.ok) return null;
    const manifest = await mResp.json();
    const { chunks, totalBytes } = manifest;

    onProgress(0, totalBytes, "Loading ROM chunks…");

    // Fetch all chunks in parallel
    const buffers = new Array(chunks);
    let loaded = 0;

    await Promise.all(
      Array.from({ length: chunks }, (_, i) => {
        const url = `./rom/${String(i).padStart(2, "0")}.bin`;
        return fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`Chunk ${i}: HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((buf) => {
            buffers[i] = new Uint8Array(buf);
            loaded += buf.byteLength;
            onProgress(loaded, totalBytes, `Chunk ${i + 1}/${chunks}`);
          });
      })
    );

    // Concatenate
    const rom = new Uint8Array(totalBytes);
    let off = 0;
    for (const b of buffers) {
      rom.set(b, off);
      off += b.byteLength;
    }
    return rom;
  }

  async function loadROMUrl(url, onProgress) {
    onProgress(0, 0, "Downloading ROM…");
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const total = Number(r.headers.get("content-length")) || 0;

    if (r.body?.getReader) {
      const reader = r.body.getReader();
      const chunks = [];
      let recv = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        recv += value.byteLength;
        onProgress(recv, total, "Downloading…");
      }
      const out = new Uint8Array(recv);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      return out;
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    onProgress(buf.byteLength, buf.byteLength, "Downloaded");
    return buf;
  }

  // ══════════════════════════════════════
  // Screen layout (responsive)
  // ══════════════════════════════════════
  let canvasTop = null, canvasBot = null;

  function attachScreens(player) {
    const go = () => {
      const sr = player.shadowRoot;
      if (!sr) return false;
      const cvs = sr.querySelectorAll("canvas");
      if (cvs.length < 2) return false;
      canvasTop = cvs[0];
      canvasBot = cvs[1];
      const base = "position:fixed;image-rendering:pixelated;z-index:1;transform-origin:50% 50%;";
      canvasTop.style.cssText = base;
      canvasBot.style.cssText = base;
      layoutScreens();
      return true;
    };
    if (go()) return;
    const iv = setInterval(() => { if (go()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 10000);
  }

  function layoutScreens() {
    if (!canvasTop || !canvasBot) return;
    const W = innerWidth, H = innerHeight;
    const gpH = isTouchDevice && $("gamepad").classList.contains("active")
      ? $("gamepad").offsetHeight : 0;
    const useH = H - gpH;
    const portrait = isTouchDevice && (W < H);

    if (portrait) {
      // Stacked
      const gap = 2;
      const slotH = (useH - 36 - gap) / 2; // 36px for HUD
      const s = Math.min(W / 256, slotH / 192);
      const block = s * 192;
      const topY = 36 + (useH - 36 - block * 2 - gap) / 2 + block / 2;

      canvasTop.style.left = W / 2 + "px";
      canvasTop.style.top = topY + "px";
      canvasTop.style.transform = `translate(-50%,-50%) scale(${s})`;

      canvasBot.style.left = W / 2 + "px";
      canvasBot.style.top = (topY + block + gap) + "px";
      canvasBot.style.transform = `translate(-50%,-50%) scale(${s})`;
    } else {
      // Side by side
      const half = W / 2;
      const s = Math.min(half / 256, useH / 192);

      canvasTop.style.left = half * 0.5 + "px";
      canvasTop.style.top = useH / 2 + "px";
      canvasTop.style.transform = `translate(-50%,-50%) scale(${s})`;

      canvasBot.style.left = half * 1.5 + "px";
      canvasBot.style.top = useH / 2 + "px";
      canvasBot.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
  }

  addEventListener("resize", layoutScreens, { passive: true });

  // ══════════════════════════════════════
  // Sound
  // ══════════════════════════════════════
  let _soundOk = false;
  function ensureSound() {
    if (_soundOk) return;
    if (typeof tryInitSound === "function") {
      try { tryInitSound(); _soundOk = true; } catch {}
    }
  }

  function showUnmute() {
    const el = $("unmute");
    el.classList.add("show");
    const h = () => {
      el.classList.remove("show");
      ensureSound();
      document.removeEventListener("click", h, true);
      document.removeEventListener("touchstart", h, true);
      document.removeEventListener("keydown", h, true);
    };
    document.addEventListener("click", h, true);
    document.addEventListener("touchstart", h, true);
    document.addEventListener("keydown", h, true);
  }

  // ══════════════════════════════════════
  // VIRTUAL GAMEPAD (touch)
  // ══════════════════════════════════════
  //
  // emuKeyState: 0=right 1=left 2=down 3=up 4=select 5=start
  //              6=b 7=a 8=y 9=x 10=l 11=r

  function initGamepad() {
    if (!isTouchDevice) return;
    $("gamepad").classList.add("active");
    requestAnimationFrame(layoutScreens);

    // Process all current touches into a set of pressed button indices + screen touch
    function process(touches) {
      const pressed = new Set();
      let scrX = -1, scrY = -1, scrHit = false;

      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        const x = t.clientX, y = t.clientY;

        // ── D-pad ──
        const dp = $("dpadZone");
        const dr = dp.getBoundingClientRect();
        if (x >= dr.left && x <= dr.right && y >= dr.top && y <= dr.bottom) {
          const cx = dr.left + dr.width / 2;
          const cy = dr.top + dr.height / 2;
          const dx = x - cx;
          const dy = y - cy;
          const thr = dr.width * 0.15; // ~18px on 120px zone
          if (dx > thr) pressed.add(0);   // right
          if (dx < -thr) pressed.add(1);  // left
          if (dy > thr) pressed.add(2);   // down
          if (dy < -thr) pressed.add(3);  // up
          continue;
        }

        // ── ABXY: find closest face button ──
        const az = $("abxyZone");
        const ar = az.getBoundingClientRect();
        if (x >= ar.left && x <= ar.right && y >= ar.top && y <= ar.bottom) {
          let best = null, bestD = 999;
          for (const fb of az.querySelectorAll(".face-btn")) {
            const fr = fb.getBoundingClientRect();
            const d = Math.hypot(x - (fr.left + fr.width / 2), y - (fr.top + fr.height / 2));
            if (d < bestD) { bestD = d; best = fb; }
          }
          if (best && bestD < 48) {
            pressed.add(parseInt(best.dataset.btn));
          }
          continue;
        }

        // ── Generic data-btn (shoulders, select, start) ──
        const el = document.elementFromPoint(x, y);
        if (el) {
          const btn = el.closest("[data-btn]");
          if (btn && btn.closest("#gamepad")) {
            pressed.add(parseInt(btn.dataset.btn));
            continue;
          }
        }

        // ── Bottom screen touch ──
        if (canvasBot) {
          const sr = canvasBot.getBoundingClientRect();
          if (x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom) {
            scrX = ((x - sr.left) / sr.width) * 256;
            scrY = ((y - sr.top) / sr.height) * 192;
            scrX = Math.max(0, Math.min(255, scrX));
            scrY = Math.max(0, Math.min(191, scrY));
            scrHit = true;
          }
        }
      }

      return { pressed, scrHit, scrX, scrY };
    }

    function apply({ pressed, scrHit, scrX, scrY }) {
      // Write to desmond globals
      if (typeof emuKeyState !== "undefined") {
        for (let i = 0; i < 12; i++) emuKeyState[i] = pressed.has(i);
      }
      if (typeof window.touched !== "undefined") {
        window.touched = scrHit ? 1 : 0;
        if (scrHit) { window.touchX = scrX; window.touchY = scrY; }
      }

      // Visual feedback
      $("arU").classList.toggle("lit", pressed.has(3));
      $("arD").classList.toggle("lit", pressed.has(2));
      $("arL").classList.toggle("lit", pressed.has(1));
      $("arR").classList.toggle("lit", pressed.has(0));

      document.querySelectorAll("#gamepad [data-btn]").forEach((el) => {
        el.classList.toggle("pressed", pressed.has(parseInt(el.dataset.btn)));
      });
    }

    function onTouch(e) {
      // Don't block modal / HUD interaction
      if ($("overlay").classList.contains("open")) return;
      if (e.target.closest(".hud")) return;
      if (e.target.closest("#unmute")) return;

      ensureSound();
      if (typeof emuIsRunning === "undefined" || !emuIsRunning) return;

      e.preventDefault();
      apply(process(e.touches));
    }

    function onTouchEnd(e) {
      if ($("overlay").classList.contains("open")) return;
      if (e.target.closest(".hud")) return;
      if (e.target.closest("#unmute")) return;

      e.preventDefault();
      apply(process(e.touches));
    }

    // Capture phase so we run before desmond's (now disabled) handler
    window.addEventListener("touchstart", onTouch, { passive: false, capture: true });
    window.addEventListener("touchmove", onTouch, { passive: false, capture: true });
    window.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: false, capture: true });
  }

  // ══════════════════════════════════════
  // Save helpers
  // ══════════════════════════════════════
  function getSaveKey() {
    return (typeof gameID !== "undefined" && gameID) ? "sav-" + gameID : null;
  }

  function updateSaveTag() {
    const key = getSaveKey(), tag = $("tagSave");
    if (!window.localforage || !key) { tag.textContent = "save: —"; tag.className = "tag"; return; }
    localforage.getItem(key).then((d) => {
      if (d?.length) { tag.textContent = "save: " + (d.length / 1024 | 0) + " kb"; tag.className = "tag ok"; }
      else { tag.textContent = "save: none"; tag.className = "tag warn"; }
    }).catch(() => { tag.textContent = "save: err"; tag.className = "tag warn"; });
  }

  async function refreshSaveStatus() {
    const key = getSaveKey();
    $("saveKey").textContent = "key: " + (key || "—");
    if (!window.localforage || !key) { $("saveStatus").textContent = "not ready"; return; }
    try {
      const d = await localforage.getItem(key);
      $("saveStatus").textContent = d ? `${(d.length / 1024 | 0)} KB stored` : "empty";
    } catch { $("saveStatus").textContent = "storage error"; }
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
    const key = getSaveKey(), f = e.target.files?.[0];
    e.target.value = "";
    if (!localforage || !key || !f) return;
    if (f.size > 3145728) return alert("Too large.");
    await localforage.setItem(key, new Uint8Array(await f.arrayBuffer()));
    location.reload();
  });

  $("btnClear").onclick = async () => {
    const key = getSaveKey();
    if (!localforage || !key) return;
    if (!confirm("Delete save?")) return;
    await localforage.removeItem(key);
    location.reload();
  };

  // ── HUD auto-dim ──
  let _dim = 0;
  function nudgeHud() {
    $("hud").classList.remove("dim");
    clearTimeout(_dim);
    _dim = setTimeout(() => $("hud").classList.add("dim"), 5000);
  }
  ["mousemove", "touchstart", "keydown"].forEach((e) =>
    document.addEventListener(e, nudgeHud, { passive: true })
  );
  nudgeHud();

  // ══════════════════════════════════════
  // Wait for desmond WASM
  // ══════════════════════════════════════
  function waitForWasm(ms = 20000) {
    return new Promise((ok, fail) => {
      if (typeof Module !== "undefined" && Module._prepareRomBuffer) return ok();
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (typeof Module !== "undefined" && Module._prepareRomBuffer) { clearInterval(iv); ok(); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); fail(new Error("WASM timed out")); }
      }, 150);
    });
  }

  // ══════════════════════════════════════
  // Boot
  // ══════════════════════════════════════
  function progress(recv, total, msg) {
    const p = total > 0 ? Math.min(100, recv / total * 100) : 0;
    $("bar").style.width = p.toFixed(1) + "%";
    $("pct").textContent = total > 0 ? (p | 0) + "%" : "…";
    $("dl").textContent = fmtMB(recv) + (total > 0 ? " / " + fmtMB(total) : "");
    if (msg) $("sub").textContent = msg;
  }

  async function boot() {
    const romUrl = new URLSearchParams(location.search).get("rom");

    // 1. Wait for WASM core
    $("sub").textContent = "Loading emulator core…";
    try { await waitForWasm(); } catch (e) {
      $("sub").textContent = e.message;
      return;
    }

    // 2. Load ROM — try local chunks first, then URL param
    let rom = null;

    try {
      rom = await loadROMChunks(progress);
    } catch {}

    if (!rom && romUrl) {
      try {
        rom = await loadROMUrl(romUrl, progress);
      } catch (e) {
        $("sub").textContent = "ROM download failed: " + e.message;
        return;
      }
    }

    if (!rom) {
      $("loaderTitle").textContent = "No ROM found";
      $("sub").textContent = "Add rom/ chunks via split-rom.sh, or use ?rom=<url>";
      return;
    }

    $("bar").style.width = "100%";
    $("pct").textContent = "100%";
    $("sub").textContent = "Starting…";

    // 3. Feed to emulator
    try { await navigator.storage?.persist?.(); } catch {}

    const blob = URL.createObjectURL(new Blob([rom], { type: "application/octet-stream" }));
    const player = $("player");

    player.loadURL(blob, () => {
      $("loader").style.display = "none";
      attachScreens(player);
      initGamepad();
      showUnmute();
      setTimeout(updateSaveTag, 600);
      setInterval(updateSaveTag, 4000);
    });

    // Fallback
    setTimeout(() => {
      if ($("loader").style.display !== "none") {
        $("loader").style.display = "none";
        attachScreens(player);
        initGamepad();
      }
    }, 10000);
  }

  addEventListener("load", () => {
    boot().catch((e) => {
      console.error("[boot]", e);
      $("sub").textContent = "Error: " + e.message;
    });
  });
})();
