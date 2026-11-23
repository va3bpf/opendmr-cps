// The DM-32's chip bootloader (as tools/backup/dm32_dump.py): the radio switched off, this waits for the bootloader's
// request at power on, answers it, loads the flash reader (dumper-bin.js, built from tools/backup/dumper/dumper.c)
// into the RAM, starts it, and reads a whole chip:
//
//   bootloader at power on: 02 24 00 03 -> 02 14 00 03
//   256-byte blocks: 02 18 sum(4 + payload) 03 + addr(4) 00 00 00 40 data(256) -> 02 05 00 03
//   start: 02 1B sum(4 + entry) 03 + entry(4) -> 02 05 00 03, then "DMP1" + the UART divisor(2)
//   the reader: 'I' chip -> 'I' + 3 JEDEC bytes; 'R' chip addr(4) count(4) -> count frames 'D' + 4 KB + crc32(4)
//               'S' divisor(2) -> 'S', 'H' -> "DMP1" + divisor, 'Y' -> 'Y'; 'P' done(2) total(2) -> 'P'

import {RawPort} from './serial.js';
import {dumperImage} from './assets.js';
import {Screen, GREY, GREEN, RED} from './screen.js';
import {crc32} from '../codeplug/oddb.js';

const BLOCK = 4096;
const LOAD_ADDRESS = 0x10000;
const SLOW = 115200;
const FAST = 250000;
const BOOT_REQUEST = new Uint8Array([0x02, 0x24, 0x00, 0x03]);
const BOOT_ANSWER = new Uint8Array([0x02, 0x14, 0x00, 0x03]);
const ACK_OK = new Uint8Array([0x02, 0x05, 0x00, 0x03]);
const SIZES = {0x14: 1 << 20, 0x15: 2 << 20, 0x18: 16 << 20}; // JEDEC capacity byte -> bytes

export const CHIP_DATA = 0;    // the 25Q128, 16 MB: the codeplug, the settings, the factory calibration sector
export const CHIP_PROGRAM = 1; // the program flash: the bootloader and the firmware

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Bootloader {
    constructor(port = null) {
        this.s = new RawPort();
        this.port = port;
        this.slow = true;
        this.screen = null;
    }

    async open() {
        await this.s.open(this.port, SLOW);
    }

    async close() {
        await this.s.close();
    }

    // The bootloader's request comes at power on: switch the radio off, start this, then switch it on
    async waitForBootloader(timeoutMs = 30000, onWait = null) {
        onWait?.();
        const found = await this.s.until(BOOT_REQUEST, timeoutMs);
        if (!found) {
            throw new Error('no bootloader: switch the radio off and on again, with the cable in');
        }
        await this.s.write(BOOT_ANSWER);
        await sleep(50);
    }

    async upload(image) {
        const padded = new Uint8Array(Math.ceil(image.length / 256) * 256);
        padded.set(image);
        for (let offset = 0; offset < padded.length; offset += 256) {
            const payload = new Uint8Array(8 + 256);
            new DataView(payload.buffer).setUint32(0, LOAD_ADDRESS + offset);
            payload.set([0x00, 0x00, 0x00, 0x40], 4);
            payload.set(padded.subarray(offset, offset + 256), 8);
            const frame = new Uint8Array(4 + payload.length);
            frame[0] = 0x02;
            frame[1] = 0x18;
            frame[2] = payload.reduce((sum, b) => (sum + b) & 0xFF, 0);
            frame[3] = 0x03;
            frame.set(payload, 4);
            await this.s.write(frame);
            const ack = await this.s.read(4, 5000);
            if (!same(ack, ACK_OK)) {
                throw new Error(`the bootloader did not take block ${offset / 256}`);
            }
        }
        const entry = new Uint8Array(8);
        entry[0] = 0x02;
        entry[1] = 0x1B;
        entry[3] = 0x03;
        new DataView(entry.buffer).setUint32(4, LOAD_ADDRESS);
        entry[2] = (entry[4] + entry[5] + entry[6] + entry[7]) & 0xFF;
        await this.s.write(entry);
        if (!same(await this.s.read(4, 5000), ACK_OK)) {
            throw new Error('the bootloader did not start the reader');
        }
    }

    async hello(timeoutMs = 3000) {
        const reply = await this.s.read(6, timeoutMs);
        const text = String.fromCharCode(...reply.subarray(0, 4));
        if (text !== 'DMP1') {
            return null;
        }
        return new DataView(reply.buffer, reply.byteOffset + 4, 2).getUint16(0);
    }

    // The reader's UART to 250000: its divisor scaled from the one of 115200, checked both ways, else the slow one
    async speedUp(divisor) {
        const newDivisor = Math.round((divisor * SLOW) / FAST);
        const actual = (divisor * SLOW) / newDivisor;
        if (newDivisor < 1 || Math.abs(actual - FAST) / FAST > 0.03) {
            return false;
        }
        const ask = new Uint8Array(3);
        ask[0] = 0x53; // 'S'
        new DataView(ask.buffer).setUint16(1, newDivisor);
        await this.s.write(ask);
        if ((await this.s.read(1, 3000))[0] !== 0x53) {
            throw new Error('no answer to the speed change');
        }
        await this.s.setBaud(FAST);
        await sleep(50);
        this.s.clear();
        await this.s.write(new Uint8Array([0x48])); // 'H'
        try {
            if (await this.hello(1000)) {                await this.s.write(new Uint8Array([0x59])); // 'Y'
                if ((await this.s.read(1, 1000))[0] === 0x59) {
                    this.slow = false;
                    return true;
                }
            }
        } catch (e) {
            // the speed was not taken
        }
        await this.s.setBaud(SLOW);
        await sleep(10000); // the reader goes back by itself
        this.s.clear();
        return false;
    }

    async jedecId(chip) {
        await this.s.write(new Uint8Array([0x49, chip])); // 'I'
        const reply = await this.s.read(4, 3000);
        if (reply[0] !== 0x49) {
            throw new Error('no answer to the ID request');
        }
        return reply.subarray(1);
    }

    // count blocks from address; a damaged frame (its CRC) is null
    async readBlocks(chip, address, count) {
        const ask = new Uint8Array(10);
        ask[0] = 0x52; // 'R'
        ask[1] = chip;
        new DataView(ask.buffer).setUint32(2, address);
        new DataView(ask.buffer).setUint32(6, count);
        await this.s.write(ask);
        const blocks = [];
        for (let i = 0; i < count; i++) {
            const frame = await this.s.read(1 + BLOCK + 4, 10000);
            if (frame[0] !== 0x44) { // 'D'
                throw new Error('the reader stopped');
            }
            const data = frame.subarray(1, 1 + BLOCK);
            const want = new DataView(frame.buffer, frame.byteOffset + 1 + BLOCK, 4).getUint32(0);
            blocks.push(crc32(data) === want ? data : null);
        }
        return blocks;
    }

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

    // A whole chip into out (a Uint8Array). onBlock(done, total) is called per block; shouldStop() ends it early
    async readChip(chip, out, onBlock = null, shouldStop = null) {
        const total = Math.floor(out.length / BLOCK);
        let n = 0;
        let failures = 0;
        while (n < total) {
            if (shouldStop?.()) {
                throw new Error('stopped');
            }
            if (failures >= 10) {
                throw new Error(`10 errors in a row at 0x${(n * BLOCK).toString(16)}`);
            }
            const todo = Math.min(64, total - n); // 256 KB a request: a lost byte costs one request
            let blocks;
            try {
                blocks = await this.readBlocks(chip, n * BLOCK, todo);
            } catch (e) {
                this.s.clear();
                failures++;
                continue;
            }
            let good = 0;
            for (const data of blocks) {
                if (!data) {
                    break;
                }
                out.set(data, (n + good) * BLOCK);
                good++;
            }
            failures = good ? 0 : failures + 1;
            n += good;
            await this.progress(n, total);
            const percent = Math.floor((n * 100) / total);
            if (percent >= (this.shown ?? 0) + 5 || n === total) { // the radio's text, each 5 %
                this.shown = percent;
                await this.screen?.line('percent', `${percent}%`);
            }
            onBlock?.(n, total);
        }
        return out;
    }

    // The whole chip: "switch it off, start, switch it on" is the caller's; returns its size and the bytes
    async dump(chip, onBlock = null, shouldStop = null, onWait = null) {
        await this.prepare(onWait);
        const id = await this.jedecId(chip);
        const size = SIZES[id[2]];
        if (!size) {
            throw new Error(`unknown capacity byte 0x${id[2].toString(16)}`);
        }
        const out = new Uint8Array(size);
        this.shown = 0;
        this.screen = new Screen(this.s);
        await this.screen.line('title', 'Copia de seguridad');
        await this.screen.line('chip', chip === CHIP_DATA ? 'Datos 25Q128' : 'Programa', GREY);
        await this.screen.line('chip', 'No apagar', RED);
        await this.screen.line('percent', '0%');
        await this.readChip(chip, out, onBlock, shouldStop);
        await this.screen.line('title', 'Copia lista', GREEN);
        return {id, size, data: out};
    }

    // Bootloader, reader, speed: the radio off, this waiting, then switched on
    async prepare(onWait = null) {
        await this.waitForBootloader(30000, onWait);
        await this.upload(await dumperImage());
        const divisor = await this.hello();
        if (divisor === null) {
            throw new Error('the reader did not start');
        }
        try {
            await this.speedUp(divisor);
        } catch (e) {
            // read slowly rather than not at all
        }
    }

    // The radio's CRC-32 of count sectors from address, 64 a request
    async sectorCrcs(chip, address, count) {
        const crcs = [];
        while (crcs.length < count) {
            const n = Math.min(64, count - crcs.length);
            const ask = new Uint8Array(10);
            ask[0] = 0x43; // 'C'
            ask[1] = chip;
            new DataView(ask.buffer).setUint32(2, address + (crcs.length * BLOCK));
            new DataView(ask.buffer).setUint32(6, n);
            await this.s.write(ask);
            const reply = await this.s.read(4 * n, 10000);
            const view = new DataView(reply.buffer, reply.byteOffset, reply.length);
            for (let i = 0; i < n; i++) {
                crcs.push(view.getUint32(4 * i));
            }
        }
        return crcs;
    }

    async writeSector(chip, address, data, flag = 0) {
        const crc = new Uint8Array(4);
        new DataView(crc.buffer).setUint32(0, crc32(data));
        for (let attempt = 0; attempt < 4; attempt++) {
            const ask = new Uint8Array(6);
            ask[0] = 0x58; // 'X'
            ask[1] = chip | flag;
            new DataView(ask.buffer).setUint32(2, address);
            await this.s.write(concat(ask, data, crc));
            let answer = null;
            try {
                answer = await this.s.read(1, 10000);
            } catch (e) {
                answer = null;
            }
            if (answer && answer[0] === 0x4B) { // 'K'
                return;
            }
            if (answer && answer[0] === 0x45) { // 'E'
                const error = (await this.s.read(1, 3000))[0];
                if (error === 4) { // busy: again
                    await sleep(50);
                    continue;
                }
                throw new Error(`sector 0x${address.toString(16)}: error ${error}`);
            }
            this.s.clear();
            await sleep(100);
        }
        throw new Error(`sector 0x${address.toString(16)}: not written`);
    }

    // data to the chip at offset: the sectors that differ only, the bootloader area only with writeBoot; then all
    // compared. offset 0xC000 with the firmware image (opendmr.bin) writes the firmware area as the update does
    async restore(chip, data, opts = {}) {
        const offset = opts.offset ?? 0;
        const count = Math.floor(data.length / BLOCK);
        const wanted = [];
        for (let i = 0; i < count; i++) {
            wanted.push(crc32(data.subarray(i * BLOCK, (i + 1) * BLOCK)));
        }
        this.shownWrite = 0;
        this.screen = new Screen(this.s);
        await this.screen.line('title', opts.offset ? 'Instalando' : 'Escribiendo copia');
        await this.screen.line('chip', 'No apagar', RED);
        await this.screen.line('percent', '0%');
        let skip = 0;
        if (chip === CHIP_PROGRAM && !opts.writeBoot) {
            skip = Math.max(0, Math.min(count, Math.floor((0xC000 - offset) / BLOCK))); // the bootloader as it is
        }
        const have = await this.sectorCrcs(chip, offset, count);
        let todo = [];
        for (let i = skip; i < count; i++) {
            if (opts.force || have[i] !== wanted[i]) {
                todo.push(i);
            }
        }
        let written = 0;
        for (let k = 0; k < todo.length; k++) {
            if (opts.shouldStop?.()) {
                throw new Error('stopped');
            }
            const i = todo[k];
            await this.writeSector(chip, offset + (i * BLOCK), data.subarray(i * BLOCK, (i + 1) * BLOCK),
                opts.writeBoot ? 0x80 : 0);
            written++;
            await this.progress(k + 1, todo.length);
            const percent = Math.floor(((k + 1) * 100) / todo.length);
            if (percent >= (this.shownWrite ?? 0) + 5 || k + 1 === todo.length) {
                this.shownWrite = percent;
                await this.screen.line('percent', `${percent}%`);
            }
            opts.onBlock?.(k + 1, todo.length);
        }
        const after = await this.sectorCrcs(chip, offset, count);
        const bad = [];
        for (let i = skip; i < count; i++) {
            if (after[i] !== wanted[i]) {
                bad.push(i);
            }
        }
        if (bad.length) {
            throw new Error(`${bad.length} sectors still differ, first 0x${(offset + (bad[0] * BLOCK)).toString(16)}`);
        }
        await this.screen.line('title', 'Listo', GREEN);
        return written;
    }
}

function same(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function concat(...parts) {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
