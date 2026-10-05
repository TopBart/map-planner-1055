/** Icônes des statistiques de sanctuaire (captures du jeu fournies par l'utilisateur). */
import harvest from "../assets/bonus/harvest.png";
import exp from "../assets/bonus/exp.png";
import attack from "../assets/bonus/attack.png";
import rally from "../assets/bonus/rally.png";
import health from "../assets/bonus/health.png";
import defense from "../assets/bonus/defense.png";
import production from "../assets/bonus/production.png";
import build from "../assets/bonus/build.png";
import march from "../assets/bonus/march.png";
import research from "../assets/bonus/research.png";
import training from "../assets/bonus/training.png";
import ap from "../assets/bonus/ap.png";
import heal from "../assets/bonus/heal.png";

export const STAT_ICON_URL: Record<string, string> = { harvest, exp, attack, rally, health, defense, production, build, march, research, training, ap, heal };

const images = new Map<string, HTMLImageElement>();

/** Charge toutes les icônes (navigateur uniquement). Les dessins retombent sur une pastille colorée tant qu'elles ne sont pas prêtes. */
export async function loadBonusIcons(custom?: { exists: (path: string) => Promise<boolean>; url: (path: string) => string }): Promise<void> {
  if (typeof Image === "undefined") return;
  // Icônes personnalisées : data/icons/<statistique>.png remplace l'icône fournie (ex. harvest.png).
  if (custom)
    for (const stat of Object.keys(STAT_ICON_URL))
      if (await custom.exists(`icons/${stat}.png`).catch(() => false)) STAT_ICON_URL[stat] = custom.url(`icons/${stat}.png`);
  await Promise.all(
    Object.entries(STAT_ICON_URL).map(
      ([stat, url]) =>
        new Promise<void>((resolve) => {
          if (images.has(stat)) return resolve();
          const img = new Image();
          img.onload = () => {
            images.set(stat, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        })
    )
  );
}

export const statIcon = (stat: string): HTMLImageElement | undefined => images.get(stat);
