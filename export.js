'use strict';

const ImageExport = (() => {
  const dpi = 300;
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({length: 256}, (_, byte) => {
    for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
    return byte >>> 0;
  });

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dimensions(canvas, longEdge) {
    const scale = longEdge ? longEdge / Math.max(canvas.width, canvas.height) : 1;
    return {
      width: Math.max(1, Math.round(canvas.width * scale)),
      height: Math.max(1, Math.round(canvas.height * scale))
    };
  }

  function pngWithDpi(bytes) {
    const density = new Uint8Array(21);
    const header = new DataView(density.buffer);
    header.setUint32(0, 9);
    density.set(encoder.encode('pHYs'), 4);
    const pixelsPerMetre = Math.round(dpi / 0.0254);
    header.setUint32(8, pixelsPerMetre);
    header.setUint32(12, pixelsPerMetre);
    density[16] = 1;
    header.setUint32(17, crc32(density.subarray(4, 17)));
    const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts = [bytes.subarray(0, 8)];
    for (let start = 8; start + 12 <= bytes.length;) {
      const end = start + input.getUint32(start) + 12;
      if (end > bytes.length) throw new Error('Invalid PNG chunk');
      const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
      if (type !== 'pHYs') parts.push(bytes.subarray(start, end));
      if (type === 'IHDR') parts.push(density);
      start = end;
    }
    return new Blob(parts, {type: 'image/png'});
  }

  function jpegWithDpi(bytes) {
    const jfif = Uint8Array.of(255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 1, 1, 44, 1, 44, 0, 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let marker = 2; marker + 4 < bytes.length && bytes[marker] === 255;) {
      const id = bytes[marker + 1];
      if (id === 218 || id === 217) break;
      const size = view.getUint16(marker + 2);
      if (size < 2 || marker + 2 + size > bytes.length) break;
      if (id === 224 && size >= 16 && bytes.subarray(marker + 4, marker + 9).every((byte, i) => byte === jfif[i + 4])) {
        bytes[marker + 11] = 1; // JFIF density units are dots per inch.
        view.setUint16(marker + 12, dpi);
        view.setUint16(marker + 14, dpi);
        return new Blob([bytes], {type: 'image/jpeg'});
      }
      marker += 2 + size;
    }
    return new Blob([bytes.subarray(0, 2), jfif, bytes.subarray(2)], {type: 'image/jpeg'});
  }

  function encodeTiff({width, height, data}) {
    // Baseline RGB TIFF: one uncompressed strip, with resolution in inches.
    const directoryOffset = 8;
    const tagCount = 13;
    const bitsOffset = directoryOffset + 2 + tagCount * 12 + 4;
    const xResolutionOffset = bitsOffset + 6;
    const yResolutionOffset = xResolutionOffset + 8;
    const pixelOffset = yResolutionOffset + 8;
    const header = new Uint8Array(pixelOffset);
    const view = new DataView(header.buffer);
    view.setUint16(0, 0x4949, true);
    view.setUint16(2, 42, true);
    view.setUint32(4, directoryOffset, true);
    view.setUint16(directoryOffset, tagCount, true);
    const tags = [
      [256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, bitsOffset],
      [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, pixelOffset],
      [277, 3, 1, 3], [278, 4, 1, height], [279, 4, 1, width * height * 3],
      [282, 5, 1, xResolutionOffset], [283, 5, 1, yResolutionOffset],
      [284, 3, 1, 1], [296, 3, 1, 2]
    ];
    tags.forEach(([tag, type, count, value], i) => {
      const offset = directoryOffset + 2 + i * 12;
      view.setUint16(offset, tag, true);
      view.setUint16(offset + 2, type, true);
      view.setUint32(offset + 4, count, true);
      view.setUint32(offset + 8, value, true);
    });
    for (let i = 0; i < 3; i++) view.setUint16(bitsOffset + i * 2, 8, true);
    for (const offset of [xResolutionOffset, yResolutionOffset]) {
      view.setUint32(offset, dpi, true);
      view.setUint32(offset + 4, 1, true);
    }
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4) {
      rgb[j++] = data[i];
      rgb[j++] = data[i + 1];
      rgb[j++] = data[i + 2];
    }
    return new Blob([header, rgb], {type: 'image/tiff'});
  }

  async function encode(source, {format, longEdge, quality}) {
    const {width, height} = dimensions(source, longEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    try {
      if (format === 'tiff') return encodeTiff(context.getImageData(0, 0, width, height));
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
      if (blob?.type !== mime) throw new Error('Canvas encoding failed');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return format === 'jpg' ? jpegWithDpi(bytes) : pngWithDpi(bytes);
    } finally {
      canvas.width = canvas.height = 1;
    }
  }

  async function zip(files) {
    // ZIP uses stored entries, keeping the encoded image bytes intact.
    const fileParts = [], directoryParts = [];
    let fileOffset = 0, directorySize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      const checksum = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names.
      local.setUint16(12, 33, true); // DOS date: 1980-01-01.
      local.setUint32(14, checksum, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, name.length, true);
      fileParts.push(local.buffer, name, file.blob);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      new Uint8Array(central.buffer).set(new Uint8Array(local.buffer, 4, 26), 6);
      central.setUint32(42, fileOffset, true);
      directoryParts.push(central.buffer, name);
      fileOffset += local.byteLength + name.length + bytes.length;
      directorySize += central.byteLength + name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, fileOffset, true);
    return new Blob([...fileParts, ...directoryParts, end.buffer], {type: 'application/zip'});
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  return {dimensions, encode, zip, download};
})();
