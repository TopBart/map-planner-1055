/**
 * Lecteur/écrivain du conteneur ROKB (.bin) en TypeScript pur.
 *
 * Port du crate Rust `rokbattles-container` (Apache-2.0 / MIT, projet ROK Battles).
 * Format : en-tête de 20 octets (magic "ROKB", version, flags, schéma, graine, longueur,
 * CRC32) suivi d'une charge utile masquée (XOR xorshift32 puis brassage par blocs de 32 octets).
 * Le masque est réversible et public : il ne protège rien, il détecte seulement la corruption.
 */

export const HEADER_LEN = 20;
export const SCHEMA_BYTES = 1;
export const SCHEMA_TEXT = 2;
export const SCHEMA_JSON = 3;
const VERSION = 1;
const MAGIC = [0x52, 0x4f, 0x4b, 0x42];
const FALLBACK_STATE = 0x6d2b79f5;
const DEFAULT_MAX_PAYLOAD = 16 * 1024 * 1024;

export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerError";
  }
}

export type Envelope = {
  schemaId: number;
  seed: number;
  /** Charge utile démasquée et vérifiée (CRC32). */
  payload: Uint8Array;
};

function initialState(seed: number): number {
  return seed === 0 ? FALLBACK_STATE : seed >>> 0;
}

function xorshift(state: number): number {
  state = (state ^ (state << 13)) >>> 0;
  state = (state ^ (state >>> 17)) >>> 0;
  state = (state ^ (state << 5)) >>> 0;
  return state;
}

function xorMask(payload: Uint8Array, seed: number): void {
  let state = initialState(seed);
  for (let offset = 0; offset < payload.length; offset += 4) {
    state = xorshift(state);
    const count = Math.min(4, payload.length - offset);
    for (let i = 0; i < count; i++) payload[offset + i] ^= (state >>> (8 * i)) & 0xff;
  }
}

function rotl8(value: number, rotation: number): number {
  return ((value << rotation) | (value >>> (8 - rotation))) & 0xff;
}

function rotr8(value: number, rotation: number): number {
  return ((value >>> rotation) | (value << (8 - rotation))) & 0xff;
}

function layered(payload: Uint8Array, seed: number, decode: boolean): void {
  let state = initialState(seed);
  const keys = new Uint32Array(32);
  const swaps = new Uint8Array(32);
  for (let start = 0; start < payload.length; start += 32) {
    const length = Math.min(32, payload.length - start);
    for (let i = 0; i < length; i++) {
      state = xorshift(state);
      keys[i] = state;
    }
    // Planning de Fisher-Yates : généré avant la transformation des octets.
    for (let index = length - 1; index >= 1; index--) {
      state = xorshift(state);
      swaps[index] = state % (index + 1);
    }
    const swap = (a: number, b: number) => {
      const tmp = payload[start + a];
      payload[start + a] = payload[start + b];
      payload[start + b] = tmp;
    };
    if (decode) for (let index = 1; index < length; index++) swap(index, swaps[index]);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const key = keys[i];
      const add = key & 0xff;
      const xor = (key >>> 8) & 0xff;
      const rotation = ((key >>> 16) & 0xff) & 7;
      const at = start + i;
      if (decode) {
        const encoded = payload[at];
        payload[at] = (rotr8((encoded ^ xor ^ previous) & 0xff, rotation) - add) & 0xff;
        previous = encoded;
      } else {
        payload[at] = rotl8((payload[at] + add) & 0xff, rotation) ^ xor ^ previous;
        previous = payload[at];
      }
    }
    if (!decode) for (let index = length - 1; index >= 1; index--) swap(index, swaps[index]);
  }
}

let crcTable: Uint32Array | undefined;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Valide l'en-tête, démasque la charge utile (sur une copie) et vérifie le CRC32. */
export function readEnvelope(file: Uint8Array, maxPayloadLength = DEFAULT_MAX_PAYLOAD): Envelope {
  if (file.length < HEADER_LEN) throw new ContainerError("Fichier ROKB tronqué (en-tête incomplet)");
  for (let i = 0; i < 4; i++) if (file[i] !== MAGIC[i]) throw new ContainerError("Signature ROKB invalide");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const version = file[4];
  const flags = file[5];
  if (version !== VERSION) throw new ContainerError(`Version ROKB non gérée : ${version}`);
  if (flags !== 0) throw new ContainerError(`Drapeaux ROKB non gérés : 0x${flags.toString(16)}`);
  const schemaId = view.getUint16(6, true);
  const seed = view.getUint32(8, true);
  const payloadLength = view.getUint32(12, true);
  const expectedCrc = view.getUint32(16, true);
  if (schemaId === 0) throw new ContainerError("Identifiant de schéma ROKB nul (réservé)");
  if (payloadLength > maxPayloadLength) throw new ContainerError("Charge utile ROKB trop grande");
  if (file.length - HEADER_LEN !== payloadLength) throw new ContainerError("Longueur ROKB incohérente");
  const payload = file.slice(HEADER_LEN);
  layered(payload, seed, true);
  xorMask(payload, seed);
  if (crc32(payload) !== expectedCrc) throw new ContainerError("Somme de contrôle ROKB invalide");
  return { schemaId, seed, payload };
}

export type DecodedContainer =
  | { schemaId: typeof SCHEMA_BYTES; value: Uint8Array }
  | { schemaId: typeof SCHEMA_TEXT; value: string }
  | { schemaId: typeof SCHEMA_JSON; value: unknown };

/** Décode les schémas génériques 1 (octets), 2 (texte UTF-8) et 3 (JSON). */
export function decodeContainer(file: Uint8Array, maxPayloadLength?: number): DecodedContainer {
  const { schemaId, payload } = readEnvelope(file, maxPayloadLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  switch (schemaId) {
    case SCHEMA_BYTES:
      return { schemaId, value: payload };
    case SCHEMA_TEXT:
      return { schemaId, value: decoder.decode(payload) };
    case SCHEMA_JSON:
      return { schemaId, value: JSON.parse(decoder.decode(payload)) as unknown };
    default:
      throw new ContainerError(`Schéma ROKB ${schemaId} non pris en charge (les cartes v2 utilisent le schéma 3)`);
  }
}

/** Décode un fichier de données de carte (schéma JSON). */
export function decodeJsonContainer<T = unknown>(file: Uint8Array, maxPayloadLength?: number): T {
  const decoded = decodeContainer(file, maxPayloadLength);
  if (decoded.schemaId !== SCHEMA_JSON) throw new ContainerError("Un conteneur JSON (schéma 3) était attendu");
  return decoded.value as T;
}

/** Encodage (utile pour les tests et les outils) : en-tête + charge utile masquée. */
export function encodeEnvelope(schemaId: number, payload: Uint8Array, seed = 0): Uint8Array {
  if (schemaId === 0) throw new ContainerError("Identifiant de schéma ROKB nul (réservé)");
  const out = new Uint8Array(HEADER_LEN + payload.length);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = 0;
  view.setUint16(6, schemaId, true);
  view.setUint32(8, seed >>> 0, true);
  view.setUint32(12, payload.length, true);
  view.setUint32(16, crc32(payload), true);
  out.set(payload, HEADER_LEN);
  const body = out.subarray(HEADER_LEN);
  xorMask(body, seed);
  layered(body, seed, false);
  return out;
}

export function encodeJson(value: unknown, seed = 0): Uint8Array {
  return encodeEnvelope(SCHEMA_JSON, new TextEncoder().encode(JSON.stringify(value)), seed);
}
