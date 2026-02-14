// Emulator core loader (DeSmuME-wasm prebuilt)
// Exposes window.loadEmuCore() so your app can set Module hooks BEFORE loading nds.js.
(() => {
  const CORE_BASE = "https://cdn.jsdelivr.net/gh/MajesticWafer/dsp@main/build/";
  const CORE_JS = CORE_BASE + "nds.js";
  const CORE_WASM = CORE_BASE + "nds.wasm";

  window.Module = window.Module || {};
  const Module = window.Module;

  Module.locateFile = (path) => {
    if (path.endsWith(".wasm")) return CORE_WASM;
    return CORE_BASE + path;
  };

  Module.print = Module.print || ((...args) => console.log(...args));
  Module.printErr = Module.printErr || ((...args) => console.warn(...args));

  window.loadEmuCore = () => new Promise((resolve, reject) => {
    if (window.__ndsCoreLoaded) return resolve();
    const s = document.createElement("script");
    s.src = CORE_JS;
    s.async = true;
    s.onload = () => { window.__ndsCoreLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Failed to load nds.js"));
    document.head.appendChild(s);
  });
})();