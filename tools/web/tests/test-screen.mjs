// The 'T' text frames the update program and the flash reader take: the header and the size the radio waits for
// (h rows of 30 bytes).   node tools/web/tests/test-screen.mjs

// a canvas that draws nothing: the pixels stay black, so the bits are zero and only the frame is checked
const WIDTH = 240;
globalThis.document = {
    createElement() {
        const canvas = {width: 0, height: 0};
        canvas.getContext = () => ({
            fillStyle: '', font: '', textAlign: '', textBaseline: '',
            fillRect() {},
            fillText() {},
            getImageData: () => ({data: new Uint8ClampedArray(WIDTH * canvas.height * 4)}),
        });
        return canvas;
    },
};

const {Screen, WHITE, RED} = await import('../../../js/radio/screen.js');

const writes = [];
const port = {
    async write(bytes) {
        writes.push(bytes);
    },
    async read(n, timeout) {
        return new Uint8Array(n); // the radio's 'T'
    },
};

const screen = new Screen(port);
await screen.line('title', 'Actualizando');
await screen.line('percent', '50%', RED);
await screen.line('percent', '50%', RED); // the same line again: not sent

const errors = [];
const expected = [[0, 14, 26 + 6], [0, 114, 52 + 6]];
if (writes.length !== 2) {
    errors.push(`expected 2 frames, got ${writes.length}`);
}
writes.forEach((frame, i) => {
    const [x, y, h] = expected[i] ?? [];
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
    if (frame[0] !== 0x54) {
        errors.push(`frame ${i}: not 'T'`);
    }
    if (view.getUint16(1) !== x || view.getUint16(3) !== y || view.getUint16(5) !== WIDTH || view.getUint16(7) !== h) {
        errors.push(`frame ${i}: header ${view.getUint16(1)},${view.getUint16(3)},${view.getUint16(5)},` +
            `${view.getUint16(7)} (expected ${x},${y},${WIDTH},${h})`);
    }
    if (frame.length !== 11 + ((WIDTH + 7) >> 3) * h) {
        errors.push(`frame ${i}: ${frame.length} bytes (expected ${11 + ((WIDTH + 7) >> 3) * h})`);
    }
    const colour = view.getUint16(9);
    if (colour !== (i === 0 ? WHITE : RED)) {
        errors.push(`frame ${i}: colour 0x${colour.toString(16)}`);
    }
});
console.log('frames:', writes.map((f) => f.length).join(' + '));
console.log(errors.length ? 'SCREEN: ' + errors.join(' | ') : 'SCREEN OK');
process.exit(errors.length ? 1 : 0);
