// GB2312 for the codeplug names: the firmware draws them with its Chinese font (OpenDMR ui/codeplug_text.c), two bytes
// a character from 0xA1A1, ASCII below 0x80. The browser decodes GB2312 (gb18030 is a superset with the same codes in
// that range); the encoding table is built once from it, so no table ships with the page.

let encodeTable = null; // character -> [high, low]
let decoder = null;

function build() {
    decoder = new TextDecoder('gb18030');
    encodeTable = new Map();
    const pair = new Uint8Array(2);
    for (let high = 0xA1; high <= 0xF7; high++) {
        for (let low = 0xA1; low <= 0xFE; low++) {
            pair[0] = high;
            pair[1] = low;
            const c = decoder.decode(pair);
            if ((c.length === 1) && (c !== '�') && !encodeTable.has(c)) {
                encodeTable.set(c, [high, low]);
            }
        }
    }
}

// Text -> bytes, at most maxBytes (a character is not cut in two). Characters without a GB2312 code become '?'.
export function encode(text, maxBytes) {
    if (!encodeTable) {
        build();
    }
    const out = [];
    for (const c of String(text ?? '')) {
        let bytes;
        if (c.charCodeAt(0) < 0x80) {
            bytes = [c.charCodeAt(0)];
        } else {
            bytes = encodeTable.get(c) ?? [0x3F];
        }
        if (out.length + bytes.length > maxBytes) {
            break;
        }
        out.push(...bytes);
    }
    return out;
}

// Bytes (up to the first 0x00 / 0xFF) -> text
export function decode(bytes) {
    if (!decoder) {
        build();
    }
    let end = 0;
    while ((end < bytes.length) && (bytes[end] !== 0x00) && (bytes[end] !== 0xFF)) {
        end++;
    }
    return decoder.decode(bytes.subarray ? bytes.subarray(0, end) : new Uint8Array(bytes.slice(0, end)));
}

// The characters of a text that have no GB2312 code (shown as '?' on the radio)
export function unencodable(text) {
    if (!encodeTable) {
        build();
    }
    return [...String(text ?? '')].filter((c) => (c.charCodeAt(0) >= 0x80) && !encodeTable.has(c));
}

// Bytes a text takes
export function byteLength(text) {
    return encode(text, Infinity).length;
}
