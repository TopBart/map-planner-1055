import { describe, expect, it } from "vitest";
import vectors from "./vectors.json";
import {
  ContainerError,
  decodeContainer,
  decodeJsonContainer,
  encodeEnvelope,
  encodeJson,
  readEnvelope,
} from "../src/core/container";

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

describe("conteneur ROKB", () => {
  it("lit les vecteurs officiels du crate Rust", () => {
    expect(vectors).toHaveLength(3);
    for (const vector of vectors) {
      const envelope = readEnvelope(fromHex(vector.file));
      expect(envelope.schemaId).toBe(vector.schema);
      expect(Array.from(envelope.payload)).toEqual(Array.from(fromHex(vector.payload)));
    }
  });

  it("produit exactement les mêmes octets que le crate Rust (graine 0)", () => {
    for (const vector of vectors) {
      const written = encodeEnvelope(vector.schema, fromHex(vector.payload), 0);
      expect(Buffer.from(written).toString("hex")).toBe(vector.file);
    }
  });

  it("décode texte et JSON", () => {
    expect(decodeContainer(fromHex(vectors[1].file)).value).toBe("ROK Battles 🏰\u0000 RÓK Báttlès");
    const json = decodeJsonContainer<Record<string, unknown>>(fromHex(vectors[2].file));
    expect(json.ok).toBe(true);
    expect(json.items).toEqual([null, "hello", 7]);
  });

  it("fait un aller-retour pour toutes les longueurs et graines", () => {
    for (const seed of [0, 1, 42, 0xffffffff]) {
      for (let length = 0; length < 140; length++) {
        const payload = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
        const decoded = readEnvelope(encodeEnvelope(9, payload, seed)).payload;
        expect(Array.from(decoded)).toEqual(Array.from(payload));
      }
    }
  });

  it("rejette la corruption, la troncature et les en-têtes invalides", () => {
    const file = fromHex(vectors[0].file);
    for (let i = 20; i < file.length; i += 17) {
      const corrupted = file.slice();
      corrupted[i] ^= 1;
      expect(() => readEnvelope(corrupted)).toThrow(ContainerError);
    }
    expect(() => readEnvelope(file.slice(0, 10))).toThrow(ContainerError);
    expect(() => readEnvelope(file.slice(0, file.length - 1))).toThrow(ContainerError);
    const badMagic = file.slice();
    badMagic[0] = 0x58;
    expect(() => readEnvelope(badMagic)).toThrow(/Signature/);
    expect(() => readEnvelope(file, 4)).toThrow(/trop grande/);
  });

  it("encode du JSON lisible par le décodeur", () => {
    const value = { gameMap: "demo", points: [{ id: 1, x: 12.5, y: -3 }] };
    expect(decodeJsonContainer(encodeJson(value, 7))).toEqual(value);
  });
});
