// The radio's screen while the update program or the flash reader runs: the same 1-bit text pictures that
// tools/backup/dm32_dump.py draws with Pillow, sent as the 'T' request both programs take:
//
//   'T' x(2) y(2) w(2) h(2) colour(2) bits(h * ((w + 7) / 8))  ->  'T' once drawn
//   rows top first, the left pixel in a byte's high bit, each row whole bytes; the colour is the panel's 16 bits
//   (BGR565, dumper.c colour())

const WIDTH = 240;
const BYTES_PER_ROW = (WIDTH + 7) >> 3;

// dumper.c colour(): BGR565
function colour(r, g, b) {
    return (((b & 0xF8) << 8) | ((g & 0xFC) << 3) | (r >> 3)) & 0xFFFF;
}

export const WHITE = colour(255, 255, 255);
export const GREY = colour(160, 160, 160);
export const GREEN = colour(0, 210, 0);
export const RED = colour(240, 40, 40);

// y, font size, bold, as dm32_dump.py's Screen.LINES
const LINES = {
    title: [14, 26, true],
    chip: [50, 20, false],
    id: [78, 20, false],
    percent: [114, 52, true],
    amount: [226, 22, false],
    speed: [256, 20, false],
    left: [284, 20, false],
};

// The text as the 1-bit rows the radio takes; null when there is no canvas to draw it (a test, an old browser)
function bitmap(text, size, bold) {
    if (typeof document === 'undefined') {
        return null;
    }
    const height = size + 6;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) {
        return null;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.fillStyle = '#fff';
    ctx.font = `${bold ? 'bold ' : ''}${size}px Roboto Condensed, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, WIDTH / 2, height / 2);
    const pixels = ctx.getImageData(0, 0, WIDTH, height).data;
    const out = new Uint8Array(BYTES_PER_ROW * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (pixels[((y * WIDTH) + x) * 4] > 127) { // the red channel: white or black
                out[(y * BYTES_PER_ROW) + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }
    return {height, bits: out};
}

export class Screen {
    constructor(port) {
        this.port = port;
        this.shown = {}; // a line is sent only when it changes
        this.enabled = true;
        this.sent = 0;     // lines the radio took ('T' back)
        this.failed = 0;   // lines it did not answer for
    }

    // One of LINES, or the position given
    async line(which, text, colour = WHITE) {
        if (!this.enabled) {
            return;
        }
        const [y, size, bold] = LINES[which] ?? [which, 20, false];
        const key = `${which}/${text}/${colour}`;
        if (this.shown[which] === key) {
            return; // already on the screen
        }
        this.shown[which] = key;
        const image = bitmap(text, size, bold);
        if (!image) {
            this.enabled = false; // no canvas: the radio's screen stays as it is, the page still says what happens
            return;
        }
        const head = new Uint8Array(11);
        head[0] = 0x54; // 'T'
        const view = new DataView(head.buffer);
        view.setUint16(1, 0);            // x
        view.setUint16(3, y);            // y
        view.setUint16(5, WIDTH);        // w
        view.setUint16(7, image.height); // h
        view.setUint16(9, colour);
        const frame = new Uint8Array(head.length + image.bits.length);
        frame.set(head);
        frame.set(image.bits, head.length);
        await this.port.write(frame);
        let acked = false;
        try {
            acked = (await this.port.read(1, 2000))[0] === 0x54; // 'T'
        } catch (e) {
            acked = false;
        }
        if (acked) {
            this.sent++;
        } else {
            this.failed++;
        }
        this.shown[which] = key;
        return acked;
    }
}
