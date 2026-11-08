// Geo-Sleuth Web — dependency-free EXIF/TIFF reader.
// Supports JPEG (APP1/Exif), PNG (eXIf chunk), WebP (EXIF chunk) and raw TIFF.
(function (global) {
  'use strict';

  function readU16(buf, off, le) {
    if (off + 2 > buf.length) return 0;
    return le ? (buf[off] | (buf[off + 1] << 8)) : ((buf[off] << 8) | buf[off + 1]);
  }
  function readS16(buf, off, le) {
    const v = readU16(buf, off, le);
    return v > 0x7fff ? v - 0x10000 : v;
  }
  function readU32(buf, off, le) {
    if (off + 4 > buf.length) return 0;
    return le
      ? (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
      : ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  }
  function readS32(buf, off, le) {
    const v = readU32(buf, off, le);
    return v > 0x7fffffff ? v - 0x100000000 : v;
  }
  function readRational(buf, off, le, signed) {
    if (off + 8 > buf.length) return 0;
    const num = signed ? readS32(buf, off, le) : readU32(buf, off, le);
    const den = signed ? readS32(buf, off + 4, le) : readU32(buf, off + 4, le);
    return den === 0 ? 0 : num / den;
  }

  const TAGS = {
    0x0100: 'imageWidth', 0x0101: 'imageHeight', 0x010e: 'imageDescription',
    0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation',
    0x011a: 'xResolution', 0x011b: 'yResolution', 0x0128: 'resolutionUnit',
    0x0131: 'software', 0x0132: 'dateTime', 0x013b: 'artist', 0x8298: 'copyright',
    0x0213: 'yCbCrPositioning',
    0x829a: 'exposureTime', 0x829d: 'fNumber', 0x8822: 'exposureProgram',
    0x8827: 'iso', 0x8830: 'sensitivityType', 0x8832: 'recommendedExposureIndex',
    0x9000: 'exifVersion', 0x9003: 'dateTimeOriginal', 0x9004: 'dateTimeDigitized',
    0x9010: 'offsetTime', 0x9011: 'offsetTimeOriginal', 0x9012: 'offsetTimeDigitized',
    0x9101: 'componentsConfiguration',
    0x9201: 'shutterSpeedValue', 0x9202: 'apertureValue', 0x9203: 'brightnessValue',
    0x9204: 'exposureBias', 0x9205: 'maxAperture', 0x9206: 'subjectDistance',
    0x9207: 'meteringMode', 0x9208: 'lightSource', 0x9209: 'flash',
    0x920a: 'focalLength', 0x9214: 'subjectArea',
    0x9286: 'userComment', 0x9290: 'subSecTime', 0x9291: 'subSecTimeOriginal',
    0x9292: 'subSecTimeDigitized',
    0xa000: 'flashpixVersion', 0xa001: 'colorSpace',
    0xa002: 'pixelXDimension', 0xa003: 'pixelYDimension',
    0xa401: 'customRendered', 0xa402: 'exposureMode', 0xa403: 'whiteBalance',
    0xa404: 'digitalZoomRatio', 0xa405: 'focalLength35mm', 0xa406: 'sceneCaptureType',
    0xa407: 'gainControl', 0xa408: 'contrast', 0xa409: 'saturation', 0xa40a: 'sharpness',
    0xa40c: 'subjectDistanceRange', 0xa420: 'imageUniqueID',
    0xa430: 'ownerName', 0xa431: 'serialNumber', 0xa432: 'lensSpecification',
    0xa433: 'lensMake', 0xa434: 'lensModel', 0xa435: 'lensSerialNumber',
    0xa460: 'compositeImage',
    // GPS
    0x0000: 'gpsVersionID', 0x0001: 'gpsLatitudeRef', 0x0002: 'gpsLatitude',
    0x0003: 'gpsLongitudeRef', 0x0004: 'gpsLongitude', 0x0005: 'gpsAltitudeRef',
    0x0006: 'gpsAltitude', 0x0007: 'gpsTimeStamp', 0x0008: 'gpsSatellites',
    0x0009: 'gpsStatus', 0x000a: 'gpsMeasureMode', 0x000b: 'gpsDOP',
    0x000c: 'gpsSpeed', 0x000d: 'gpsSpeedRef', 0x000e: 'gpsTrack',
    0x000f: 'gpsTrackRef', 0x0010: 'gpsImgDirectionRef', 0x0011: 'gpsImgDirection',
    0x0012: 'gpsMapDatum', 0x0013: 'gpsDestLatitudeRef', 0x0014: 'gpsDestLatitude',
    0x0015: 'gpsDestLongitudeRef', 0x0016: 'gpsDestLongitude',
    0x0017: 'gpsDestBearingRef', 0x0018: 'gpsDestBearing',
    0x0019: 'gpsDestDistanceRef', 0x001a: 'gpsDestDistance',
    0x001b: 'gpsProcessingMethod', 0x001c: 'gpsAreaInformation',
    0x001d: 'gpsDateStamp', 0x001e: 'gpsDifferential',
    0x001f: 'gpsHPositioningError',
  };

  function ascii(buf, off, count) {
    let s = '';
    const end = Math.min(off + count, buf.length);
    for (let i = off; i < end; i++) {
      if (buf[i] === 0) break;
      s += String.fromCharCode(buf[i]);
    }
    return s.trim();
  }

  function readValue(buf, type, count, valueOff, tiffStart, le) {
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
    const size = (sizes[type] || 1) * count;
    let off = valueOff;
    if (size > 4) off = tiffStart + readU32(buf, valueOff, le);
    if (type === 2) return ascii(buf, off, count);
    if (type === 7) {
      const bytes = [];
      for (let i = 0; i < Math.min(count, 128) && off + i < buf.length; i++) bytes.push(buf[off + i]);
      return bytes;
    }
    const values = [];
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 1: values.push(buf[off + i] || 0); break;
        case 3: values.push(readU16(buf, off + i * 2, le)); break;
        case 4: values.push(readU32(buf, off + i * 4, le)); break;
        case 5: values.push(readRational(buf, off + i * 8, le, false)); break;
        case 6: values.push(buf[off + i] > 127 ? buf[off + i] - 256 : buf[off + i]); break;
        case 8: values.push(readS16(buf, off + i * 2, le)); break;
        case 9: values.push(readS32(buf, off + i * 4, le)); break;
        case 10: values.push(readRational(buf, off + i * 8, le, true)); break;
        case 11: {
          const dv = new DataView(buf.buffer, buf.byteOffset + off + i * 4, 4);
          values.push(dv.getFloat32(0, le));
          break;
        }
        case 12: {
          const dv = new DataView(buf.buffer, buf.byteOffset + off + i * 8, 8);
          values.push(dv.getFloat64(0, le));
          break;
        }
        case 13: values.push(readU32(buf, off + i * 4, le)); break;
        default: values.push(null);
      }
    }
    return count === 1 ? values[0] : values;
  }

  function parseIfd(buf, tiffStart, ifdOffset, le, out, depth, visited) {
    if (depth > 6) return;
    const base = tiffStart + ifdOffset;
    if (base + 2 > buf.length) return;
    const key = base + ':' + le;
    if (visited.has(key)) return;
    visited.add(key);
    const count = readU16(buf, base, le);
    if (count > 512) return;
    let off = base + 2;
    for (let i = 0; i < count; i++) {
      if (off + 12 > buf.length) break;
      const tag = readU16(buf, off, le);
      const type = readU16(buf, off + 2, le);
      const cnt = readU32(buf, off + 4, le);
      const valueOff = off + 8;
      const name = TAGS[tag];
      if (name && cnt > 0 && cnt < 100000) {
        try {
          out[name] = readValue(buf, type, cnt, valueOff, tiffStart, le);
        } catch (e) { /* ignore malformed tag */ }
      }
      // nested IFDs: Exif, GPS, Interop
      if (tag === 0x8769 || tag === 0x8825 || tag === 0xa005) {
        const subOffset = readU32(buf, valueOff, le);
        if (subOffset > 0) parseIfd(buf, tiffStart, subOffset, le, out, depth + 1, visited);
      }
      off += 12;
    }
  }

  function parseTiff(buf, tiffStart, out) {
    if (tiffStart + 8 > buf.length) return out;
    const b0 = buf[tiffStart];
    const b1 = buf[tiffStart + 1];
    if (!((b0 === 0x49 && b1 === 0x49) || (b0 === 0x4d && b1 === 0x4d))) return out;
    const le = b0 === 0x49;
    if (readU16(buf, tiffStart + 2, le) !== 42) return out;
    const ifdOffset = readU32(buf, tiffStart + 4, le);
    if (ifdOffset < 8 || ifdOffset > buf.length) return out;
    parseIfd(buf, tiffStart, ifdOffset, le, out, 0, new Set());
    return out;
  }

  function parseJpeg(buf) {
    const out = {};
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return out;
    let i = 2;
    while (i < buf.length - 4) {
      if (buf[i] !== 0xff) { i++; continue; }
      let marker = buf[i + 1];
      while (marker === 0xff && i + 2 < buf.length) { i++; marker = buf[i + 1]; }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if (len < 2) break;
      if (marker === 0xe1 && i + 10 < buf.length) {
        if (buf[i + 4] === 0x45 && buf[i + 5] === 0x78 && buf[i + 6] === 0x69 && buf[i + 7] === 0x66) {
          parseTiff(buf, i + 10, out);
        }
      }
      i += 2 + len;
    }
    return out;
  }

  function parsePng(buf) {
    const out = {};
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return out;
    let off = 8;
    while (off + 12 <= buf.length) {
      const len = readU32(buf, off, false);
      const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
      const dataStart = off + 8;
      if (type === 'eXIf' && dataStart + len <= buf.length) {
        parseTiff(buf, dataStart, out);
      }
      off = dataStart + len + 4;
      if (len > buf.length) break;
    }
    return out;
  }

  function parseWebp(buf) {
    const out = {};
    if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'RIFF') return out;
    if (String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== 'WEBP') return out;
    let off = 12;
    while (off + 8 <= buf.length) {
      const type = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
      const len = readU32(buf, off + 4, true);
      const dataStart = off + 8;
      if (type === 'EXIF' && dataStart + len <= buf.length) {
        let tiffStart = dataStart;
        if (buf[tiffStart] === 0x45 && buf[tiffStart + 1] === 0x78 && buf[tiffStart + 2] === 0x69 && buf[tiffStart + 3] === 0x66) {
          tiffStart += 6;
        }
        parseTiff(buf, tiffStart, out);
      }
      off = dataStart + len + (len % 2);
      if (len > buf.length) break;
    }
    return out;
  }

  function dmsToDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    let deg = Number(dms[0]) + Number(dms[1]) / 60 + Number(dms[2]) / 3600;
    if (!Number.isFinite(deg)) return null;
    if (ref === 'S' || ref === 'W' || ref === 's' || ref === 'w') deg = -deg;
    return deg;
  }

  function finalize(exif) {
    const out = exif;
    if (out.gpsLatitude !== undefined && out.gpsLongitude !== undefined) {
      const lat = dmsToDecimal(out.gpsLatitude, out.gpsLatitudeRef || 'N');
      const lon = dmsToDecimal(out.gpsLongitude, out.gpsLongitudeRef || 'E');
      if (lat !== null && lon !== null) {
        out.lat = lat;
        out.lon = lon;
      }
    }
    if (out.gpsAltitude !== undefined) {
      let alt = Array.isArray(out.gpsAltitude) ? out.gpsAltitude[0] : out.gpsAltitude;
      alt = Number(alt);
      if (Number.isFinite(alt)) {
        if (out.gpsAltitudeRef === 1) alt = -alt;
        out.alt = alt;
      }
    }
    if (Array.isArray(out.gpsTimeStamp) && out.gpsTimeStamp.length >= 3) {
      const pad = (n) => String(Math.floor(n)).padStart(2, '0');
      out.gpsTime = `${pad(out.gpsTimeStamp[0])}:${pad(out.gpsTimeStamp[1])}:${pad(out.gpsTimeStamp[2])}`;
    }
    if (Array.isArray(out.gpsDateStamp)) {
      out.gpsDate = out.gpsDateStamp.map((n) => String(n).padStart(2, '0')).join(':');
    } else if (typeof out.gpsDateStamp === 'string') {
      out.gpsDate = out.gpsDateStamp.replace(/\0/g, '').trim();
    }
    if (Array.isArray(out.gpsImgDirection)) {
      out.heading = Number(out.gpsImgDirection[0]);
    } else if (typeof out.gpsImgDirection === 'number') {
      out.heading = out.gpsImgDirection;
    }
    if (Array.isArray(out.gpsHPositioningError)) {
      out.gpsAccuracy = Number(out.gpsHPositioningError[0]);
    } else if (typeof out.gpsHPositioningError === 'number') {
      out.gpsAccuracy = out.gpsHPositioningError;
    }
    if (Array.isArray(out.lensSpecification) && out.lensSpecification.length >= 4) {
      const l = out.lensSpecification;
      out.lensSpec = `${l[0]}-${l[1]}mm f/${l[2]}-${l[3]}`;
    }
    if (Array.isArray(out.subjectDistance) && out.subjectDistance.length === 1) {
      out.subjectDistance = out.subjectDistance[0];
    }
    return out;
  }

  function parseExif(input) {
    if (!input) return {};
    let buf;
    if (input instanceof Uint8Array) buf = input;
    else if (input instanceof ArrayBuffer) buf = new Uint8Array(input);
    else if (ArrayBuffer.isView(input)) buf = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else return {};
    if (buf.length < 8) return {};

    let exif = {};
    if (buf[0] === 0xff && buf[1] === 0xd8) exif = parseJpeg(buf);
    else if (buf[0] === 0x89 && buf[1] === 0x50) exif = parsePng(buf);
    else if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === 'RIFF') exif = parseWebp(buf);
    else if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4d && buf[1] === 0x4d)) exif = parseTiff(buf, 0, {});
    return finalize(exif);
  }

  global.GeoExif = { parseExif, dmsToDecimal, version: '2.0.0' };
})(window);
