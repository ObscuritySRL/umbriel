// Minimal pure-TS PNG encoder (adapted from @bun-win32/terminal's png.ts) for PrintWindow screenshots.
// `Bun.deflateSync` returns a raw DEFLATE stream, so the IDAT payload is hand-wrapped in a zlib
// container (0x78 0x01 + data + Adler-32 of the unfiltered scanlines).

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) value = crcTable[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array): number => {
  let low = 1;
  let high = 0;
  for (let index = 0; index < bytes.length; index++) {
    low = (low + bytes[index]!) % 65521;
    high = (high + low) % 65521;
  }
  return ((high << 16) | low) >>> 0;
};

const uint32BigEndian = (value: number): Uint8Array => Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const chunk = new Uint8Array(4 + body.length + 4);
  chunk.set(uint32BigEndian(data.length), 0);
  chunk.set(body, 4);
  chunk.set(uint32BigEndian(crc32(body)), 4 + body.length);
  return chunk;
};

/** Decode a PNG byte array to a tightly packed width×height RGB8 buffer — the inbound counterpart of encodePNG, so a
 *  caller can hand a saved/base64 PNG (an icon/button template) to the image-matching tools. Pure TS, no binding:
 *  Bun.inflateSync is RAW deflate, so the IDAT zlib stream is stripped of its 2-byte header + 4-byte Adler trailer
 *  first. Supports 8-bit color types 0 (gray) / 2 (RGB) / 3 (palette) / 6 (RGBA), non-interlaced, all 5 row filters.
 *  Throws a steered error on anything unsupported (16-bit, interlaced) rather than silently mis-decoding. */
export const decodePNG = (bytes: Uint8Array): { rgb: Uint8Array; width: number; height: number } => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error('decodePNG: not a PNG (bad signature)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) throw new Error('decodePNG: truncated chunk');
    if (type === 'IHDR') {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataStart + length);
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // skip the chunk's data + 4-byte CRC
  }

  if (width <= 0 || height <= 0) throw new Error('decodePNG: missing or empty IHDR');
  if (bitDepth !== 8) throw new Error(`decodePNG: only 8-bit channels are supported (got bitDepth ${bitDepth}); re-export the PNG as 8-bit`);
  if (interlace !== 0) throw new Error('decodePNG: interlaced (Adam7) PNG is not supported; re-export non-interlaced');
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 3 ? 1 : 0;
  if (channels === 0) throw new Error(`decodePNG: unsupported color type ${colorType} (need 0 gray / 2 RGB / 3 palette / 6 RGBA)`);
  if (colorType === 3 && palette === null) throw new Error('decodePNG: palette image (color type 3) is missing its PLTE chunk');

  let idatLength = 0;
  for (const part of idatParts) idatLength += part.length;
  if (idatLength < 6) throw new Error('decodePNG: missing or too-short IDAT data');
  const zlib = new Uint8Array(idatLength);
  for (let offset = 0, index = 0; index < idatParts.length; index += 1) {
    zlib.set(idatParts[index]!, offset);
    offset += idatParts[index]!.length;
  }
  if ((zlib[1]! & 0x20) !== 0) throw new Error('decodePNG: zlib preset dictionary (FDICT) is not supported');
  const raw = Bun.inflateSync(zlib.subarray(2, zlib.length - 4)); // Bun.inflateSync is RAW deflate: drop the 2-byte zlib header + 4-byte Adler-32 trailer

  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  if (raw.length < height * (stride + 1)) throw new Error(`decodePNG: inflated ${raw.length} bytes < expected ${height * (stride + 1)}`);
  const channelData = new Uint8Array(height * stride);
  let previous = new Uint8Array(stride); // the row above, zero for row 0
  for (let row = 0, source = 0; row < height; row += 1) {
    const filter = raw[source]!;
    source += 1;
    const current = channelData.subarray(row * stride, row * stride + stride);
    current.set(raw.subarray(source, source + stride));
    source += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? current[index - bytesPerPixel]! : 0;
      const up = previous[index]!;
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;
      let value = current[index]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const predict = left + up - upLeft;
        const distLeft = Math.abs(predict - left);
        const distUp = Math.abs(predict - up);
        const distUpLeft = Math.abs(predict - upLeft);
        value += distLeft <= distUp && distLeft <= distUpLeft ? left : distUp <= distUpLeft ? up : upLeft;
      } else if (filter !== 0) throw new Error(`decodePNG: unknown row filter ${filter}`);
      current[index] = value & 0xff;
    }
    previous = current;
  }

  const rgb = new Uint8Array(width * height * 3);
  const pixels = width * height;
  if (colorType === 2) {
    rgb.set(channelData);
  } else if (colorType === 6) {
    for (let pixel = 0, target = 0; pixel < pixels; pixel += 1) {
      rgb[target++] = channelData[pixel * 4]!;
      rgb[target++] = channelData[pixel * 4 + 1]!;
      rgb[target++] = channelData[pixel * 4 + 2]!;
    }
  } else if (colorType === 0) {
    for (let pixel = 0, target = 0; pixel < pixels; pixel += 1) {
      const gray = channelData[pixel]!;
      rgb[target++] = gray;
      rgb[target++] = gray;
      rgb[target++] = gray;
    }
  } else {
    for (let pixel = 0, target = 0; pixel < pixels; pixel += 1) {
      const entry = channelData[pixel]! * 3;
      rgb[target++] = palette![entry]!;
      rgb[target++] = palette![entry + 1]!;
      rgb[target++] = palette![entry + 2]!;
    }
  }
  return { rgb, width, height };
};

/** Encode a tightly packed width×height RGB8 buffer to a PNG byte array. */
export const encodePNG = (rgbPixels: Uint8Array, width: number, height: number): Uint8Array => {
  const scanlineLength = 1 + width * 3;
  const filtered = new Uint8Array(height * scanlineLength);
  for (let row = 0; row < height; row++) {
    filtered[row * scanlineLength] = 0;
    filtered.set(rgbPixels.subarray(row * width * 3, (row + 1) * width * 3), row * scanlineLength + 1);
  }
  const deflated = Bun.deflateSync(filtered);
  const zlib = new Uint8Array(2 + deflated.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  zlib.set(deflated, 2);
  zlib.set(uint32BigEndian(adler32(filtered)), 2 + deflated.length);
  const headerData = new Uint8Array(13);
  headerData.set(uint32BigEndian(width), 0);
  headerData.set(uint32BigEndian(height), 4);
  headerData[8] = 8;
  headerData[9] = 2;
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const chunks = [signature, pngChunk('IHDR', headerData), pngChunk('IDAT', zlib), pngChunk('IEND', new Uint8Array(0))];
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  const png = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
};
