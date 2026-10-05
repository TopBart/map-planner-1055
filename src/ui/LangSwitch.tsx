import { useSyncExternalStore } from "react";
import { getLang, setLang, subscribeLang, type Lang } from "../core/i18n";

export function LangSwitch() {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  return (
    <select className="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} title="Language / Langue" aria-label="Language">
      <option value="fr">Français</option>
      <option value="en">English</option>
    </select>
  );
}
