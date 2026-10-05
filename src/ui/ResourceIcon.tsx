import { dataUrl } from "./platform";

const FILES = {
  credits: "img_iconAllianceFund.png",
  food: "img_Allifood.png",
  wood: "img_Alliwood.png",
  stone: "img_Allistone.png",
  coin: "img_Alligold.png",
  crystal: "img_AlliCrystal.png",
} as const;

/** Icône de ressource du jeu (téléchargée avec les données) ; masquée si absente. */
export function ResourceIcon({ kind }: { kind: keyof typeof FILES }) {
  return <img src={dataUrl(`sprites/${FILES[kind]}`)} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />;
}
