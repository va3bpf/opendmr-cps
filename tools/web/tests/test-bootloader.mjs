// A simulated chip bootloader over a fake SerialPort: runs the real js/radio/bootloader.js against it.
//   node tools/web/tests/test-bootloader.mjs
import {Bootloader, CHIP_PROGRAM} from '../../../js/radio/bootloader.js';
import {crc32} from '../../../js/codeplug/oddb.js';
import {setRelease} from '../../../js/radio/assets.js';

// The programs the radio runs come from the chosen OpenDMR release folder: a stand-in one (the simulated radio does
// not run them)
await setRelease([{path: 'OpenDMR-test/opendmr.bin', data: new Uint8Array(4096)},
    {path: 'OpenDMR-test/tools/debug/updater/updater.bin', data: new Uint8Array(3500)},
    {path: 'OpenDMR-test/tools/backup/dumper/dumper.bin', data: new Uint8Array(4700)}]);

const BOOT_REQUEST = new Uint8Array([0x02, 0x24, 0x00, 0x03]);
const BOOT_ANSWER = new Uint8Array([0x02, 0x14, 0x00, 0x03]);
const ACK_OK = new Uint8Array([0x02, 0x05, 0x00, 0x03]);

function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

function equal(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

class SimBoot {
    constructor() {
        this.chip = new Uint8Array(1 << 20);
        for (let i = 0; i < this.chip.length; i++) {
            this.chip[i] = (i * 7) & 0xFF;
        }
        this.pending = [];
        this.reader = false;
        this.powered = false;
    }

    push(bytes) {
        this.pending.push(bytes);
    }

    take() {
        const out = concat(...this.pending);
        this.pending = [];
        return out;
    }

    boot() {
        if (!this.powered) {
            this.powered = true;
            this.push(BOOT_REQUEST);
        }
    }

    onWrite(b) {
        if (b.length === 4 && equal(b, BOOT_ANSWER)) {
            return;
        }
        if (b.length >= 4 && b[0] === 0x02 && b[1] === 0x18) { // a 256-byte block
            const payload = b.subarray(4);
            const sum = payload.reduce((s, x) => (s + x) & 0xFF, 0);
            if (sum !== b[2] || payload.length !== 264) {
                throw new Error('sim: bad upload frame');
            }
            this.push(ACK_OK);
            return;
        }
        if (b.length === 8 && b[0] === 0x02 && b[1] === 0x1B) { // start
            this.push(ACK_OK);
            this.reader = true;
            this.push(concat(new TextEncoder().encode('DMP1'), new Uint8Array([0, 48])));
            return;
        }
        if (!this.reader) {
            throw new Error('sim: the reader is not started');
        }
        const c = b[0];
        if (c === 0x53) { // 'S'
            this.push(new Uint8Array([0x53]));
            return;
        }
        if (c === 0x48) { // 'H'
            this.push(concat(new TextEncoder().encode('DMP1'), new Uint8Array([0, 48])));
            return;
        }
        if (c === 0x59) { // 'Y'
            this.push(new Uint8Array([0x59]));
            return;
        }
        if (c === 0x49) { // 'I'
            this.push(new Uint8Array([0x49, 0xEF, 0x40, 0x14])); // 1 MB
            return;
        }
        if (c === 0x52) { // 'R'
            const address = new DataView(b.buffer, b.byteOffset + 2, 4).getUint32(0);
            const count = new DataView(b.buffer, b.byteOffset + 6, 4).getUint32(0);
            for (let i = 0; i < count; i++) {
                const block = this.chip.subarray(address + (i * 4096), address + (i * 4096) + 4096);
                const crc = new Uint8Array(4);
                new DataView(crc.buffer).setUint32(0, crc32(block));
                this.push(concat(new Uint8Array([0x44]), block, crc));
            }
            return;
        }
        if (c === 0x50) { // 'P'
            this.push(new Uint8Array([0x50]));
            return;
        }
        if (c === 0x43) { // 'C' chip addr count
            const address = new DataView(b.buffer, b.byteOffset + 2, 4).getUint32(0);
            const count = new DataView(b.buffer, b.byteOffset + 6, 4).getUint32(0);
            const out = new Uint8Array(4 * count);
            for (let i = 0; i < count; i++) {
                new DataView(out.buffer).setUint32(4 * i,
                    crc32(this.chip.subarray(address + (i * 4096), address + (i * 4096) + 4096)));
            }
            this.push(out);
            return;
        }
        if (c === 0x58) { // 'X' chip|flag addr data crc
            const address = new DataView(b.buffer, b.byteOffset + 2, 4).getUint32(0);
            const data = b.subarray(6, 6 + 4096);
            const crc = new DataView(b.buffer, b.byteOffset + 6 + 4096, 4).getUint32(0);
            if (crc32(data) !== crc) {
                throw new Error('sim: bad sector crc');
            }
            this.chip.set(data, address);
            this.written = (this.written ?? 0) + 1;
            this.push(new Uint8Array([0x4B]));
            return;
        }
        throw new Error('sim: reader got 0x' + c.toString(16));
    }
}

class FakePort {
    constructor(radio) {
        this.radio = radio;
        this.controller = null;
    }

    async open({baudRate}) {
        this.baud = baudRate;
        this.readable = new ReadableStream({
            start: (controller) => {
                this.controller = controller;
            },
            cancel: () => {},
        });
        this.radio.onData = (bytes) => this.controller.enqueue(bytes);
        this.radio.boot();
        const atPowerOn = this.radio.take();
        if (atPowerOn.length) {
            this.radio.onData(atPowerOn);
        }
    }

    async close() {
        try {
            this.controller?.close();
        } catch (e) {
            // done
        }
        this.controller = null;
    }

    get writable() {
        return new WritableStream({
            write: (chunk) => {
                const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                this.radio.onWrite(bytes);
                const out = this.radio.take();
                if (out.length) {
                    this.radio.onData(out);
                }
            },
        });
    }
}

const sim = new SimBoot();
const boot = new Bootloader(new FakePort(sim));
let last = null;
await boot.open();
const result = await boot.dump(CHIP_PROGRAM, (done, total) => {
    last = [done, total];
}, null, () => {});
await boot.close();

const read = result.size === sim.chip.length && result.data.every((v, i) => v === sim.chip[i]);
console.log('read', result.size, 'bytes, progress', last, read ? 'OK' : 'FAILED');

// one sector of the firmware area spoilt, the backup written back: one sector written
sim.chip.fill(0x00, 20 * 4096, 21 * 4096);
sim.reader = false;
sim.powered = false;
sim.written = 0;
const boot2 = new Bootloader(new FakePort(sim));
await boot2.open();
await boot2.prepare(() => {});
const written = await boot2.restore(CHIP_PROGRAM, result.data, {onBlock: () => {}});
await boot2.close();
const back = sim.chip.every((v, i) => v === result.data[i]);
console.log('restore wrote', written, 'sectors; chip as the backup:', back);

const ok = read && back && written === 1;
console.log(ok ? 'BOOTLOADER OK' : 'BOOTLOADER FAILED');
process.exit(ok ? 0 : 1);
