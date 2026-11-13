// Byte helpers for the codeplug image

export function u16(img, at) {
    return img[at] | (img[at + 1] << 8);
}

export function setU16(img, at, value) {
    img[at] = value & 0xFF;
    img[at + 1] = (value >> 8) & 0xFF;
}

export function u32(img, at) {
    return (img[at] | (img[at + 1] << 8) | (img[at + 2] << 16) | (img[at + 3] << 24)) >>> 0;
}

export function setU32(img, at, value) {
    for (let i = 0; i < 4; i++) {
        img[at + i] = (value >>> (8 * i)) & 0xFF;
    }
}

// BCD (as a number read little endian) -> value; a nibble above 9 makes it invalid (NaN)
export function fromBcd(bcd) {
    let value = 0;
    let multiplier = 1;
    for (let n = bcd >>> 0; n > 0; n = Math.floor(n / 16)) {
        const digit = n % 16;
        if (digit > 9) {
            return NaN;
        }
        value += digit * multiplier;
        multiplier *= 10;
    }
    return value;
}

export function toBcd(value) {
    let bcd = 0;
    let shift = 1;
    for (let n = Math.max(0, Math.floor(value)); n > 0; n = Math.floor(n / 10)) {
        bcd += (n % 10) * shift;
        shift *= 16;
    }
    return bcd >>> 0;
}

// The DMR IDs of the codeplug: BCD with the most significant byte first
export function readBcdBigEndian(img, at) {
    return fromBcd(((img[at] << 24) | (img[at + 1] << 16) | (img[at + 2] << 8) | img[at + 3]) >>> 0);
}

export function writeBcdBigEndian(img, at, value) {
    const bcd = toBcd(value);
    img[at] = (bcd >>> 24) & 0xFF;
    img[at + 1] = (bcd >>> 16) & 0xFF;
    img[at + 2] = (bcd >>> 8) & 0xFF;
    img[at + 3] = bcd & 0xFF;
}

export function fill(img, at, length, value) {
    img.fill(value, at, at + length);
}
