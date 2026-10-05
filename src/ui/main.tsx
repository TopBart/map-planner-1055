import { createRoot } from "react-dom/client";
import { detectLang, setLang } from "../core/i18n";
import { App } from "./App";
import "./styles.css";

setLang(detectLang());
createRoot(document.getElementById("root")!).render(<App />);
