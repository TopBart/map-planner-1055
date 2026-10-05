// Téléchargement des données de cartes (catalogue, fichiers .bin, icônes) depuis le CDN public de ROK Battles.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const API = "https://rokbattles.com/proxy/v2/global/territory-planner";
const CDN = "https://cdn.rokbattles.com/game/territory";
const SPRITES = "https://cdn.rokbattles.com/game/sprites";

async function get(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "map-planner-1055" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`${url} : ${last?.message ?? last}`);
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

async function pool(items, size, worker) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
    })
  );
}

/**
 * @param {string} dir dossier de données
 * @param {(p:{done:number,total:number,label:string})=>void} onProgress
 * @param {{images?:boolean, only?:string[]}} opts images : aperçu/détail .webp (inutile si vous fournissez vos PNG)
 */
async function fetchAll(dir, onProgress = () => {}, opts = {}) {
  const images = opts.images ?? false;
  const list = JSON.parse((await get(`${API}/list`)).toString("utf8"));
  const maps = (opts.only?.length ? list.maps.filter((m) => opts.only.includes(m.map)) : list.maps);
  write(path.join(dir, "maps.json"), JSON.stringify({ maps: list.maps.map(({ overviewUrl, ...m }) => m) }));

  const jobs = [];
  const icons = new Set();
  for (const m of maps) {
    const catalog = JSON.parse((await get(`${API}/map/${encodeURIComponent(m.map)}`)).toString("utf8"));
    write(path.join(dir, "maps", m.map, "catalog.json"), JSON.stringify(catalog));
    for (const category of catalog.categories) {
      const name = `${category}.bin`;
      if (!catalog.assets?.[name]) continue;
      jobs.push({ label: `${m.name} · ${category}`, file: path.join(dir, "maps", m.map, name), url: `${CDN}/${m.map}/${name}`, sha: catalog.assets[name].sha256 });
    }
    if (images)
      for (const name of ["overview.webp", "detail.webp"])
        jobs.push({ label: `${m.name} · ${name}`, file: path.join(dir, "maps", m.map, name), url: `${CDN}/${m.map}/${name}` });
    for (const set of [catalog.structureIcons, catalog.buildingIcons, catalog.siteIcons])
      for (const icon of Object.values(set ?? {})) icons.add(icon);
  }
  for (const icon of ["img_Allifood.png", "img_Alliwood.png", "img_Allistone.png", "img_Alligold.png", "img_AlliCrystal.png", "img_iconAllianceFund.png"]) icons.add(icon);
  for (const icon of icons) jobs.push({ label: `icon ${icon}`, file: path.join(dir, "sprites", icon), url: `${SPRITES}/${icon}`, optional: true });

  let done = 0;
  const errors = [];
  await pool(jobs, 4, async (job) => {
    onProgress({ done, total: jobs.length, label: job.label });
    if (fs.existsSync(job.file) && (!job.sha || sha(fs.readFileSync(job.file)) === job.sha)) {
      done++;
      return;
    }
    try {
      const bytes = await get(job.url);
      if (job.sha && sha(bytes) !== job.sha) throw new Error("empreinte SHA-256 invalide");
      write(job.file, bytes);
    } catch (e) {
      if (!job.optional) errors.push(`${job.label} : ${e.message}`);
    }
    done++;
    onProgress({ done, total: jobs.length, label: job.label });
  });
  return { maps: maps.length, files: jobs.length, errors };
}

module.exports = { fetchAll };
