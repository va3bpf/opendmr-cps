// assets.js: served from a folder it reads assets/*.bin; from disk (no fetch) the embedded copy.
//   node tools/web/tests/test-assets.mjs
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const real = await readFile(join(ROOT, 'assets', 'updater.bin'));

// a modified updater.bin served on purpose: if the result matches it, the file was read, not the embedded copy
const served = new Uint8Array(real.length + 4);
served.set(real);
served.set([0xDE, 0xAD, 0xBE, 0xEF], real.length);

const server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/assets/updater.bin') {
        res.writeHead(200, {'content-type': 'application/octet-stream'});
        res.end(Buffer.from(served));
    } else if (path === '/assets/dumper.bin') {
        res.writeHead(200, {'content-type': 'application/octet-stream'});
        res.end(await readFile(join(ROOT, 'assets', 'dumper.bin')));
    } else {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

Object.defineProperty(globalThis, 'document', {value: {baseURI: `http://127.0.0.1:${port}/`}, configurable: true});
const assets = await import(`${ROOT}/js/radio/assets.js?served`);
const fromFile = await assets.updaterImage();
const dumper = await assets.dumperImage();
const fileOk = fromFile.length === served.length && fromFile[served.length - 1] === 0xEF;
console.log('served:', fileOk ? 'reads assets/updater.bin (the served bytes)' : 'DID NOT read the file',
    '| dumper', dumper.length, 'bytes |', assets.sources);

Object.defineProperty(globalThis, 'document', {value: {baseURI: 'file:///C:/opendmr-cps.html'}, configurable: true});
const saved = globalThis.fetch;
globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
};
const assets2 = await import(`${ROOT}/js/radio/assets.js?disk`);
const embedded = await assets2.updaterImage();
globalThis.fetch = saved;
const embeddedOk = embedded.length === real.length && embedded.every((v, i) => v === real[i]);
console.log('file://:', embeddedOk ? 'uses the embedded copy' : 'FAILED', '|', assets2.sources);

server.close();
const ok = fileOk && embeddedOk && dumper.length === 4676;
console.log(ok ? 'ASSETS OK' : 'ASSETS FAILED');
process.exit(ok ? 0 : 1);
