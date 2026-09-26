// Decodes the parts of a Metaplex Token Metadata account the report needs:
// name, symbol, uri, update authority and whether it can still be changed.
// Returns null for anything that doesn't look like a valid MetadataV1 account.

import { getBase58Decoder } from "@solana/kit";

const base58 = getBase58Decoder();
const METADATA_V1_KEY = 4;

export function decodeMetaplexMetadata(bytes) {
  try {
    const buf = Buffer.from(bytes);
    let o = 0;
    const need = (n) => {
      if (o + n > buf.length) throw new Error("truncated");
    };
    need(1);
    const key = buf[o];
    o += 1;
    if (key !== METADATA_V1_KEY) return null;

    need(64);
    const updateAuthority = base58.decode(buf.subarray(o, o + 32));
    o += 64; // update authority + mint

    const readString = (max) => {
      need(4);
      const len = buf.readUInt32LE(o);
      o += 4;
      if (len > max) throw new Error("string too long");
      need(len);
      const s = buf.subarray(o, o + len).toString("utf8").replace(/\0+$/g, "").trim();
      o += len;
      return s;
    };
    const name = readString(200);
    const symbol = readString(50);
    const uri = readString(400);

    need(2);
    o += 2; // seller fee basis points

    need(1);
    const hasCreators = buf[o];
    o += 1;
    if (hasCreators === 1) {
      need(4);
      const count = buf.readUInt32LE(o);
      o += 4;
      if (count > 10) throw new Error("too many creators");
      need(count * 34);
      o += count * 34;
    } else if (hasCreators !== 0) {
      throw new Error("bad option flag");
    }

    need(2);
    o += 1; // primary sale happened
    const isMutable = buf[o] === 1;

    return { name, symbol, uri, updateAuthority, isMutable, standard: "metaplex" };
  } catch {
    return null;
  }
}
