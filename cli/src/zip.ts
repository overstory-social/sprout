import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// A zip container, the small part of it (PKWARE APPNOTE 4.4.x): local
// file headers, a central directory, the end record. Enough to pack a
// folder of text files and read one back — stored and deflate entries,
// no encryption, no zip64, no data descriptors. Written by hand rather
// than taken as a dependency, because a microworld archive is a few
// hundred kilobytes of text and the CLI's runtime imports are the Sprout
// packages, PGlite and node:*.

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** 1980-01-01 00:00 in DOS date/time: a pack is the same bytes for the same files. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** The bytes of a zip holding `entries`, each deflated, in the order given. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const packed = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: names are utf-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

/** The entries of a zip, files only, in directory order. */
export function readZip(bytes: Buffer): ZipEntry[] {
  // The end record is the last 22 bytes, plus a comment of up to 64 KiB before it.
  let at = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (bytes.readUInt32LE(i) === END) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error('not a zip file (no end record)');
  const count = bytes.readUInt16LE(at + 10);
  let p = bytes.readUInt32LE(at + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (bytes.readUInt32LE(p) !== CENTRAL)
      throw new Error('not a zip file (bad central directory)');
    const method = bytes.readUInt16LE(p + 10);
    const crc = bytes.readUInt32LE(p + 16);
    const csize = bytes.readUInt32LE(p + 20);
    const usize = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const localAt = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (bytes.readUInt32LE(localAt) !== LOCAL)
      throw new Error(`not a zip file (bad entry ${name})`);
    const dataAt =
      localAt + 30 + bytes.readUInt16LE(localAt + 26) + bytes.readUInt16LE(localAt + 28);
    const packed = bytes.subarray(dataAt, dataAt + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(packed);
    else if (method === 8) data = inflateRawSync(packed);
    else
      throw new Error(`${name}: compression method ${method} is not supported (stored or deflate)`);
    if (data.length !== usize || crc32(data) !== crc)
      throw new Error(`${name}: the entry is corrupt`);
    out.push({ name, data });
  }
  return out;
}
