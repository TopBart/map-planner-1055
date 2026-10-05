import { t } from "../core/i18n";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Point } from "../core/types";

export type ShotPair = { img: Point; world?: Point };

/** Capture d'écran affichée à gauche de la carte : zoom à la molette, déplacement au glisser, clic = repère ou pipette. */
export function ShotPanel({
  url,
  size,
  mode,
  pairs,
  picked,
  onPoint,
  onClose,
  title,
  hint,
  children,
}: {
  url: string;
  size: [number, number];
  mode: "points" | "pipette";
  pairs: ShotPair[];
  picked?: Point | null;
  onPoint: (p: Point) => void;
  onClose: () => void;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / size[0], el.clientHeight / size[1]);
    setView({ k, tx: (el.clientWidth - size[0] * k) / 2, ty: (el.clientHeight - size[1] * k) / 2 });
  }, [url, size]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = Math.max(0.05, Math.min(20, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const rect = box.current!.getBoundingClientRect();
    return [(e.clientX - rect.left - view.tx) / view.k, (e.clientY - rect.top - view.ty) / view.k];
  };

  return (
    <div className="shot">
      <div className="shot-head">
        <b>{title}</b>
        <button onClick={onClose}>{t("Fermer")}</button>
      </div>
      <div
        className="shot-view"
        ref={box}
        style={{ cursor: "crosshair" }}
        onPointerDown={(e) => {
          box.current?.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
          if (d.moved) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            d.x = e.clientX;
            d.y = e.clientY;
            setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          const p = toImage(e);
          if (p[0] >= 0 && p[1] >= 0 && p[0] < size[0] && p[1] < size[1]) onPoint(p);
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: size[0], height: size[1], transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`, transformOrigin: "0 0" }}>
          <img src={url} width={size[0]} height={size[1]} draggable={false} alt="" style={{ display: "block", imageRendering: view.k > 3 ? "pixelated" : "auto" }} />
          {mode === "points" &&
            pairs.map((p, i) => (
              <div key={i} className={`pin ${p.world ? "done" : ""}`} style={{ left: p.img[0], top: p.img[1], transform: `translate(-50%, -50%) scale(${1 / view.k})` }}>
                {i + 1}
              </div>
            ))}
          {mode === "pipette" && picked && <div className="pin done" style={{ left: picked[0], top: picked[1], transform: `translate(-50%, -50%) scale(${1 / view.k})` }}>●</div>}
        </div>
      </div>
      <div className="shot-foot">
        <p className="muted">{hint}</p>
        {children}
      </div>
    </div>
  );
}
