// Boot splash image: custom data block type 1 (OpenDMR src/services/custom_data.h CUSTOM_DATA_TYPE_BOOT_IMAGE,
// src/app/boot_screen.c), 240 x 320 portrait, 4-bit indexed palette (16 colours):
//   32 bytes palette (16 x uint16 LE, native BGR565 byte-swapped as panel_rgb888_to_native())
//   38400 bytes pixels (2 pixels per byte: high nibble = even x, low nibble = odd x)

export const BOOT_IMAGE_BLOCK_TYPE = 1;
export const BOOT_WIDTH = 240;
export const BOOT_HEIGHT = 320;
export const BOOT_PALETTE_COLORS = 16;
export const BOOT_PALETTE_BYTES = BOOT_PALETTE_COLORS * 2; // 32
export const BOOT_PIXEL_BYTES = (BOOT_WIDTH * BOOT_HEIGHT) / 2; // 38400
export const BOOT_IMAGE_BLOCK_LENGTH = BOOT_PALETTE_BYTES + BOOT_PIXEL_BYTES; // 38432

export function rgbToNativeBgr565(r, g, b) {
    const bgr565 = ((r & 0xF8) >> 3) | ((g & 0xFC) << 3) | ((b & 0xF8) << 8);
    return ((bgr565 & 0xFF) << 8) | ((bgr565 >> 8) & 0xFF);
}

export function nativeBgr565ToRgb(nativeVal) {
    const bgr565 = ((nativeVal & 0xFF) << 8) | ((nativeVal >> 8) & 0xFF);
    const r5 = bgr565 & 0x1F;
    const g6 = (bgr565 >> 5) & 0x3F;
    const b5 = (bgr565 >> 11) & 0x1F;
    return [
        (r5 << 3) | (r5 >> 2),
        (g6 << 2) | (g6 >> 4),
        (b5 << 3) | (b5 >> 2),
    ];
}

// Validates whether a block's bytes are a valid 38432-byte boot image (and not erased 0xFF)
export function isValidBootImageBlock(bytes) {
    if (!bytes || bytes.length !== BOOT_IMAGE_BLOCK_LENGTH) {
        return false;
    }
    let allFF = true;
    for (let i = 0; i < BOOT_PALETTE_BYTES; i++) {
        if (bytes[i] !== 0xFF) {
            allFF = false;
            break;
        }
    }
    return !allFF;
}

// Draws a 38432-byte boot image block onto a 240x320 <canvas>
export function renderBlockToCanvas(bytes, canvas) {
    canvas.width = BOOT_WIDTH;
    canvas.height = BOOT_HEIGHT;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(BOOT_WIDTH, BOOT_HEIGHT);
    const palette = [];
    for (let i = 0; i < BOOT_PALETTE_COLORS; i++) {
        const nativeVal = bytes[i * 2] | (bytes[(i * 2) + 1] << 8);
        palette.push(nativeBgr565ToRgb(nativeVal));
    }
    for (let i = 0; i < BOOT_PIXEL_BYTES; i++) {
        const b = bytes[BOOT_PALETTE_BYTES + i];
        const c0 = palette[(b >> 4) & 0x0F];
        const c1 = palette[b & 0x0F];
        const o0 = (i * 2) * 4;
        const o1 = ((i * 2) + 1) * 4;
        imgData.data[o0] = c0[0];
        imgData.data[o0 + 1] = c0[1];
        imgData.data[o0 + 2] = c0[2];
        imgData.data[o0 + 3] = 255;
        imgData.data[o1] = c1[0];
        imgData.data[o1 + 1] = c1[1];
        imgData.data[o1 + 2] = c1[2];
        imgData.data[o1 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
}

// Draws the built-in default OpenDMR boot splash logo onto a 240x320 canvas and returns its quantized 38432-byte block
export function buildDefaultBlock() {
    const c = document.createElement('canvas');
    c.width = BOOT_WIDTH;
    c.height = BOOT_HEIGHT;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#07131F';
    ctx.fillRect(0, 0, BOOT_WIDTH, BOOT_HEIGHT);

    ctx.fillStyle = '#0EA5E9';
    ctx.fillRect(0, 0, BOOT_WIDTH, 4);
    ctx.fillRect(0, BOOT_HEIGHT - 4, BOOT_WIDTH, 4);

    const cx = BOOT_WIDTH / 2;
    const cy = 115;

    ctx.beginPath();
    ctx.arc(cx, cy, 55, 0, Math.PI * 2);
    ctx.fillStyle = '#142638';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#38BDF8';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 45, 0, Math.PI * 2);
    ctx.fillStyle = '#07131F';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0EA5E9';
    ctx.stroke();

    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    for (const r of [16, 26, 36]) {
        ctx.beginPath();
        ctx.arc(cx, cy + 6, r, (210 * Math.PI) / 180, (330 * Math.PI) / 180);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy + 16, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText('OpenDMR', cx, 222);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText('Open Firmware', cx, 248);

    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.fillText('DM-32UV', cx, 278);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText('VA3BPF - LU8HPA - HJ6MVV', cx, 304);

    return quantizeImageDataToBlock(ctx.getImageData(0, 0, BOOT_WIDTH, BOOT_HEIGHT), false);
}

function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return (dr * dr * 2) + (dg * dg * 4) + (db * db * 3);
}

// Quantizes 240x320 RGBA ImageData into 16 RGB colors using Median Cut + K-means refinement
function extractPalette16(data) {
    const totalPixels = BOOT_WIDTH * BOOT_HEIGHT;
    const samples = [];
    for (let i = 0; i < totalPixels; i++) {
        const o = i * 4;
        // Quantize to RGB565 grid first so identical 16-bit colors group together
        const r = data[o] & 0xF8;
        const g = data[o + 1] & 0xFC;
        const b = data[o + 2] & 0xF8;
        samples.push([r | (r >> 5), g | (g >> 6), b | (b >> 5)]);
    }

    // Check unique colors first
    const uniqueMap = new Map();
    for (const p of samples) {
        const key = (p[0] << 16) | (p[1] << 8) | p[2];
        uniqueMap.set(key, (uniqueMap.get(key) ?? 0) + 1);
    }

    if (uniqueMap.size <= BOOT_PALETTE_COLORS) {
        const pal = [...uniqueMap.keys()].map((k) => [(k >> 16) & 0xFF, (k >> 8) & 0xFF, k & 0xFF]);
        while (pal.length < BOOT_PALETTE_COLORS) {
            pal.push([0, 0, 0]);
        }
        return pal;
    }

    // Build weighted unique color list for fast median cut + k-means
    const weighted = [...uniqueMap.entries()].map(([k, count]) => ({
        r: (k >> 16) & 0xFF,
        g: (k >> 8) & 0xFF,
        b: k & 0xFF,
        // Use sqrt(count) weighting so small bright text/accents are not drowned out by large flat backgrounds
        w: Math.sqrt(count),
    }));

    let boxes = [weighted];
    while (boxes.length < BOOT_PALETTE_COLORS) {
        let bestIdx = -1;
        let bestScore = -1;
        let bestChannel = 'r';

        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (box.length <= 1) {
                continue;
            }
            let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
            for (const c of box) {
                if (c.r < minR) minR = c.r;
                if (c.r > maxR) maxR = c.r;
                if (c.g < minG) minG = c.g;
                if (c.g > maxG) maxG = c.g;
                if (c.b < minB) minB = c.b;
                if (c.b > maxB) maxB = c.b;
            }
            const rangeR = (maxR - minR) * 1.4;
            const rangeG = (maxG - minG) * 2.0;
            const rangeB = (maxB - minB) * 1.7;
            const maxRange = Math.max(rangeR, rangeG, rangeB);
            if (maxRange > bestScore) {
                bestScore = maxRange;
                bestIdx = i;
                bestChannel = (maxRange === rangeG) ? 'g' : ((maxRange === rangeB) ? 'b' : 'r');
            }
        }

        if (bestIdx < 0) {
            break;
        }
        const target = [...boxes[bestIdx]].sort((a, b) => a[bestChannel] - b[bestChannel]);
        const totalW = target.reduce((s, c) => s + c.w, 0);
        let acc = 0;
        let splitAt = Math.floor(target.length / 2);
        for (let i = 0; i < target.length - 1; i++) {
            acc += target[i].w;
            if (acc >= totalW / 2) {
                splitAt = i + 1;
                break;
            }
        }
        boxes.splice(bestIdx, 1, target.slice(0, splitAt), target.slice(splitAt));
    }

    let palette = boxes.map((box) => {
        let sr = 0, sg = 0, sb = 0, sw = 0;
        for (const c of box) {
            sr += c.r * c.w;
            sg += c.g * c.w;
            sb += c.b * c.w;
            sw += c.w;
        }
        return sw > 0 ? [Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw)] : [0, 0, 0];
    });
    while (palette.length < BOOT_PALETTE_COLORS) {
        palette.push([0, 0, 0]);
    }

    // 4 iterations of weighted K-means refinement
    for (let iter = 0; iter < 4; iter++) {
        const sums = Array.from({length: BOOT_PALETTE_COLORS}, () => [0, 0, 0, 0]);
        for (const c of weighted) {
            let best = 0;
            let bestD = Infinity;
            for (let p = 0; p < BOOT_PALETTE_COLORS; p++) {
                const d = colorDistSq(c.r, c.g, c.b, palette[p][0], palette[p][1], palette[p][2]);
                if (d < bestD) {
                    bestD = d;
                    best = p;
                }
            }
            sums[best][0] += c.r * c.w;
            sums[best][1] += c.g * c.w;
            sums[best][2] += c.b * c.w;
            sums[best][3] += c.w;
        }
        for (let p = 0; p < BOOT_PALETTE_COLORS; p++) {
            if (sums[p][3] > 0) {
                palette[p] = [
                    Math.round(sums[p][0] / sums[p][3]),
                    Math.round(sums[p][1] / sums[p][3]),
                    Math.round(sums[p][2] / sums[p][3]),
                ];
            }
        }
    }

    return palette;
}

// Quantizes 240x320 ImageData to 38432-byte block (32-byte palette + 38400-byte 4bpp pixels)
export function quantizeImageDataToBlock(imageData, dither = false) {
    const data = imageData.data;
    const rawPalette = extractPalette16(data);

    // Snap palette colors to exact RGB565 values
    const paletteNative = new Uint16Array(BOOT_PALETTE_COLORS);
    const paletteRgb = [];
    for (let i = 0; i < BOOT_PALETTE_COLORS; i++) {
        const [r, g, b] = rawPalette[i];
        const nativeVal = rgbToNativeBgr565(r, g, b);
        paletteNative[i] = nativeVal;
        paletteRgb.push(nativeBgr565ToRgb(nativeVal));
    }

    const work = new Float32Array(BOOT_WIDTH * BOOT_HEIGHT * 3);
    for (let i = 0; i < BOOT_WIDTH * BOOT_HEIGHT; i++) {
        work[i * 3] = data[i * 4];
        work[(i * 3) + 1] = data[(i * 4) + 1];
        work[(i * 3) + 2] = data[(i * 4) + 2];
    }

    const indices = new Uint8Array(BOOT_WIDTH * BOOT_HEIGHT);
    const clamp = (v) => (v < 0 ? 0 : (v > 255 ? 255 : v));

    for (let y = 0; y < BOOT_HEIGHT; y++) {
        for (let x = 0; x < BOOT_WIDTH; x++) {
            const idx = (y * BOOT_WIDTH) + x;
            const r = clamp(work[idx * 3]);
            const g = clamp(work[(idx * 3) + 1]);
            const b = clamp(work[(idx * 3) + 2]);

            let best = 0;
            let bestD = Infinity;
            for (let p = 0; p < BOOT_PALETTE_COLORS; p++) {
                const d = colorDistSq(r, g, b, paletteRgb[p][0], paletteRgb[p][1], paletteRgb[p][2]);
                if (d < bestD) {
                    bestD = d;
                    best = p;
                }
            }
            indices[idx] = best;

            if (dither) {
                const er = (r - paletteRgb[best][0]) * 0.75;
                const eg = (g - paletteRgb[best][1]) * 0.75;
                const eb = (b - paletteRgb[best][2]) * 0.75;
                const spread = (nx, ny, factor) => {
                    if (nx >= 0 && nx < BOOT_WIDTH && ny < BOOT_HEIGHT) {
                        const nIdx = ((ny * BOOT_WIDTH) + nx) * 3;
                        work[nIdx] += er * factor;
                        work[nIdx + 1] += eg * factor;
                        work[nIdx + 2] += eb * factor;
                    }
                };
                spread(x + 1, y, 7 / 16);
                spread(x - 1, y + 1, 3 / 16);
                spread(x, y + 1, 5 / 16);
                spread(x + 1, y + 1, 1 / 16);
            }
        }
    }

    const out = new Uint8Array(BOOT_IMAGE_BLOCK_LENGTH);
    for (let i = 0; i < BOOT_PALETTE_COLORS; i++) {
        out[i * 2] = paletteNative[i] & 0xFF;
        out[(i * 2) + 1] = (paletteNative[i] >> 8) & 0xFF;
    }
    for (let i = 0; i < BOOT_PIXEL_BYTES; i++) {
        const p0 = indices[i * 2] & 0x0F;
        const p1 = indices[(i * 2) + 1] & 0x0F;
        out[BOOT_PALETTE_BYTES + i] = (p0 << 4) | p1;
    }
    return out;
}

// Loads a user image File/Blob, scales/crops it to 240x320, and returns the 38432-byte block
export function convertImageElementToBlock(img, {fit = 'cover', dither = false, bg = '#07131F'} = {}) {
    const c = document.createElement('canvas');
    c.width = BOOT_WIDTH;
    c.height = BOOT_HEIGHT;
    const ctx = c.getContext('2d');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, BOOT_WIDTH, BOOT_HEIGHT);

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (sw > 0 && sh > 0) {
        const scale = (fit === 'contain')
            ? Math.min(BOOT_WIDTH / sw, BOOT_HEIGHT / sh)
            : Math.max(BOOT_WIDTH / sw, BOOT_HEIGHT / sh);
        const dw = Math.round(sw * scale);
        const dh = Math.round(sh * scale);
        const dx = Math.round((BOOT_WIDTH - dw) / 2);
        const dy = Math.round((BOOT_HEIGHT - dh) / 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, dx, dy, dw, dh);
    }

    return quantizeImageDataToBlock(ctx.getImageData(0, 0, BOOT_WIDTH, BOOT_HEIGHT), dither);
}
