// A programming-cable port at the byte level, for the flasher: the firmware update program (tools/debug/fw_update.py)
// and the chip bootloader (tools/backup/dm32_dump.py) speak raw bytes with markers, not the CPS's request/reply
// framing of link.js. One reader loop and a byte queue: read(n), until(marker), and the speed changes of Web Serial
// (a port's baud is set when it opens).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function indexOf(haystack, needle) {
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

export class RawPort {
    constructor() {
        this.port = null;
        this.baud = 0;
        this.chunks = [];   // what came and was not taken yet
        this.length = 0;
        this.reader = null;
        this.reading = null;
        this.waiter = null;
    }

    static supported() {
        return 'serial' in navigator;
    }

    get connected() {
        return this.port !== null;
    }

    // port: an already picked SerialPort, or none (the user picks one)
    async open(port = null, baud = 115200) {
        this.port = port ?? await navigator.serial.requestPort();
        await this.port.open({baudRate: baud, bufferSize: 1 << 20});
        this.baud = baud;
        this.chunks = [];
        this.length = 0;
        this.reading = this.readLoop();
    }

    // Web Serial sets the baud when a port opens: close the reader, the port, then open it again
    async setBaud(baud) {
        if (this.baud === baud) {
            return;
        }
        const port = this.port;
        await this.stopReader();
        await port.close().catch(() => {});
        await port.open({baudRate: baud, bufferSize: 1 << 20});
        this.baud = baud;
        this.chunks = [];
        this.length = 0;
        this.reading = this.readLoop();
    }

    async stopReader() {
        try {
            await this.reader?.cancel();
            await this.reading;
        } catch (e) {
            // the reader was done
        }
        this.reader = null;
    }

    async close() {
        if (!this.port) {
            return;
        }
        await this.stopReader();
        await this.port.close().catch(() => {});
        this.port = null;
    }

    async readLoop() {
        const reader = this.port.readable.getReader();
        this.reader = reader;
        try {
            for (;;) {
                const {value, done} = await reader.read();
                if (done) {
                    break;
                }
                if (value?.length) {
                    this.chunks.push(value);
                    this.length += value.length;
                    this.waiter?.();
                    this.waiter = null;
                }
            }
        } catch (e) {
            // the port closed or the reader was cancelled
        } finally {
            try {
                reader.releaseLock();
            } catch (e) {
                // already released
            }
        }
    }

    async write(bytes) {
        const writer = this.port.writable.getWriter();
        try {
            await writer.write(bytes);
        } finally {
            writer.releaseLock();
        }
    }

    clear() {
        this.chunks = [];
        this.length = 0;
    }

    take(n) {
        const out = new Uint8Array(n);
        let o = 0;
        while (o < n) {
            const c = this.chunks[0];
            const k = Math.min(c.length, n - o);
            out.set(c.subarray(0, k), o);
            o += k;
            if (k === c.length) {
                this.chunks.shift();
            } else {
                this.chunks[0] = c.subarray(k);
            }
        }
        this.length -= n;
        return out;
    }

    unshift(bytes) {
        if (bytes.length) {
            this.chunks.unshift(bytes);
            this.length += bytes.length;
        }
    }

    // n bytes, or an error after timeoutMs
    async read(n, timeoutMs = 3000) {
        const end = performance.now() + timeoutMs;
        while (this.length < n) {
            const left = end - performance.now();
            if (left <= 0) {
                throw new Error(`no answer (${this.length} of ${n} bytes)`);
            }
            await this.waitData(left);
        }
        return this.take(n);
    }

    // everything up to and including marker; the bytes after it go back to the queue. null: timeout
    async until(marker, timeoutMs = 3000) {
        const acc = [];
        let size = 0;
        const joined = () => {
            const out = new Uint8Array(size);
            let o = 0;
            for (const c of acc) {
                out.set(c, o);
                o += c.length;
            }
            return out;
        };
        const end = performance.now() + timeoutMs;
        for (;;) {
            if (size >= marker.length) {
                const data = joined();
                const k = indexOf(data, marker);
                if (k >= 0) {
                    const stop = k + marker.length;
                    this.unshift(data.subarray(stop));
                    return data.subarray(0, stop);
                }
            }
            const left = end - performance.now();
            if (left <= 0) {
                return null;
            }
            await this.waitData(left);
            if (this.length) {
                const c = this.take(this.length);
                acc.push(c);
                size += c.length;
            }
        }
    }

    // n bytes after marker in data, or null (reads more meanwhile)
    async after(data, marker, n, timeoutMs = 3000) {
        const acc = [data];
        let size = data.length;
        const end = performance.now() + timeoutMs;
        for (;;) {
            const joined = new Uint8Array(size);
            let o = 0;
            for (const c of acc) {
                joined.set(c, o);
                o += c.length;
            }
            const k = indexOf(joined, marker);
            if (k >= 0 && (joined.length >= k + marker.length + n)) {
                const at = k + marker.length;
                const tail = joined.subarray(at + n);
                this.unshift(tail);
                return joined.subarray(at, at + n);
            }
            const left = end - performance.now();
            if (left <= 0) {
                return null;
            }
            await this.waitData(left);
            if (this.length) {
                const c = this.take(this.length);
                acc.push(c);
                size += c.length;
            }
        }
    }

    async waitData(timeoutMs) {
        if (this.length) {
            return;
        }
        await Promise.race([
            new Promise((resolve) => {
                this.waiter = resolve;
            }),
            sleep(Math.max(1, Math.min(timeoutMs, 1000))),
        ]);
        this.waiter = null;
    }
}
