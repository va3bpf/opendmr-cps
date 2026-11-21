// The radio's interface languages and fonts (OpenDMR docs/i18n.en.md): language files (<code>.json) in 8 slots of
// 16 KB, font files (cjk.bin) behind a directory sector, in the external flash below the codeplug window. Keep in step
// with OpenDMR tools/text/langfile.py, tools/fonts/mkfont_pack.py, src/services/language.c, src/graphics/font_cjk.c.

import {crc32} from './oddb.js';

export const SECTOR = 4096;
export const LANGUAGE_ADDRESS = 0x280000;
export const SLOT_SIZE = 0x4000;
export const SLOTS = 8;
export const FONT_DIRECTORY = 0x2A0000;
export const FONT_ADDRESS = 0x2A1000;
export const FONT_END = 0x630000;
export const FONTS_MAX = 16;
const SLOT_MAGIC = 'DM32LANG';
const HEADER_SIZE = 92;
const FONT_MAGIC = 'DM32FNT1';
const DIRECTORY_MAGIC = 'DM32FDIR';
const SPEC = /%[-+ #0-9.*]*[a-zA-Z%]/g; // the format specifiers of a string
const enc = new TextEncoder();

// The languages the release's languages folder brings, ticked unless the user unticks them
export const DEFAULT_TICKED = ['zh', 'es'];
export const NAMES = {en: 'English', zh: '中文', es: 'Español'};

export function fnv1a(name) {
    let h = 0x811C9DC5;
    for (const b of enc.encode(name)) {
        h = Math.imul(h ^ b, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

const ascii = (bytes) => String.fromCharCode(...bytes);
const cstr = (bytes) => {
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
};
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16 = (b, at) => b[at] | (b[at + 1] << 8);
export function pad(data) { // to whole sectors, 0xFF after
    const out = new Uint8Array(Math.ceil(data.length / SECTOR) * SECTOR).fill(0xFF);
    out.set(data);
    return out;
}

function field(text, size) {
    const out = new Uint8Array(size);
    out.set(enc.encode(text).subarray(0, size - 1));
    return out;
}

// A language file: {doc, errors, warnings}; english: en.json's document, to check against when known
export function checkLanguage(doc, english = null) {
    const errors = [];
    const warnings = [];
    if (doc?.format !== 1) {
        errors.push('format must be 1');
    }
    for (const [key, max] of [['code', 7], ['name', 31], ['english_name', 23]]) {
        if (typeof doc?.[key] !== 'string' || !doc[key]) {
            errors.push(`${key} is missing`);
        } else if (enc.encode(doc[key]).length > max) {
            errors.push(`${key} is longer than ${max} bytes`);
        }
    }
    if (typeof doc?.code === 'string' && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,3})?$/.test(doc.code)) {
        errors.push(`code "${doc.code}" is not a language code`);
    }
    if (doc?.font !== undefined && (typeof doc.font !== 'string' || doc.font.length > 7)) {
        errors.push('font must be a name of at most 7 characters');
    }
    const strings = doc?.strings;
    if (!strings || typeof strings !== 'object' || !Object.keys(strings).length) {
        errors.push('strings is missing');
        return {errors, warnings};
    }
    for (const [key, value] of Object.entries(strings)) {
        if (!/^TEXT_[A-Z0-9_]+$/.test(key)) {
            errors.push(`${key}: not a TEXT_x name`);
        } else if (typeof value !== 'string' || value.includes('\0')) {
            errors.push(`${key}: not a string`);
        }
    }
    if (errors.length) {
        return {errors, warnings};
    }
    if (buildSlot(doc).length > SLOT_SIZE) {
        errors.push(`more than a ${SLOT_SIZE} byte slot`);
    }
    if (english) {
        const en = english.strings;
        for (const [key, value] of Object.entries(strings)) {
            if (!(key in en)) {
                warnings.push(`${key}: not in English`);
            } else if ((value.match(SPEC) ?? []).join() !== (en[key].match(SPEC) ?? []).join()) {
                errors.push(`${key}: format ${(value.match(SPEC) ?? []).join(' ')} (English ${(en[key].match(SPEC) ?? []).join(' ')})`);
            }
        }
        const missing = Object.keys(en).filter((k) => !(k in strings));
        if (missing.length) {
            warnings.push(`${missing.length} missing (shown in English)`);
        }
    } else {
        // no reference: the radio checks each string's format against its English one too
        for (const [key, value] of Object.entries(strings)) {
            if (/%[^-+ #0-9.*a-zA-Z%]/.test(value)) {
                warnings.push(`${key}: a % that is no format`);
            }
        }
    }
    return {errors, warnings};
}

// The 16 KB slot of a language file, as the radio reads it (language.c)
export function buildSlot(doc) {
    const entries = Object.entries(doc.strings);
    const blobs = entries.map(([, v]) => enc.encode(v));
    const start = HEADER_SIZE + (6 * entries.length);
    const length = start + blobs.reduce((n, b) => n + b.length + 1, 0);
    const out = new Uint8Array(length);
    out.set(enc.encode(SLOT_MAGIC), 0);
    out.set(field(doc.code, 8), 16);
    out.set(field(doc.name, 32), 24);
    out.set(field(doc.english_name, 24), 56);
    out.set(field(doc.font ?? '', 8), 80);
    const v = new DataView(out.buffer);
    v.setUint32(8, length, true);
    v.setUint16(88, entries.length, true);
    let at = start;
    entries.forEach(([key], i) => {
        v.setUint32(HEADER_SIZE + (i * 6), fnv1a(key), true);
        v.setUint16(HEADER_SIZE + (i * 6) + 4, at, true);
        out.set(blobs[i], at);
        at += blobs[i].length + 1;
    });
    v.setUint32(12, crc32(out.subarray(16)), true);
    return out;
}

// A slot's header as the radio has it, null: empty or not a language
export function parseSlotHeader(bytes, slot) {
    if (ascii(bytes.subarray(0, 8)) !== SLOT_MAGIC) {
        return null;
    }
    return {slot, length: u32(bytes, 8), crc: u32(bytes, 12), code: cstr(bytes.subarray(16, 24)),
        name: cstr(bytes.subarray(24, 56)), englishName: cstr(bytes.subarray(56, 80)), font: cstr(bytes.subarray(80, 88)),
        count: u16(bytes, 88)};
}

// A font file: {name, length, error}
export function checkFont(bytes) {
    if (bytes.length < 64 || ascii(bytes.subarray(0, 8)) !== FONT_MAGIC) {
        return {error: 'not a font file'};
    }
    if (u32(bytes, 8) !== bytes.length || crc32(bytes.subarray(64)) !== u32(bytes, 12)) {
        return {error: 'damaged (length or CRC)'};
    }
    return {name: cstr(bytes.subarray(16, 24)), length: bytes.length};
}

export function parseDirectory(bytes) {
    if (!bytes || ascii(bytes.subarray(0, 8)) !== DIRECTORY_MAGIC) {
        return [];
    }
    const out = [];
    for (let i = 0; i < Math.min(bytes[8], FONTS_MAX); i++) {
        const e = 12 + (i * 20);
        out.push({name: cstr(bytes.subarray(e, e + 8)), address: u32(bytes, e + 8), length: u32(bytes, e + 12),
            crc: u32(bytes, e + 16)});
    }
    return out;
}

export function buildDirectory(fonts) {
    const out = new Uint8Array(SECTOR).fill(0xFF);
    out.set(enc.encode(DIRECTORY_MAGIC), 0);
    out[8] = fonts.length;
    out[9] = out[10] = out[11] = 0;
    const v = new DataView(out.buffer);
    fonts.forEach((f, i) => {
        const e = 12 + (i * 20);
        out.set(field(f.name, 9).subarray(0, 8), e);
        v.setUint32(e + 8, f.address, true);
        v.setUint32(e + 12, f.length, true);
        v.setUint32(e + 16, f.crc, true);
    });
    return out;
}

// Where a font of length bytes goes among the others (sector aligned, first free gap), null: no room
export function placeFont(fonts, length) {
    const size = pad(new Uint8Array(length)).length;
    let address = FONT_ADDRESS;
    for (const f of [...fonts].sort((a, b) => a.address - b.address)) {
        if (address + size <= f.address) {
            break;
        }
        address = Math.max(address, f.address + (Math.ceil(f.length / SECTOR) * SECTOR));
    }
    return (address + size <= FONT_END) ? address : null;
}
