// The programming cable link to an OpenDMR radio (OpenDMR src/services/cable_link.c), over Web Serial (Chrome, Edge).
//   'R' area(1) address(4 BE) length(2 BE)   -> 'R' length(2 BE) data, or '-'. Area 1: the data flash window,
//                                               9: the radio info, 10: raw addresses of the language slots and font
//                                               files (OpenDMR 0.8.0, docs/i18n.en.md)
//   'X' 1 sector(3 BE)                       -> 'X' 1: the sector into the radio's buffer; with 0x800000 a raw
//                                               sector of the language area (its 'X' 2 addresses raw too)
//   'X' 2 address(4 BE) length(2 BE) data    -> 'X' 2: bytes into it
//   'X' 3                                    -> 'X' 3: the buffer to the flash
//   'C' 5 / 'C' 6 n                          -> '-': close the radio's CPS screen / 6 2: save the settings,
//                                               6 1: save them (if changed) and restart / 8: languages and fonts
//                                               written, the radio reads them again
//   'D' 'K' address(4 BE)                    -> 'D' 'K' CRC-32(4 BE) of the window's sector there (firmware 0.4.0);
//                                               with 0x80000000, of a raw sector of the language area
//   'D' 'S' divisor(2 BE)                    -> 'D' 'S' 1: the radio's UART at 84 MHz / 16 / divisor; 'D' 'Y' at
//                                               it confirms, or it goes back to 115200 after 2 s, and after 5 s
//                                               without a request

import {SECTOR, IGNORED_SECTORS} from '../codeplug/layout.js';
import {crc32} from '../codeplug/oddb.js';

const BAUD = 115200;
const READ_CHUNK = 1024;  // the radio answers up to 1533 bytes a read
const WRITE_CHUNK = 1024; // and takes up to 1528 bytes a write
const TIMEOUT_MS = 2000;
const UART_CLOCK = 84000000 / 16;      // the radio's UART: baud = UART_CLOCK / divisor
const SPEED_DIVISORS = [7, 14, 21];    // 750000, 375000, 250000 baud (12 MHz / n for a CH340 too)
const SPEED_BACK_MS = 500;             // an unconfirmed speed: the radio is back at 115200 after 0.4 s
const QUIET_BACK_MS = 5500;            // and after 5 s without a request
const REQUEST_LOST_MS = 300;           // a request cut short: the radio drops it after 0.2 s of quiet (OpenDMR 0.8.2)
const MIN_DIVISOR = 4;                // the radio's fastest: 1312500 baud
const MAX_DIVISOR = 46;               // its slowest: 115200 (UART_CLOCK / 46)
export const SPEED_MIN = BAUD;
export const SPEED_MAX = Math.floor(UART_CLOCK / MIN_DIVISOR);

// A speed the user typed: the radio's nearest one (UART_CLOCK / divisor; 115200 for the slowest), or null when the
// radio can't run near it
export function radioBaud(baud) {
    const divisor = Math.round(UART_CLOCK / Number(baud));
    if (!Number.isFinite(divisor) || divisor < MIN_DIVISOR || divisor > MAX_DIVISOR) {
        return null;
    }
    return (divisor === MAX_DIVISOR) ? BAUD : Math.floor(UART_CLOCK / divisor);
}
export const SPEED_SETTING_KEY = 'opendmr-cable-speed';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AREA_FLASH = 1;
const AREA_RADIO_INFO = 9;
const AREA_LANGUAGES = 10;
const RAW_SECTOR = 0x800000;
const RAW_CRC = 0x80000000;

export class RadioLink {
    // the page's texts (app.js sets i18n's t): the messages this class makes
    static text = (key) => ({speedNotKept: 'The radio did not keep {baud} baud on this cable'})[key] ?? key;
    static speed = 'auto'; // the cable's speed: 'auto' or a baud rate from radioBaud (app.js, the toolbar)

    constructor() {
        this.port = null;
        this.reader = null;
        this.buffer = [];
        this.waiter = null;
    }

    static supported() {
        return 'serial' in navigator;
    }

    async open() {
        this.port = await navigator.serial.requestPort();
        await this.port.open({baudRate: BAUD, bufferSize: 8192});
        this.baud = BAUD;
        this.reading = this.readLoop();
    }

    // The same port at another speed (Web Serial sets it only when a port opens)
    async reopen(baud) {
        const port = this.port;
        try {
            await this.reader?.cancel();
            await this.reading;
        } catch (e) {
            // the reader was done
        }
        await port.close().catch(() => {});
        await port.open({baudRate: baud, bufferSize: 8192});
        this.port = port;
        this.baud = baud;
        this.buffer = [];
        this.reading = this.readLoop();
    }

    async close() {
        if (!this.port) {
            return;
        }
        try {
            await this.reader?.cancel();
            await this.reading;
        } catch (e) {
            // the port went away
        }
        await this.port.close().catch(() => {});
        this.port = null;
    }

    get connected() {
        return this.port !== null;
    }

    async readLoop() {
        while (this.port?.readable) {
            this.reader = this.port.readable.getReader();
            try {
                for (;;) {
                    const {value, done} = await this.reader.read();
                    if (done) {
                        return;
                    }
                    for (const b of value) {
                        this.buffer.push(b);
                    }
                    this.waiter?.();
                }
            } catch (e) {
                return;
            } finally {
                this.reader.releaseLock();
            }
        }
    }

    // n bytes of reply; refusable: the start of a reply, where a '-' means the radio refused the request
    async receive(n, refusable = true, timeout = TIMEOUT_MS) {
        const deadline = Date.now() + timeout;
        while ((this.buffer.length < n) && !(refusable && (this.buffer.length > 0) && (this.buffer[0] === 0x2D))) {
            const left = deadline - Date.now();
            if (left <= 0) {
                throw new Error('timeout');
            }
            await new Promise((resolve) => {
                this.waiter = resolve;
                setTimeout(resolve, Math.min(left, 100));
            });
            this.waiter = null;
        }
        if (refusable && (this.buffer[0] === 0x2D) && (n > 1)) {
            this.buffer.splice(0, 1);
            throw new Error('refused');
        }
        return Uint8Array.from(this.buffer.splice(0, n));
    }

    async send(bytes) {
        this.buffer = [];
        const writer = this.port.writable.getWriter();
        try {
            await writer.write(Uint8Array.from(bytes));
        } finally {
            writer.releaseLock();
        }
    }

    async read(area, address, length) {
        await this.send([0x52, area, (address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF,
            address & 0xFF, (length >> 8) & 0xFF, length & 0xFF]);
        const head = await this.receive(3);
        if (head[0] !== 0x52) {
            throw new Error('bad reply');
        }
        const got = (head[1] << 8) | head[2];
        return this.receive(got, false);
    }

    async radioInfo() {
        const d = await this.read(AREA_RADIO_INFO, 0, 0);
        const text = (from, to) => new TextDecoder().decode(d.subarray(from, to)).replace(/\0.*$/, '');
        return {
            structVersion: d[0] | (d[1] << 8),
            radioType: d[4] | (d[5] << 8),
            git: text(8, 24),
            build: text(24, 40),
            flashId: d[40] | (d[41] << 8) | (d[42] << 16),
        };
    }

    // Window bytes [start, end) into img; progress(done, total)
    // length bytes at address packed by the radio ('D' 'Z', firmware 0.4.0: runs of a byte sent as one), unpacked;
    // null: it did not fit the reply (fewer bytes then); throws 'refused' for a firmware without it
    async readPacked(address, length) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.readPackedOnce(address, length);
            } catch (e) {
                if (e.message === 'refused' || attempt >= 2) {
                    throw e;
                }
            }
        }
    }

    async readPackedOnce(address, length) {
        await this.send([0x44, 0x5A, (address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF,
            address & 0xFF, (length >> 8) & 0xFF, length & 0xFF]);
        const head = await this.receive(5);
        if (head[0] !== 0x44 || head[1] !== 0x5A) {
            throw new Error('bad reply');
        }
        const n = (head[3] << 8) | head[4];
        const packed = n ? await this.receive(n, false) : new Uint8Array(0);
        if (head[2] !== 1) {
            return null;
        }
        const out = new Uint8Array(length);
        let o = 0;
        for (let i = 0; (i < packed.length) && (o < length);) {
            const c = packed[i++];
            if (c < 0x80) {
                out.set(packed.subarray(i, i + c + 1), o);
                o += c + 1;
                i += c + 1;
            } else {
                out.fill(packed[i++], o, o + c - 0x80 + 3);
                o += c - 0x80 + 3;
            }
        }
        if (o !== length) {
            throw new Error('bad packed data');
        }
        return out;
    }

    // The window sector at address, packed (1 KB at a time when it does not pack small enough); throws 'refused' for
    // a firmware before 0.4.0
    async readSector(address) {
        let data = await this.readPacked(address, SECTOR);
        if (!data) {
            data = new Uint8Array(SECTOR);
            for (let k = 0; k < SECTOR; k += READ_CHUNK) {
                data.set((await this.readPacked(address + k, READ_CHUNK)) ?? await this.read(AREA_FLASH, address + k, READ_CHUNK), k);
            }
        }
        return data;
    }

    // Window bytes [start, end) into img, packed sector by sector when the radio can (then 1 KB at a time where a
    // sector does not pack small enough), else as they are; progress(done, total)
    async readRegion(img, start, end, progress, doneBefore, total) {
        if (this.packs !== false && (start % SECTOR) === 0 && (end % SECTOR) === 0) {
            try {
                for (let at = start; at < end; at += SECTOR) {
                    img.set(await this.readSector(at), at);
                    progress?.(doneBefore + (at + SECTOR - start), total);
                }
                this.packs = true;
                return;
            } catch (e) {
                if (e.message !== 'refused' || this.packs === true) {
                    throw e;
                }
                this.packs = false; // a firmware before 0.4.0: as they are
            }
        }
        for (let at = start; at < end; at += READ_CHUNK) {
            const n = Math.min(READ_CHUNK, end - at);
            let data;
            for (let attempt = 0; ; attempt++) {
                try {
                    data = await this.read(AREA_FLASH, at, n);
                    break;
                } catch (e) {
                    if (attempt >= 2) {
                        throw e;
                    }
                }
            }
            img.set(data, at);
            progress?.(doneBefore + (at + n - start), total);
        }
    }

    async expect(request, ack) {
        for (let attempt = 0; ; attempt++) {
            await this.send(request);
            try {
                const r = await this.receive(2);
                if (r[0] === ack[0] && r[1] === ack[1]) {
                    return;
                }
                throw new Error('bad reply');
            } catch (e) {
                if (attempt >= 2) {
                    throw e;
                }
            }
        }
    }

    // One 4 KB sector of the window; raw: a raw sector of the language area (sector = raw address / 4096)
    async writeSector(sector, data, raw = false) {
        if (!raw && IGNORED_SECTORS.includes(sector)) {
            return;
        }
        const s = raw ? (sector | RAW_SECTOR) : sector;
        await this.expect([0x58, 1, (s >> 16) & 0xFF, (s >> 8) & 0xFF, s & 0xFF], [0x58, 1]);
        for (let off = 0; off < SECTOR; off += WRITE_CHUNK) {
            const address = (sector * SECTOR) + off;
            const n = Math.min(WRITE_CHUNK, SECTOR - off);
            await this.expect([0x58, 2, (address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF,
                address & 0xFF, (n >> 8) & 0xFF, n & 0xFF, ...data.subarray(off, off + n)], [0x58, 2]);
        }
        await this.expect([0x58, 3], [0x58, 3]);
    }

    // A failed write or CRC mismatch invalidates the whole sector transaction.
    // Start it again at a lower speed (auto; a speed chosen by the user: the same one, three times at most), including
    // a fresh prepare and read-back CRC.
    async writeVerifiedSector(sector, data, onSpeedChange, raw = false) {
        const address = sector * SECTOR;
        const expected = crc32(data);
        let failures = 0;
        for (;;) {
            const previous = this.baud;
            try {
                await this.writeSector(sector, data, raw);
                const actual = await this.sectorCrc(address, 3, raw);
                if (actual !== expected) {
                    throw new Error(actual === null ? 'no CRC reply' : 'read back different');
                }
                return;
            } catch (e) {
                const fixed = this.fixedSpeed() !== null;
                failures += 1;
                if (previous <= BAUD || !this.connected || (fixed && failures >= 3)) {
                    throw new Error(`sector 0x${address.toString(16)}: ${e.message}`, {cause: e});
                }
                await sleep(REQUEST_LOST_MS); // a request cut short on the cable: the radio drops it (OpenDMR 0.8.2)
                if (fixed) {
                    continue;
                }
                await this.speedDown();
                const baud = await this.speedUp(raw ? 0 : address, false, previous);
                if (baud === BAUD) {
                    try {
                        localStorage.setItem(this.cableKey(false), String(Math.round(UART_CLOCK / BAUD)));
                    } catch (e) {
                        // Storage can be unavailable for a local HTML file.
                    }
                }
                onSpeedChange?.(baud);
            }
        }
    }

    // The radio's CRC-32 of the window's sector at address ('D' 'K'); null: no answer (a firmware before 0.4.0)
    async sectorCrc(address, attempts = 3, raw = false) {
        const a = raw ? ((address | RAW_CRC) >>> 0) : address;
        for (let i = 0; i < attempts; i++) {
            try {
                await this.send([0x44, 0x4B, (a >>> 24) & 0xFF, (a >>> 16) & 0xFF, (a >>> 8) & 0xFF, a & 0xFF]);
                const r = await this.receive(6, true, 500);
                if (r[0] === 0x44 && r[1] === 0x4B) {
                    return ((r[2] << 24) | (r[3] << 16) | (r[4] << 8) | r[5]) >>> 0;
                }
            } catch (e) {
                if (e.message === 'refused') {
                    return null;
                }
            }
            await sleep(100);
        }
        return null;
    }

    // The cable's speed the user chose (the toolbar sets RadioLink.speed): null for auto, else that baud rate for every
    // transfer
    fixedSpeed() {
        return (RadioLink.speed === 'auto') ? null : radioBaud(RadioLink.speed);
    }

    // auto: the fastest speed both ends keep ('D' 'S', confirmed by 'D' 'Y' and four CRCs of probe); 115200 when none.
    // reads: the sector at probe read too and checked with its CRC (a CH340 loses bytes to the PC at 375000 and up,
    // while short replies and writes to the radio still pass). A speed chosen by the user: that one, or an error.
    async speedUp(probe, reads = false, below = Infinity) {
        const fixed = this.fixedSpeed();
        if (fixed !== null) {
            if (this.baud === fixed) {
                return fixed;
            }
            await this.speedDown();
            if (fixed === BAUD) {
                return BAUD;
            }
            if ((await this.trySpeed(Math.round(UART_CLOCK / fixed), probe, reads)) !== true) {
                throw new Error(RadioLink.text('speedNotKept').replaceAll('{baud}', fixed));
            }
            return this.baud;
        }
        // the speed this kind of cable kept last time (its USB ids): the faster ones that failed not tried again
        const key = this.cableKey(reads);
        let known = null;
        try {
            known = Number(localStorage.getItem(key)) || null;
        } catch (e) {
            known = null;
        }
        for (const divisor of SPEED_DIVISORS.filter((d) => (UART_CLOCK / d < below) && ((known === null) || (d >= known)))) {
            const result = await this.trySpeed(divisor, probe, reads);
            if (result === 'old') {
                return BAUD; // a firmware without it
            }
            if (result) {
                try {
                    localStorage.setItem(key, String(divisor));
                } catch (e) {
                    // not kept: tried again next time
                }
                return this.baud;
            }
        }
        return BAUD;
    }

    // One speed: asked, confirmed, checked. true: kept; false: back at 115200; 'old': the radio doesn't change speed
    async trySpeed(divisor, probe, reads) {
        const baud = Math.floor(UART_CLOCK / divisor);
        try {
            await this.send([0x44, 0x53, divisor >> 8, divisor & 0xFF]);
            const r = await this.receive(3, true, 500);
            if (r[0] !== 0x44 || r[1] !== 0x53 || r[2] !== 1) {
                return 'old';
            }
        } catch (e) {
            return 'old';
        }
        await sleep(20);
        await this.reopen(baud);
        await sleep(50);
        let ok = false;
        try {
            await this.send([0x44, 0x59]);
            const r = await this.receive(2, true, 300);
            ok = (r[0] === 0x44 && r[1] === 0x59);
        } catch (e) {
            ok = false;
        }
        const confirmed = ok;
        for (let i = 0; ok && i < 4; i++) {
            ok = (await this.sectorCrc(probe, 1)) !== null;
        }
        if (ok && reads) {
            ok = await this.readsWell(probe);
        }
        if (ok) {
            return true;
        }
        if (confirmed) {
            await this.speedDown(); // it keeps a confirmed speed: asked back
        } else {
            await this.reopen(BAUD); // the radio goes back by itself: after 0.4 s (a firmware before: 2 s)
            for (const wait of [SPEED_BACK_MS, 2000]) {
                await sleep(wait);
                if ((await this.sectorCrc(probe, 1)) !== null) {
                    break;
                }
            }
        }
        return false;
    }

    // The kind of cable (USB vendor and product), and whether reads were checked: the key of its kept speed
    cableKey(reads) {
        const info = this.port?.getInfo?.() ?? {};
        return `opendmr-speed-${info.usbVendorId ?? 'x'}-${info.usbProductId ?? 'x'}${reads ? '-reads' : ''}`;
    }

    // A sector read whole at this speed, the same as the radio's CRC of it
    async readsWell(address) {
        try {
            const data = new Uint8Array(SECTOR);
            for (let at = 0; at < SECTOR; at += READ_CHUNK) {
                data.set(await this.read(AREA_FLASH, address + at, READ_CHUNK), at);
            }
            return crc32(data) === (await this.sectorCrc(address, 1));
        } catch (e) {
            return false;
        }
    }

    // Back to 115200: asked for ('D' 'S' with its divisor, confirmed at it); else the radio goes back by itself after 5 s
    // without a request
    async speedDown() {
        if (this.baud === BAUD) {
            return;
        }
        const divisor = Math.round(UART_CLOCK / BAUD);
        try {
            await this.send([0x44, 0x53, divisor >> 8, divisor & 0xFF]);
            const r = await this.receive(3, true, 500);
            if (r[0] === 0x44 && r[1] === 0x53 && r[2] === 1) {
                await sleep(20);
                await this.reopen(BAUD);
                await sleep(50);
                await this.send([0x44, 0x59]);
                const y = await this.receive(2, true, 500);
                if (y[0] === 0x44 && y[1] === 0x59) {
                    return;
                }
            }
        } catch (e) {
            // not answered: waited for below
        }
        await this.reopen(BAUD);
        await sleep(QUIET_BACK_MS);
    }

    // The receive log (OpenDMR rx_log.h, 'D' 'L'): op 's' status, 'e' on/off, 'p' pause/resume, 'c' clear
    async rxLog(op, arg = null) {
        await this.send([0x44, 0x4C, op.charCodeAt(0), ...(arg === null ? [] : [arg])]);
        const r = await this.receive(20);
        if (r[0] !== 0x44 || r[1] !== 0x4C) {
            throw new Error('bad reply');
        }
        const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
        return {enabled: r[2] === 1, state: r[3], base: v.getUint32(4), sectors: v.getUint16(8),
            seq: v.getUint32(10), dropped: v.getUint32(14), pending: v.getUint16(18)};
    }

    // The seq of each sector of the receive log area ('D' 'L' 'h'), null where it is not a sector of the log
    async rxLogSectors(count) {
        await this.send([0x44, 0x4C, 0x68]);
        const r = await this.receive(2 + (4 * count));
        if (r[0] !== 0x44 || r[1] !== 0x4C) {
            throw new Error('bad reply');
        }
        const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
        return Array.from({length: count}, (_, i) => {
            const seq = v.getUint32(2 + (4 * i));
            return (seq === 0xFFFFFFFF) ? null : seq;
        });
    }

    // Window bytes as they are (READ_CHUNK at most), tried three times
    async readPlain(address, length) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.read(AREA_FLASH, address, length);
            } catch (e) {
                if (e.message === 'refused' || attempt >= 2) {
                    throw e;
                }
            }
        }
    }

    async command(...bytes) {
        await this.send([0x43, ...bytes]);
        await this.receive(1).catch(() => {});
    }

    closeScreen() {
        return this.command(5);
    }

    // Bytes of the language slots and font files (raw addresses); null: a firmware without them (before 0.8.0)
    async readLanguageArea(address, length) {
        const out = new Uint8Array(length);
        for (let at = 0; at < length; at += READ_CHUNK) {
            const n = Math.min(READ_CHUNK, length - at);
            for (let attempt = 0; ; attempt++) {
                try {
                    out.set(await this.read(AREA_LANGUAGES, address + at, n), at);
                    break;
                } catch (e) {
                    if (e.message === 'refused') {
                        return null;
                    }
                    if (attempt >= 2) {
                        throw e;
                    }
                }
            }
        }
        return out;
    }

    // The languages and fonts written: the radio reads them again, without a restart
    reloadLanguages() {
        return this.command(8);
    }

    // The radio's settings from its RAM to the flash (they are saved there only when changed in the menus, at power
    // off and before a restart): read after this, the flash has them as the radio uses them; written after this, the
    // restart does not save the old ones over them
    saveSettings() {
        return this.command(6, 2);
    }

    restart() {
        return this.command(6, 1);
    }
}
