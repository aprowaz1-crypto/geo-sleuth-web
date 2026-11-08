// Minimal JPEG EXIF parser (GPS + metadata). Returns an object or null.
(function (global) {
  'use strict';

  function readU16(buf, off, le) {
    return le ? (buf[off] | (buf[off + 1] << 8)) : ((buf[off] << 8) | buf[off + 1]);
  }
  function readU32(buf, off, le) {
    return le
      ? (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
      : ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  }
  function readRational(buf, off, le) {
    const num = readU32(buf, off, le);
    const den = readU32(buf, off + 4, le);
    return den === 0 ? 0 : num / den;
  }

  const TAGS = {
    0x010f: 'make',
    0x0110: 'model',
    0x0132: 'dateTime',
    0x829a: 'exposureTime',
    0x829d: 'fNumber',
    0x8827: 'iso',
    0x9003: 'dateTimeOriginal',
    0x9004: 'dateTimeDigitized',
    0x920a: 'focalLength',
    0x9214: 'subjectDistance',
    0xa405: 'focalLength35mm',
    // GPS
    0x0001: 'gpsLatitudeRef',
    0x0002: 'gpsLatitude',
    0x0003: 'gpsLongitudeRef',
    0x0004: 'gpsLongitude',
    0x0005: 'gpsAltitudeRef',
    0x0006: 'gpsAltitude',
    0x001d: 'gpsDateStamp',
    0x0007: 'gpsTimeStamp',
  };

  function parseIfd(buf, tiffStart, ifdOffset, le, exif) {
    if (ifdOffset + 2 > buf.length) return;
    const count = readU16(buf, tiffStart + ifdOffset, le);
    let off = tiffStart + ifdOffset + 2;
    for (let i = 0; i < count; i++) {
      if (off + 12 > buf.length) break;
      const tag = readU16(buf, off, le);
      const type = readU16(buf, off + 2, le);
      const cnt = readU32(buf, off + 4, le);
      const valOff = off + 8;
      const name = TAGS[tag];
      if (name) {
        // type 2 = ASCII, 3 = SHORT, 4 = LONG, 5 = RATIONAL, 7 = UNDEFINED, 10 = SRATIONAL
        if (type === 2) {
          let str = '';
          let p = valOff;
          if (cnt > 4) p = tiffStart + readU32(buf, valOff, le);
          for (let j = 0; j < cnt - 1 && p + j < buf.length; j++) {
            const ch = buf[p + j];
            if (ch === 0) break;
            str += String.fromCharCode(ch);
          }
          exif[name] = str.trim();
        } else if (type === 3) {
          exif[name] = readU16(buf, valOff, le);
        } else if (type === 4) {
          exif[name] = readU32(buf, valOff, le);
        } else if (type === 5) {
          let p = valOff;
          if (cnt * 8 > 4) p = tiffStart + readU32(buf, valOff, le);
          const vals = [];
          for (let j = 0; j < cnt; j++) vals.push(readRational(buf, p + j * 8, le));
          exif[name] = cnt === 1 ? vals[0] : vals;
        } else if (type === 10) {
          let p = valOff;
          if (cnt * 8 > 4) p = tiffStart + readU32(buf, valOff, le);
          const vals = [];
          for (let j = 0; j < cnt; j++) {
            const num = readU32(buf, p + j * 8, le);
            const den = readU32(buf, p + j * 8 + 4, le);
            const sn = num > 0x7fffffff ? num - 0x100000000 : num;
            vals.push(den === 0 ? 0 : sn / den);
          }
          exif[name] = cnt === 1 ? vals[0] : vals;
        } else if (type === 7) {
          // undefined / bytes
          let p = valOff;
          if (cnt > 4) p = tiffStart + readU32(buf, valOff, le);
          const bytes = [];
          for (let j = 0; j < Math.min(cnt, 64) && p + j < buf.length; j++) bytes.push(buf[p + j]);
          exif[name] = bytes;
        }
      }
      // handle sub-IFDs
      if (tag === 0x8769 || tag === 0x8825) {
        const subOff = readU32(buf, valOff, le);
        parseIfd(buf, tiffStart, subOff, le, exif);
      }
      off += 12;
    }
  }

  function dmsToDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    let deg = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === 'S' || ref === 'W') deg = -deg;
    return deg;
  }

  function parseExif(buffer) {
    const buf = new Uint8Array(buffer);
    const exif = {};
    // Find APP1 marker
    let i = 2; // skip SOI
    while (i < buf.length - 4) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xe1) {
        const len = (buf[i + 2] << 8) | buf[i + 3];
        // check Exif header
        if (buf[i + 4] === 0x45 && buf[i + 5] === 0x78 && buf[i + 6] === 0x69 && buf[i + 7] === 0x66) {
          const tiffStart = i + 10;
          const le = buf[tiffStart] === 0x49 && buf[tiffStart + 1] === 0x49;
          const magic = readU16(buf, tiffStart + 2, le);
          if (magic === 42) {
            const ifdOffset = readU32(buf, tiffStart + 4, le);
            parseIfd(buf, tiffStart, ifdOffset, le, exif);
          }
        }
        i += 2 + len;
      } else if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
      } else if (marker >= 0xd0 && marker <= 0xd9) {
        i += 2;
      } else if (marker === 0xff) {
        i++;
      } else {
        const len = (buf[i + 2] << 8) | buf[i + 3];
        i += 2 + (len || 2);
      }
    }
    // Convert GPS
    if (exif.gpsLatitude && exif.gpsLongitude) {
      exif.lat = dmsToDecimal(exif.gpsLatitude, exif.gpsLatitudeRef || 'N');
      exif.lon = dmsToDecimal(exif.gpsLongitude, exif.gpsLongitudeRef || 'E');
    }
    if (exif.gpsAltitude !== undefined) {
      let alt = exif.gpsAltitude;
      if (exif.gpsAltitudeRef === 1) alt = -alt;
      exif.alt = alt;
    }
    return exif;
  }

  global.GeoExif = { parseExif, dmsToDecimal };
})(window);
