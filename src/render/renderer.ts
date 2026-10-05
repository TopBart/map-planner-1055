import { t } from "../core/i18n";
import type { Point } from "../core/types";
import { DEFAULT_VISIBILITY, drawScene, type FrameState, renderToSurface, type Scene } from "./draw";
import { overviewsFor } from "./scene";
import {
  fitScale,
  fitView,
  panView,
  resizeView,
  screenToWorld,
  type View,
  worldToScreen,
  zoomOf,
  zoomView,
} from "./view";

/**
 * Pilote un <canvas> : caméra, dessin à la demande (une image par rafraîchissement d'écran
 * au maximum, et seulement si quelque chose a changé) et export PNG pleine résolution.
 */
export interface ExportOptions {
  format: "png" | "webp-lossless" | "webp" | "jpeg";
  /** 0..1, pour webp/jpeg avec perte. */
  quality: number;
  cols: number;
  rows: number;
  /** Poids maximum par fichier en octets (0 = aucune limite) : la qualité WebP est réduite au strict nécessaire. */
  maxBytes: number;
}

export interface ExportedImage {
  blob: Blob;
  ext: string;
  /** Qualité WebP finalement retenue si la limite de poids a imposé une compression avec perte. */
  quality?: number;
}

export class MapRenderer {
  view: View = { cx: 0, cy: 0, scale: 1, width: 0, height: 0 };
  state: FrameState;
  private frame = 0;
  private disposed = false;
  /** Plafond de la densité de pixels (réduit en mode économe). */
  static maxDpr = 2;
  private dpr = 1;
  /** Fond mis en cache : un simple survol (aperçu de pose) ne redessine pas toute la carte. Désactivé en mode économe. */
  static layerCache = true;
  private base: HTMLCanvasElement | null = null;
  private baseDirty = true;
  private observer?: ResizeObserver;

  constructor(
    readonly canvas: HTMLCanvasElement,
    public scene: Scene,
    state: FrameState,
    private readonly onZoom?: (zoom: number) => void
  ) {
    this.state = state;
    const host = canvas.parentElement ?? canvas;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  get zoom(): number {
    return zoomOf(this.view, this.scene.bounds);
  }

  resize(): void {
    if (this.disposed) return;
    const host = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, Math.floor(host.clientWidth));
    const height = Math.max(1, Math.floor(host.clientHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, MapRenderer.maxDpr);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.view = resizeView(this.view, width, height, this.scene.bounds);
    this.baseDirty = true;
    this.requestDraw();
  }

  setScene(scene: Scene): void {
    this.scene = scene;
    this.view = fitView(this.view.width, this.view.height, scene.bounds);
    this.baseDirty = true;
    this.requestDraw();
  }

  update(patch: Partial<FrameState>): void {
    // Seuls l'aperçu de pose, le brouillon d'annotation et les repères vivent dans le calque léger.
    for (const k of Object.keys(patch) as (keyof FrameState)[])
      if (k !== "placement" && k !== "draft" && k !== "pins" && patch[k] !== this.state[k]) this.baseDirty = true;
    this.state = { ...this.state, ...patch };
    this.requestDraw();
  }

  /** Force le redessin du fond (ex. icônes chargées après coup). */
  invalidate(): void {
    this.baseDirty = true;
    this.requestDraw();
  }

  fit(): void {
    this.baseDirty = true;
    this.view = fitView(this.view.width, this.view.height, this.scene.bounds);
    this.requestDraw();
  }

  pan(dx: number, dy: number): void {
    this.baseDirty = true;
    this.view = panView(this.view, dx, dy);
    this.requestDraw();
  }

  zoomAt(factor: number, sx = this.view.width / 2, sy = this.view.height / 2): void {
    this.baseDirty = true;
    this.view = zoomView(this.view, factor, sx, sy, this.scene.bounds);
    this.requestDraw();
  }

  /** Centre la vue sur un point du monde avec un zoom confortable. */
  locate(x: number, y: number, zoom = 6): void {
    this.baseDirty = true;
    const scale = fitScale(this.view.width, this.view.height, this.scene.bounds) * zoom;
    this.view = { ...this.view, cx: x, cy: y, scale };
    this.requestDraw();
  }

  toWorld(sx: number, sy: number): Point {
    return screenToWorld(this.view, sx, sy);
  }

  toScreen(x: number, y: number): Point {
    return worldToScreen(this.view, x, y);
  }

  requestDraw(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    if (this.disposed || this.view.width === 0) return;
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const overviews = overviewsFor(this.scene.engine, this.state.plan.buildings);
    if (!MapRenderer.layerCache) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawScene(ctx, this.scene, this.state, this.view, overviews);
    } else {
      const base = (this.base ??= document.createElement("canvas"));
      if (base.width !== this.canvas.width || base.height !== this.canvas.height) {
        base.width = this.canvas.width;
        base.height = this.canvas.height;
        this.baseDirty = true;
      }
      if (this.baseDirty) {
        const bctx = base.getContext("2d", { alpha: false })!;
        bctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        drawScene(bctx, this.scene, this.state, this.view, overviews, "base");
        this.baseDirty = false;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawScene(ctx, this.scene, this.state, this.view, overviews, "overlay");
    }
    this.onZoom?.(this.zoom);
  }

  /**
   * Export de toute la carte, sans surbrillances ni aperçus.
   * Découpable en cols×rows images (mêmes dimensions à 1 px près), format au choix.
   */
  async exportImages(width: number, height: number, opt: ExportOptions): Promise<ExportedImage[]> {
    const surface = renderToSurface(
      this.scene,
      { ...this.state, visibility: { ...DEFAULT_VISIBILITY, ...this.state.visibility, playable: false } },
      width,
      height,
      overviewsFor(this.scene.engine, this.state.plan.buildings)
    ) as HTMLCanvasElement;
    const enc = (c: HTMLCanvasElement, mime: string, q?: number) =>
      new Promise<Blob>((resolve, reject) =>
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t("L'export a échoué.")))), mime, q)
      );
    const encode = async (c: HTMLCanvasElement): Promise<ExportedImage> => {
      const base = opt.format === "png" ? { mime: "image/png", q: undefined, ext: "png" }
        : opt.format === "jpeg" ? { mime: "image/jpeg", q: opt.quality, ext: "jpg" }
        : { mime: "image/webp", q: opt.format === "webp-lossless" ? 1 : opt.quality, ext: "webp" };
      let blob = await enc(c, base.mime, base.q);
      if (!opt.maxBytes || blob.size <= opt.maxBytes) return { blob, ext: base.ext };
      // Trop lourd : recherche dichotomique de la meilleure qualité qui respecte la limite.
      const lossy = opt.format === "jpeg" ? { mime: "image/jpeg", ext: "jpg" } : { mime: "image/webp", ext: "webp" };
      let lo = 0.5, hi = base.q !== undefined && base.q < 1 ? base.q : 0.99;
      let best: { blob: Blob; q: number } | null = null;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await enc(c, lossy.mime, q);
        if (b.size <= opt.maxBytes) { best = { blob: b, q }; lo = q; } else hi = q;
      }
      blob = best?.blob ?? (await enc(c, lossy.mime, 0.5));
      return { blob, ext: lossy.ext, quality: best?.q ?? 0.5 };
    };
    if (opt.cols * opt.rows <= 1) return [await encode(surface)];
    const out: ExportedImage[] = [];
    for (let j = 0; j < opt.rows; j++) {
      for (let i = 0; i < opt.cols; i++) {
        const x0 = Math.round((i * width) / opt.cols), x1 = Math.round(((i + 1) * width) / opt.cols);
        const y0 = Math.round((j * height) / opt.rows), y1 = Math.round(((j + 1) * height) / opt.rows);
        const tile = document.createElement("canvas");
        tile.width = x1 - x0;
        tile.height = y1 - y0;
        tile.getContext("2d")!.drawImage(surface, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
        out.push(await encode(tile));
      }
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.base = null;
  }
}
