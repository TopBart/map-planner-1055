#!/usr/bin/env node
// Gestion des clés : node server/admin.mjs <commande>
//   add [--label "Nom"] [--devices 2] [--expires 2026-12-31]   crée une clé (affichée une seule fois)
//   list                                                       liste les clés
//   revoke <id>   |  restore <id>                              révoque / rétablit
//   reset <id>                                                 libère les appareils enregistrés
//   delete <id>                                                supprime la clé
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, hashKey, KeyStore } from "./lib.mjs";
import { randomBytes } from "node:crypto";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const store = new KeyStore(resolve(process.env.KEYS_FILE ?? join(root, "server", "keys.json")));
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : def;
};
const db = store.read();
const need = (id) => {
  const k = db.keys.find((x) => x.id === id);
  if (!k) { console.error("Clé introuvable : " + id); process.exit(1); }
  return k;
};

switch (cmd) {
  case "add": {
    const key = generateKey();
    db.keys.push({
      id: randomBytes(4).toString("hex"), hash: hashKey(key), label: flag("label", ""),
      maxDevices: Number(flag("devices", 2)), expires: flag("expires", null), revoked: false, devices: [], created: new Date().toISOString(),
    });
    store.write(db);
    console.log("Clé créée (à transmettre maintenant, elle ne sera plus affichée) :\n\n  " + key + "\n");
    break;
  }
  case "list":
    if (!db.keys.length) console.log("Aucune clé.");
    for (const k of db.keys)
      console.log(`${k.id}  ${k.revoked ? "RÉVOQUÉE" : KeyStore.refusal(k) === "expired" ? "EXPIRÉE " : "active  "}  appareils ${k.devices.length}/${k.maxDevices}  exp. ${k.expires ?? "jamais"}  ${k.label}`);
    break;
  case "revoke": need(rest[0]).revoked = true; store.write(db); console.log("Révoquée (effet immédiat sur les données ; l'appli se verrouille au prochain contrôle)."); break;
  case "restore": need(rest[0]).revoked = false; store.write(db); console.log("Rétablie."); break;
  case "reset": need(rest[0]).devices = []; store.write(db); console.log("Appareils libérés."); break;
  case "delete": need(rest[0]); db.keys = db.keys.filter((k) => k.id !== rest[0]); store.write(db); console.log("Supprimée."); break;
  default:
    console.log("Commandes : add [--label X] [--devices N] [--expires AAAA-MM-JJ] | list | revoke <id> | restore <id> | reset <id> | delete <id>");
}
