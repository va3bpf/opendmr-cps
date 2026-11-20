// A simulated radio over a fake SerialPort: runs the real js/radio/updater.js against it (no radio needed).
//   node tools/web/tests/test-updater.mjs
import {Updater, prepareImage} from '../../../js/radio/updater.js';
import {crc32} from '../../../js/codeplug/oddb.js';

const UART_CLOCK = 84000000 / 16;

function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

class SimRadio {
    constructor() {
        this.flash = new Uint8Array(1 << 20).fill(0xFF); // the program flash
        this.state = 'firmware'; // firmware | update
        this.divisor = null;
        this.pending = [];
        this.wrote = 0;
        this.restarted = false;
    }

    push(bytes) {
        this.pending.push(bytes);
    }

    take() {
        const out = concat(...this.pending);
        this.pending = [];
        return out;
    }

    onWrite(bytes) {
        if (process.env.TRACE) {
            console.log('write', this.state, bytes.length,
                Array.from(bytes.subarray(0, 10)).map((x) => x.toString(16)).join(' '));
        }
        let i = 0;
        while (i < bytes.length) {
            const at = this.handle(bytes.subarray(i));
            if (at <= 0) {
                throw new Error('sim: no progress at byte ' + i);
            }
            i += at;
        }
    }

    handle(b) {
        if (this.state === 'firmware') {
            if (String.fromCharCode(...b.subarray(0, 6)) === 'DUUPD!') {
                this.state = 'update';
                const area = new Uint8Array(8);
                new DataView(area.buffer).setUint32(0, 0x44400);
                new DataView(area.buffer).setUint32(4, 0x10000);
                // the cable link's reply 'D' 'U' ok area size, then the loader's own hello
                this.push(concat(new TextEncoder().encode('DU'), new Uint8Array([1]), area));
                this.push(concat(new TextEncoder().encode('UPL1'), area));
                return 6;
            }
            if (b[0] === 0x48) { // 'H'
                this.push(new TextEncoder().encode('UPD1'));
                return 1;
            }
            if (b[0] === 0x44 && b[1] === 0x56) { // 'DV'
                this.push(new TextEncoder().encode('DV'));
                return 11;
            }
            throw new Error('sim: firmware got ' +
                Array.from(b.subarray(0, 12)).map((x) => x.toString(16)).join(' '));
        }
        const c = b[0];
        if (c === 0x4C) { // 'L' area len image crc
            const area = new DataView(b.buffer, b.byteOffset + 1, 4).getUint32(0);
            const len = new DataView(b.buffer, b.byteOffset + 5, 4).getUint32(0);
            const image = b.subarray(9, 9 + len);
            const crc = new DataView(b.buffer, b.byteOffset + 9 + len, 4).getUint32(0);
            if (area !== 0x44400 || crc32(image) !== crc) {
                this.push(new Uint8Array([0x45]));
            } else {
                this.push(new Uint8Array([0x4B])); // 'K'
            }
            return 9 + len + 4;
        }
        if (c === 0x4A) { // 'J' area
            this.push(new Uint8Array([0x4A]));
            this.push(new TextEncoder().encode('UPD1'));
            return 5;
        }
        if (c === 0x48) { // 'H'
            if (this.divisor !== null) {
                this.push(new TextEncoder().encode('UPD1'));
            }
            return 1;
        }
        if (c === 0x53) { // 'S' divisor
            this.divisor = new DataView(b.buffer, b.byteOffset + 1, 2).getUint16(0);
            this.push(new Uint8Array([0x53]));
            return 3;
        }
        if (c === 0x59) { // 'Y'
            this.push(new Uint8Array([0x59]));
            return 1;
        }
        if (c === 0x43) { // 'C' addr
            const address = new DataView(b.buffer, b.byteOffset + 1, 4).getUint32(0);
            const reply = new Uint8Array(5);
            reply[0] = 0x43;
            new DataView(reply.buffer).setUint32(1,
                crc32(this.flash.subarray(address - 0xC000, address - 0xC000 + 4096)));
            this.push(reply);
            return 5;
        }
        if (c === 0x57) { // 'W' addr data crc
            const address = new DataView(b.buffer, b.byteOffset + 1, 4).getUint32(0);
            const data = b.subarray(5, 5 + 4096);
            const crc = new DataView(b.buffer, b.byteOffset + 5 + 4096, 4).getUint32(0);
            if (crc32(data) !== crc) {
                this.push(new Uint8Array([0x45, 1]));
            } else {
                this.flash.set(data, address - 0xC000);
                this.wrote++;
                this.push(new Uint8Array([0x4B]));
            }
            return 5 + 4096 + 4;
        }
        if (c === 0x50) { // 'P'
            this.push(new Uint8Array([0x50]));
            return 5;
        }
        if (c === 0x42) { // 'B'
            this.restarted = true;
            this.state = 'firmware';
            this.push(new Uint8Array([0x42]));
            return 1;
        }
        throw new Error('sim: update program got 0x' + c.toString(16));
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

const radio = new SimRadio();
const port = new FakePort(radio);
const updater = new Updater(port);

const image = new Uint8Array(128 * 4096).fill(0x11); // 512 KB: past 0x489F8
image.set(new TextEncoder().encode('DM32-SERIAL-UPDATE-LOADER-1'), 0x489F8); // where 0.6.1 has it, not near the start
const prepared = prepareImage(image);

// not a firmware with the loader: refused
let refused = false;
try {
    prepareImage(new Uint8Array(8192));
} catch (e) {
    refused = true;
}
if (!refused) {
    console.log('an image without the loader marker was accepted');
    process.exit(1);
}
console.log('image', prepared.length, 'bytes,', prepared.length / 4096, 'sectors');

await updater.open();
await updater.writeImage(prepared, null);
await updater.close();

const ok = radio.restarted && radio.wrote === prepared.length / 4096 &&
    crc32(radio.flash.subarray(0, prepared.length)) === crc32(prepared);
console.log('wrote', radio.wrote, 'sectors, restarted:', radio.restarted);
console.log(ok ? 'UPDATER OK' : 'UPDATER FAILED');
process.exit(ok ? 0 : 1);
