/** Enregistrement du service worker (version web uniquement) et détection d'une nouvelle version. */
export function registerPwa(onUpdate: (apply: () => void) => void): void {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http") || location.hostname === "localhost" && import.meta.env.DEV) return;
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const announce = (worker: ServiceWorker) =>
      onUpdate(() => {
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
        worker.postMessage("skip-waiting");
      });
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) announce(worker);
      });
    });
    setInterval(() => void reg.update(), 3600_000);
  }).catch(() => undefined);
}
