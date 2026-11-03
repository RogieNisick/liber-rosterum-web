// .rosz = zip с одним .ros (XML). Чтение — через DecompressionStream, запись — без сжатия (store), её открывают BattleScribe и New Recruit.
const Zip = (() => {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не умеет распаковывать zip — обновите iOS до 16.4+');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([data]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** Достать первый .ros из архива (или первый файл). */
  async function readRos(buf) {
    const b = new Uint8Array(buf);
    if (!(b[0] === 0x50 && b[1] === 0x4B)) return b; // это сразу .ros
    const v = new DataView(buf instanceof ArrayBuffer ? buf : b.buffer);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Битый архив');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    let first = null;
    for (let k = 0; k < count; k++) {
      if (v.getUint32(p, true) !== 0x02014B50) break;
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      const lho = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const lnlen = v.getUint16(lho + 26, true), lxlen = v.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lxlen;
      const raw = b.subarray(start, start + csize);
      const body = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      if (!body) continue;
      if (name.toLowerCase().endsWith('.ros')) return body;
      if (!first) first = body;
    }
    if (first) return first;
    throw new Error('В архиве нет файла .ros');
  }

  function write(fileName, data) {
    const name = new TextEncoder().encode(fileName);
    const crc = crc32(data);
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034B50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014B50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, 0, true);
    const cdOff = 30 + name.length + data.length, cdLen = 46 + name.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
    end.setUint32(12, cdLen, true); end.setUint32(16, cdOff, true);
    return new Blob([lh, name, data, cd, name, end], { type: 'application/zip' });
  }

  return { readRos, write };
})();
