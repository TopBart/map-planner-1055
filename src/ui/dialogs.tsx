import { toGame } from "../core/coords";
import { t } from "../core/i18n";
import type { ImportedAlliance } from "../core/excelPlan";
import type { ImportReport } from "../core/importPlan";
import { KIND_FR as KIND_LABELS } from "../core/labels";
import type { ExportOptions } from "../render/renderer";

/** Dialogues modaux de l'éditeur : texte, nom du plan, export d'image, import Excel. Aucun état propre : tout vient d'Editor. */

export function TextDialog(p: { value: string; onChange: (v: string) => void; onSubmit: () => void; onClose: () => void }) {
  return (
    <div className="modal" onClick={p.onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}>
        <div>
          <h3>{t("Texte")}</h3>
          <input type="text" autoFocus value={p.value} onChange={(e) => p.onChange(e.target.value)} maxLength={500} />
          <div className="row"><button className="primary" type="submit">{t("Ajouter")}</button><button type="button" onClick={p.onClose}>{t("Annuler¦fermer")}</button></div>
        </div>
      </form>
    </div>
  );
}

export function NameDialog(p: { value: string; onChange: (v: string) => void; onSubmit: () => void; onClose: () => void }) {
  return (
    <div className="modal" onClick={p.onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}>
        <div>
          <h3>{t("Nom du plan")}</h3>
          <input type="text" autoFocus value={p.value} onChange={(e) => p.onChange(e.target.value)} maxLength={80} />
          <p className="muted">{t("Enregistré dans « Mes plans ».")}</p>
          <div className="row"><button className="primary" type="submit">{t("Enregistrer")}</button><button type="button" onClick={p.onClose}>{t("Annuler¦fermer")}</button></div>
        </div>
      </form>
    </div>
  );
}

export type ExportState = Omit<ExportOptions, "maxBytes"> & { scale: number; busy: boolean; maxMb: number };

export function ExportDialog(p: {
  exp: ExportState;
  onChange: (e: ExportState) => void;
  dims: (o: { scale: number; cols: number; rows: number }) => { W: number; H: number; tw: number; th: number };
  onRun: () => void;
  onClose: () => void;
}) {
  const { exp, onChange: set } = p;
  const d = p.dims(exp);
  return (
    <div className="modal" onClick={() => !exp.busy && p.onClose()}>
      <div className="wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t("Exporter l'image")}</h3>
        <label className="check">{t("Format") + " "}
          <select value={exp.format} onChange={(e) => set({ ...exp, format: e.target.value as ExportOptions["format"] })}>
            <option value="webp-lossless">{t("WebP sans perte (identique au PNG, ~30-50 % plus léger)")}</option>
            <option value="png">{t("PNG (le plus compatible, le plus lourd)")}</option>
            <option value="webp">{t("WebP haute qualité (très léger)")}</option>
            <option value="jpeg">{t("JPEG haute qualité (léger, textes un peu flous)")}</option>
          </select>
        </label>
        {(exp.format === "webp" || exp.format === "jpeg") && (
          <label className="check">{t("Qualité")} {Math.round(exp.quality * 100)} %
            <input type="range" min={0.6} max={1} step={0.01} value={exp.quality} onChange={(e) => set({ ...exp, quality: Number(e.target.value) })} />
          </label>
        )}
        <label className="check">{t("Taille") + " "}
          <select value={exp.scale} onChange={(e) => set({ ...exp, scale: Number(e.target.value) })}>
            <option value={1}>100 %</option>
            <option value={0.75}>75 %</option>
            <option value={0.5}>50 %</option>
          </select>
        </label>
        <label className="check">{t("Découpage") + " "}
          <select value={`${exp.cols}x${exp.rows}`} onChange={(e) => { const [c, r] = e.target.value.split("x").map(Number); set({ ...exp, cols: c, rows: r }); }}>
            <option value="1x1">{t("1 image")}</option>
            <option value="2x2">{t("2 × 2 (4 images)")}</option>
            <option value="3x3">{t("3 × 3 (9 images)")}</option>
            <option value="4x4">{t("4 × 4 (16 images)")}</option>
          </select>
        </label>
        <label className="check">{t("Poids max par fichier (Mo, 0 = aucune limite)") + " "}
          <input type="number" min={0} step={0.5} value={exp.maxMb} style={{ width: 70 }} onChange={(e) => set({ ...exp, maxMb: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <p className="muted">
          {t("{n} image(s) de {w} × {h} px (total {W} × {H}).", { n: exp.cols * exp.rows, w: d.tw, h: d.th, W: d.W, H: d.H })}
          {exp.cols * exp.rows > 1 ? t(" Les images sont enregistrées dans un dossier au choix, nommées _L(ligne)_C(colonne).") : ""}
        </p>
        <div className="row">
          <button className="primary" onClick={p.onRun} disabled={exp.busy}>{exp.busy ? t("Export…") : t("Exporter")}</button>
          <button onClick={p.onClose} disabled={exp.busy}>{t("Annuler¦fermer")}</button>
        </div>
      </div>
    </div>
  );
}

export type ImportState = { file: string; alliances: ImportedAlliance[]; chosen: boolean[]; force: boolean; report?: ImportReport };

export function ImportDialog(p: { imp: ImportState; onChange: (i: ImportState) => void; onRun: () => void; onClose: () => void }) {
  const { imp, onChange: set } = p;
  return (
    <div className="modal" onClick={p.onClose}>
      <div className="wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t("Importer")} {imp.file}</h3>
        {!imp.report ? (
          <>
            <p className="muted">{t("Alliances trouvées (coordonnées de jeu). Chaque bâtiment est vérifié avec les règles de la carte ; une alliance du même nom est complétée.")}</p>
            {imp.alliances.map((a, i) => (
              <label key={`${a.name}-${i}`} className="check">
                <input type="checkbox" checked={imp.chosen[i]} onChange={(e) => set({ ...imp, chosen: imp.chosen.map((c, j) => (j === i ? e.target.checked : c)) })} />
                {a.name} · {a.buildings.length} {t("bâtiment(s)")}
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={imp.force} onChange={(e) => set({ ...imp, force: e.target.checked })} />
              {t("Importer aussi les bâtiments refusés par les règles")}
            </label>
            <div className="row"><button className="primary" onClick={p.onRun} disabled={!imp.chosen.some(Boolean)}>{t("Importer")}</button><button onClick={p.onClose}>{t("Annuler¦fermer")}</button></div>
          </>
        ) : (
          <>
            <p>
              {imp.report.placed} {t("bâtiment(s) importé(s)")}
              {imp.report.forced ? t(", dont {n} hors règles", { n: imp.report.forced }) : ""}, {imp.report.refused.length} {t("refusé(s).")}
            </p>
            {imp.report.refused.length > 0 && (
              <div className="refused">
                {imp.report.refused.slice(0, 60).map((r, i) => (
                  <div key={i}>{r.alliance} · {KIND_LABELS[r.kind]} ({toGame(r.x)}, {toGame(r.y)}) : {r.reason}</div>
                ))}
                {imp.report.refused.length > 60 && <div>{t("… et")} {imp.report.refused.length - 60} {t("autres")}</div>}
              </div>
            )}
            <p className="muted">{t("Ctrl+Z annule l'import.")}</p>
            <div className="row"><button className="primary" onClick={p.onClose}>{t("Fermer")}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
