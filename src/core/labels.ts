import { t } from "./i18n";
import type { BuildingKind } from "./types";

/** Libellés traduits au moment de la lecture (changement de langue à chaud). */
export const KIND_FR: Record<BuildingKind, string> = {
  get flag() { return t("Drapeau"); },
  get "center-fortress"() { return t("Forteresse centrale"); },
  get fortress() { return t("Forteresse"); },
  get horse() { return t("Cheval"); },
};
