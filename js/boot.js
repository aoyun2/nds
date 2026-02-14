// boot.js — ROM download + cache, sound init fix, layout, save management
(() => {
  "use strict";

  // ═══════════════ CONFIG ═══════════════
  // Set ROM URL here or pass ?rom=<url>
  const DEFAULT_ROM_URL = "https://files.catbox.moe/35lx11.nds";
  // ══════════════════════════════════════

  const $ = (id) => document.getElementById(id);

  // ── Toast (reuse desmond's showMsg) ──
  let _toastTimer = 0;
  window.showMsg = (msg) => {
    const t = $("tagSave");
    if (!t) return;
    const prev = t.textContent;
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

  const KEY_CODE = {
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Enter: 13,
    Shift: 16,
    a: 65,
    q: 81,
    s: 83,
    w: 87,
    x: 88,
    z: 90,
  };

  function emuKey(key, type) {
    const code = KEY_CODE[key] || 0;
    const evt = new KeyboardEvent(type, {
      key,
      code: key.startsWith("Arrow") ? key : `Key${key.toUpperCase?.() || ""}`,
      which: code,
      keyCode: code,
      bubbles: true,
      cancelable: true,
    });
    if (code) {
      try {
        Object.defineProperty(evt, "which", { get: () => code });
        Object.defineProperty(evt, "keyCode", { get: () => code });
      } catch {}
    }
    document.dispatchEvent(evt);
    window.dispatchEvent(evt);
  }

  function initTouchControls() {
    const root = $("touchControls");
    if (!root) return;

    const held = new Map();
    const release = (btn, pointerId) => {
      const data = held.get(pointerId);
      if (!data) return;
      emuKey(data.key, "keyup");
      data.btn.classList.remove("active");
      held.delete(pointerId);
      if (btn?.releasePointerCapture) {
        try { btn.releasePointerCapture(pointerId); } catch {}
      }
    };

    root.querySelectorAll(".touch-btn[data-key]").forEach((btn) => {
      const key = btn.dataset.key;
      if (!key) return;

      btn.addEventListener("contextmenu", (e) => e.preventDefault());

      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (held.has(e.pointerId)) return;
        held.set(e.pointerId, { key, btn });
        btn.classList.add("active");
        if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
        emuKey(key, "keydown");
      });

      btn.addEventListener("pointerup", (e) => {
        e.preventDefault();
        release(btn, e.pointerId);
      });
      btn.addEventListener("pointercancel", (e) => release(btn, e.pointerId));
      btn.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse" && e.buttons === 0) release(btn, e.pointerId);
      });
    });

    window.addEventListener("blur", () => {
      for (const [id, data] of held) {
        emuKey(data.key, "keyup");
        data.btn.classList.remove("active");
        held.delete(id);
      }
    });
  }

  // ── ROM cache via localforage (bundled in desmond) ──
  function romCache() {
    if (!window.localforage) return null;
    return window.localforage.createInstance({ name: "nds_player", storeName: "rom_cache" });
  }

  // ── Streaming download with progress ──
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

    const buf = new Uint8Array(await r.arrayBuffer());
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  // ── Side-by-side screen layout ──
  function applySideBySide(player) {
    const go = () => {
      const sr = player.shadowRoot;
      if (!sr) return false;
      const cvs = sr.querySelectorAll("canvas");
      if (cvs.length < 2) return false;
      const [top, bot] = cvs;

      const style = (c) => {
        c.style.cssText = "position:fixed;top:50%;image-rendering:pixelated;z-index:1;transform-origin:50% 50%;";
      };
      style(top); style(bot);

      const resize = () => {
        const W = innerWidth, H = innerHeight;
        const portrait = H > W;
        if (portrait) {
          const s = Math.min(W / 256, (H * 0.5) / 192);
          top.style.left = W * 0.5 + "px";
          bot.style.left = W * 0.5 + "px";
          top.style.top = H * 0.26 + "px";
          bot.style.top = H * 0.64 + "px";
          top.style.transform = `translate(-50%,-50%) scale(${s})`;
          bot.style.transform = `translate(-50%,-50%) scale(${s})`;
          return;
        }

        const half = W / 2;
        const s = Math.min(half / 256, H / 192);
        top.style.top = "50%";
        bot.style.top = "50%";
        top.style.left = half * 0.5 + "px";
        bot.style.left = half * 1.5 + "px";
        top.style.transform = `translate(-50%,-50%) scale(${s})`;
        bot.style.transform = `translate(-50%,-50%) scale(${s})`;
      };

      addEventListener("resize", resize, { passive: true });
      resize();
      return true;
    };

    if (go()) return;
    // Retry until shadow DOM populates
    const iv = setInterval(() => {
      if (go()) clearInterval(iv);
    }, 60);
    setTimeout(() => clearInterval(iv), 6000);
  }

  // ── Sound fix ──
  // Desmond's tryInitSound() creates the AudioContext + AudioWorklet.
  // It's only called inside mousedown/touch handlers gated by emuIsRunning,
  // but our UI overlay intercepts those events. Fix: show a click-to-unmute
  // overlay after boot, which calls tryInitSound on user gesture.
  function initSoundOverlay() {
    const el = $("unmute");
    el.classList.add("show");

    const handler = () => {
      el.classList.remove("show");
      // Call desmond's global tryInitSound (creates AudioContext on user gesture)
      if (typeof tryInitSound === "function") {
        try { tryInitSound(); } catch (e) { console.warn("tryInitSound:", e); }
      }
      document.removeEventListener("click", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", handler, true);
    };

    document.addEventListener("click", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", handler, true);
  }

  // ── Save helpers ──
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
        ? `${(d.length / 1024).toFixed(0)} KB in storage`
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
    if (!confirm("Delete save data for this game?")) return;
    await localforage.removeItem(key);
    location.reload();
  };

  // ── HUD auto-dim ──
  let dimTimer = 0;
  function resetHudDim() {
    $("hud").classList.remove("dim");
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => $("hud").classList.add("dim"), 4000);
  }
  ["mousemove", "touchstart", "keydown"].forEach((ev) =>
    document.addEventListener(ev, resetHudDim, { passive: true })
  );
  resetHudDim();

  // ── Main boot ──
  async function boot() {
    const params = new URLSearchParams(location.search);
    const ROM_URL = params.get("rom") || DEFAULT_ROM_URL;

    if (!ROM_URL) {
      $("loaderTitle").textContent = "No ROM";
      $("sub").textContent = "Set DEFAULT_ROM_URL in js/boot.js or use ?rom=<url>";
      $("bar").style.width = "0%";
      return;
    }

    // Request persistent storage
    try { await navigator.storage?.persist?.(); } catch {}

    let romU8 = null;
    const cache = romCache();

    // Try cache first
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

    // Otherwise download
    if (!romU8) {
      let lastT = performance.now(), lastB = 0, ema = 0;
      romU8 = await fetchROM(ROM_URL, (recv, total) => {
        const now = performance.now();
        const dt = (now - lastT) / 1000;
        if (dt >= 0.2) {
          ema = ema ? ema * 0.75 + ((recv - lastB) / dt) * 0.25 : (recv - lastB) / dt;
          lastT = now; lastB = recv;
        }
        const p = total ? Math.min(100, recv / total * 100) : 50;
        $("bar").style.width = p.toFixed(1) + "%";
        $("pct").textContent = total ? Math.floor(p) + "%" : "…";
        $("dl").textContent = fmtMB(recv) + (total ? " / " + fmtMB(total) : "");
      });

      $("bar").style.width = "100%";
      $("pct").textContent = "100%";

      // Cache for next time
      if (cache) {
        try { await cache.setItem(ROM_URL, romU8.buffer.slice(0)); } catch {}
      }
    }

    $("sub").textContent = "Starting emulator…";

    // Create blob URL for desmond's internal XHR re-fetch
    const blobUrl = URL.createObjectURL(new Blob([romU8], { type: "application/octet-stream" }));
    const player = $("player");

    player.loadURL(blobUrl, () => {
      // Hide loader
      $("loader").style.display = "none";

      // Layout
      applySideBySide(player);

      // Show unmute overlay for sound
      initSoundOverlay();

      // Save tag updates
      setTimeout(updateSaveTag, 500);
      setInterval(updateSaveTag, 4000);
    });

    // Fallback: hide loader and layout even if callback is slow
    setTimeout(() => {
      applySideBySide(player);
      $("loader").style.display = "none";
    }, 5000);
  }

  addEventListener("load", () => {
    initTouchControls();
    boot().catch((err) => {
      console.error("[boot]", err);
      $("sub").textContent = "Error: " + err.message;
    });
  });
})();
