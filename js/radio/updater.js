// Firmware update over the running firmware, as tools/debug/fw_update.py: 'D' 'U' "UPD!" makes the firmware stop and
// hand its RAM to the update program (tools/debug/updater/updater.bin of the chosen OpenDMR release, assets.js), which
// this drives to write the program flash's firmware area [0xC000, 0x100000). The bootloader below stays as it is: the upgrade mode
// (PTT + SK1) still works whatever happens here.
//
//   'H'                          -> "UPD1" (also once at the start)
//   'C' addr(4)                  -> 'C' crc32(4) of the 4 KB sector at addr
//   'W' addr(4) data(4096) crc32(4) -> 'K', or 'E' error(1)
//   'P' done(2) total(2)         -> 'P', the radio's progress bar
//   'S' divisor(2)               -> 'S', then the UART at 84 MHz / 16 / divisor ('H' and 'Y' confirm, 0.4 s)
//   'B'                          -> 'B', then the radio restarts into the new firmware
// The loader (src/services/serial_update.c) answers "DU", then "UPL1" + area(4) + size(4).

import {RawPort} from './serial.js';
import {updaterImage} from './assets.js';
import {Screen, GREEN, RED} from './screen.js';
import {crc32} from '../codeplug/oddb.js';
import {RadioLink, radioBaud} from './link.js';

const UART_CLOCK = 84000000 / 16;   // the radio's UART: baud = UART_CLOCK / divisor
const FAST_DIVISORS = [7, 14, 21];  // 750000, 375000, 250000 baud
const PROBE_DIVISORS = [7, 14, 16, 21];
const SWITCH_SETTLE_MS = 50;
const UPDATER_AREA = 0x44400;       // tools/debug/updater/updater.ld
const SECTOR = 4096;
const FLASH_BASE = 0xC000;          // the firmware area of the program flash
const FLASH_END = 0x100000;         // the end of the 1 MB program flash (OpenDMR 0.8.1 and later)
export const LOADER_MARKER = 'DM32-SERIAL-UPDATE-LOADER-1'; // src/services/serial_update.c, in the image

const ERRORS = {
    1: 'the sector came in damaged',
    2: 'address outside the firmware area',
    3: 'read back different',
    4: 'the flash stayed busy',
    5: 'the request was cut short',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An opendmr.bin prepared for writing: the BFUV32 header off, the loader marker checked, the last sector filled
export function prepareImage(bytes) {
    let image = bytes;
    if (image.length >= 9 && String.fromCharCode(...image.subarray(0, 9)) === 'BFUV32-V2') {
        image = image.subarray(0x100);
    }
    // the marker is wherever the linker put it (0x489F8 in 0.6.1): the whole image is looked at, as fw_update.py does
    if (findBytes(image, new TextEncoder().encode(LOADER_MARKER)) < 0) {
        throw new Error('not an OpenDMR firmware with the cable update loader: not written');
    }
    if (FLASH_BASE + image.length > FLASH_END) {
        throw new Error(`too big for the firmware area: ${image.length} bytes`);
    }
    const padded = new Uint8Array(Math.ceil(image.length / SECTOR) * SECTOR).fill(0xFF);
    padded.set(image);
    return padded;
}

export class Updater {
    constructor(port = null) {
        this.s = new RawPort();
        this.port = port;
        this.screen = null;
    }

    async open() {
        await this.s.open(this.port, 115200);
    }

    async close() {
        await this.s.close();
    }

    // The radio into the update program: through the firmware's loader, or already there (a run cut short)
    async start() {
        this.s.clear();
        await this.s.write(new TextEncoder().encode('DUUPD!'));
        let data = await this.s.until(new TextEncoder().encode('DU'), 3000);
        if (data) {
            const refused = await this.s.after(data, new TextEncoder().encode('DU'), 1, 1000);
            if (refused && refused[0] === 0) {
                throw new Error('the radio refused: transmitting');
            }
        }
        let area = data ? await this.s.after(data, new TextEncoder().encode('UPL1'), 8) : null;
        if (!area) {
            data = await this.probe();
            if (!data) {
                throw new Error('no answer: is the radio on, with this firmware, and the cable in?');
            }
            const already = await this.s.after(data, new TextEncoder().encode('UP'), 2, 1000);
            if (already && already[0] === 0x44 && already[1] === 0x31) { // "D1"
                return;
            }
            area = await this.s.after(data, new TextEncoder().encode('UPL1'), 8);
        }
        const given = new DataView(area.buffer, area.byteOffset, 8);
        const givenArea = given.getUint32(0);
        const givenSize = given.getUint32(4);
        const image = await updaterImage();
        if (givenArea !== UPDATER_AREA || image.length + SECTOR + 256 > givenSize) {
            throw new Error(`the firmware gives 0x${givenArea.toString(16)} (${givenSize} bytes), the update program ` +
                `needs 0x${UPDATER_AREA.toString(16)} (${image.length + SECTOR + 256})`);
        }
        const head = new Uint8Array(9);
        head[0] = 0x4C; // 'L'
        new DataView(head.buffer).setUint32(1, UPDATER_AREA);
        new DataView(head.buffer).setUint32(5, image.length);
        const crc = new Uint8Array(4);
        new DataView(crc.buffer).setUint32(0, crc32(image));
        await this.s.write(concat(head, image, crc));
        const reply = await this.s.read(1, 3000);
        if (reply[0] !== 0x4B) { // 'K'
            throw new Error('the loader refused the update program');
        }
        const jump = new Uint8Array(5);
        jump[0] = 0x4A; // 'J'
        new DataView(jump.buffer).setUint32(1, UPDATER_AREA);
        await this.s.write(jump);
        const back = await this.s.read(1, 3000);
        if (back[0] !== 0x4A || (await this.s.until(new TextEncoder().encode('UPD1'), 3000)) === null) {
            throw new Error('the update program did not start');
        }
    }

    async probe() {
        const bauds = [115200, ...PROBE_DIVISORS.map((d) => UART_CLOCK / d)];
        for (const baud of bauds) {
            await this.s.setBaud(baud);
            this.s.clear();
            await this.s.write(new Uint8Array([0x48])); // 'H'
            const data = await this.s.until(new TextEncoder().encode('UP'), 700);
            if (data) {
                return data;
            }
        }
        await this.s.setBaud(115200);
        return null;
    }

    // The fastest speed the cable takes, or the one chosen in the toolbar (RadioLink.speed, as fw_update.py --baud);
    // the radio goes back to the old one if 'H' does not come
    async speedUp() {
        const chosen = (RadioLink.speed === 'auto') ? null : radioBaud(RadioLink.speed);
        const divisors = chosen ? [Math.round(UART_CLOCK / chosen)] : FAST_DIVISORS;
        for (const divisor of divisors) {
            const baud = Math.round(UART_CLOCK / divisor);
            if (this.s.baud === baud) {
                return;
            }
            if (this.s.baud > baud && !chosen) { // auto: already faster (a run cut short)
                continue;
            }
            const old = this.s.baud;
            this.s.clear();
            const ask = new Uint8Array(3);
            ask[0] = 0x53; // 'S'
            new DataView(ask.buffer).setUint16(1, divisor);
            await this.s.write(ask);
            if ((await this.s.read(1, 3000))[0] !== 0x53) {
                throw new Error('bad reply to S');
            }
            await sleep(20);
            await this.s.setBaud(baud);
            await sleep(SWITCH_SETTLE_MS);
            this.s.clear();
            await this.s.write(new Uint8Array([0x48])); // 'H'
            if (await this.s.until(new TextEncoder().encode('UPD1'), 300)) {
                await this.s.write(new Uint8Array([0x59])); // 'Y'
                if (await this.s.until(new TextEncoder().encode('Y'), 300)) {
                    return;
                }
            }
            await this.s.setBaud(old);
            let back = false;
            for (const wait of [500, 2000, 2000]) {
                await sleep(wait);
                this.s.clear();
                await this.s.write(new Uint8Array([0x48]));
                if (await this.s.until(new TextEncoder().encode('UPD1'), 300)) {
                    back = true;
                    break;
                }
            }
            if (!back) {
                throw new Error(`lost the radio after trying ${baud} baud`);
            }
        }
    }

    async sectorCrc(address) {
        const ask = new Uint8Array(5);
        ask[0] = 0x43; // 'C'
        new DataView(ask.buffer).setUint32(1, address);
        for (let attempt = 0; attempt < 4; attempt++) {
            this.s.clear();
            await this.s.write(ask);
            try {
                const reply = await this.s.read(5, 1000);
                if (reply[0] === 0x43) {
                    return new DataView(reply.buffer, reply.byteOffset + 1, 4).getUint32(0);
                }
            } catch (e) {
                // asked again
            }
            await sleep(50);
        }
        throw new Error(`no answer to C for 0x${address.toString(16)}`);
    }

    async writeSector(address, data) {
        const want = crc32(data);
        const head = new Uint8Array(5);
        head[0] = 0x57; // 'W'
        new DataView(head.buffer).setUint32(1, address);
        const crc = new Uint8Array(4);
        new DataView(crc.buffer).setUint32(0, want);
        let error = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            this.s.clear();
            await this.s.write(concat(head, data, crc));
            let reply = null;
            try {
                reply = await this.s.read(1, 10000);
            } catch (e) {
                reply = null;
            }
            if (reply && reply[0] === 0x4B) { // 'K'
                return;
            }
            if (reply && reply[0] === 0x45) { // 'E'
                error = (await this.s.read(1, 2000))[0];
                if (error !== 1 && error !== 5) {
                    throw new Error(`sector 0x${address.toString(16)}: ${ERRORS[error] ?? error}`);
                }
                continue;
            }
            await sleep(50);
            if ((await this.sectorCrc(address)) === want) {
                return;
            }
        }
        throw new Error(`sector 0x${address.toString(16)}: ${error ? (ERRORS[error] ?? error) : 'no answer'}`);
    }

    // The radio's progress bar; a lost reply does not matter
    async progress(done, total) {
        const ask = new Uint8Array(5);
        ask[0] = 0x50; // 'P'
        new DataView(ask.buffer).setUint16(1, done);
        new DataView(ask.buffer).setUint16(3, total);
        await this.s.write(ask);
        try {
            await this.s.read(1, 500);
        } catch (e) {
            this.s.clear();
        }
    }

    // The watchdog is kept from resetting the radio again once the new firmware answers
    async restart() {
        await this.s.write(new Uint8Array([0x42])); // 'B'
        try {
            await this.s.read(1, 3000);
        } catch (e) {
            // the radio may reset before answering
        }
        await this.s.setBaud(115200);
        const end = performance.now() + 15000;
        const writes = [[0x14010000, 0x5ADA7200], [0x14010010, 0], [0x14010008, 0xC0000000], [0x14010000, 0]];
        while (performance.now() < end) {
            this.s.clear();
            let ok = true;
            for (const [address, value] of writes) {
                await this.s.write(concat(u8(0x44), u8(0x56), u32(address), u8(4), u32(value))); // 'DV'
                if (!(await this.s.until(new TextEncoder().encode('DV'), 300))) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return;
            }
            await sleep(200);
        }
        throw new Error('the radio did not come back: power it off and on');
    }

    // The image to the radio: the sectors that differ only. progress(done, total) is called per sector
    async writeImage(image, progress, force = false) {
        const sectors = [];
        for (let i = 0; i < image.length; i += SECTOR) {
            sectors.push([FLASH_BASE + i, image.subarray(i, i + SECTOR)]);
        }
        await this.start();
        await this.speedUp();
        this.screen = new Screen(this.s);
        await this.screen.line('title', 'Updating');
        await this.screen.line('chip', 'Do not power off', RED);
        await this.screen.line('percent', '0%');
        let written = 0;
        let shown = 0;
        for (let n = 0; n < sectors.length; n++) {
            const [address, data] = sectors[n];
            if (force || (await this.sectorCrc(address)) !== crc32(data)) {
                await this.writeSector(address, data);
                written++;
            }
            await this.progress(n + 1, sectors.length);
            const percent = Math.floor(((n + 1) * 100) / sectors.length);
            if (percent >= shown + 5 || n + 1 === sectors.length) { // the radio's text, each 5 %
                shown = percent;
                await this.screen.line('percent', `${percent}%`);
            }
            progress?.(n + 1, sectors.length);
        }
        // checked once more before the restart; a sector spoilt on the way is written again
        let bad = [];
        for (const [address, data] of sectors) {
            if ((await this.sectorCrc(address)) !== crc32(data)) {
                bad.push([address, data]);
            }
        }
        for (let round = 0; (round < 2) && bad.length; round++) {
            for (const [address, data] of bad) {
                await this.writeSector(address, data);
            }
            bad = [];
            for (const [address, data] of sectors) {
                if ((await this.sectorCrc(address)) !== crc32(data)) {
                    bad.push([address, data]);
                }
            }
        }
        if (bad.length) {
            throw new Error(`still different: ${bad.map(([a]) => '0x' + a.toString(16)).join(', ')} (the radio ` +
                'stays in the update: run again)');
        }
        // a moment on the screen before the radio goes: the last message is read
        await this.screen.line('title', written === 0 ? 'Up to date' : 'Done', GREEN);
        await this.screen.line('chip', 'Restarting', GREEN);
        await new Promise((resolve) => setTimeout(resolve, 700));
        await this.restart();
        return written;
    }
}

// The first place needle is in haystack, or -1
export function findBytes(haystack, needle) {
    outer:
    for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let k = 0; k < needle.length; k++) {
            if (haystack[i + k] !== needle[k]) {
                continue outer;
            }
        }
        return i;
    }
    return -1;
}

function u8(v) {
    return new Uint8Array([v]);
}

function u32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v);
    return b;
}

export function concat(...parts) {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
