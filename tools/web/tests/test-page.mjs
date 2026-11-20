// The page's JS as a module with a jsdom document: the flasher tab renders, the four cards are there, no i18n key
// leaks in any of the three languages. jsdom does not run <script type="module">, so the bundle from
// opendmr-cps-debug.html is imported as a module here.
//
//   py build.py && node tools/web/tests/test-page.mjs      (needs jsdom: npm i jsdom)
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

let JSDOM;
try {
    ({JSDOM} = await import('jsdom'));
} catch (e) {
    console.log('test skipped: jsdom is not installed (npm i jsdom)');
    process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const page = readFileSync(join(ROOT, 'opendmr-cps-debug.html'), 'utf8');
const script = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const bundle = join(mkdtempSync(join(tmpdir(), 'cps-test-')), 'bundle.mjs');
writeFileSync(bundle, script);

const shell = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(shell, {url: process.env.WEB || 'http://localhost/'});
const {window} = dom;

const define = (name, value) => Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('localStorage', window.localStorage);
define('location', window.location);
define('isSecureContext', true);
define('confirm', () => true);
define('Node', window.Node);
define('Element', window.Element);
define('Event', window.Event);
define('getComputedStyle', window.getComputedStyle.bind(window));
window.isSecureContext = true;

// PKG=1: the package's page, with the firmware inside (make_package.py), so the flasher has nothing to look for
if (process.env.PKG) {
    const packed = readFileSync(join(ROOT, 'dist', 'paquete', 'OpenDMR-CPS', 'opendmr-cps.html'), 'utf8');
    const found = packed.match(/window\.__OPENDMR_FIRMWARE = (\{[\s\S]*?\});<\/script>/);
    if (!found) {
        console.log('the package page has no embedded firmware');
        process.exit(1);
    }
    window.__OPENDMR_FIRMWARE = JSON.parse(found[1]);
    console.log('paquete:', window.__OPENDMR_FIRMWARE.name, window.__OPENDMR_FIRMWARE.b64.length, 'b64');
}
window.navigator.serial = {
    requestPort: async () => {
        throw new Error('no port in the test');
    },
};

await import(bundle);
await new Promise((resolve) => setTimeout(resolve, 100));

const errors = [];
window.document.querySelector('.tab[data-tab="flasher"]').click();
await new Promise((resolve) => setTimeout(resolve, 100));

const main = window.document.getElementById('content');
let text = main.textContent;
const cards = [...main.querySelectorAll('.card-title')].map((h) => h.textContent.trim());
const buttons = [...main.querySelectorAll('button')].map((b) => b.textContent.trim());
console.log('cards:', JSON.stringify(cards));
console.log('buttons:', JSON.stringify(buttons));
if (cards.length !== 5) {
    errors.push('expected 5 cards, got ' + cards.length);
}
if (buttons.some((b) => b.includes('updater.bin')) || buttons.some((b) => b.includes('dumper.bin'))) {
    errors.push('the programs card should be gone');
}
if (!main.querySelector('.fl-log')) {
    errors.push('the log is missing');
}
if (!main.querySelector('a[href*="OpenDMR/releases"]')) {
    errors.push('the releases link is missing');
}

if (process.env.PKG) {
    // the package's page has the firmware inside: Update is enabled with nothing to pick
    if (!text.includes('opendmr-0.6.1.bin')) {
        errors.push('the package firmware name is not shown');
    }
    const update = [...main.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Update');
    if (!update || update.disabled) {
        errors.push('the package firmware is not offered (Update disabled)');
    } else {
        // and the log records the attempt and its failure (there is no cable in the test)
        update.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const log = main.querySelector('.fl-log')?.textContent || '';
        console.log('log:', log.split('\n').filter(Boolean).slice(-3).join(' | '));
        if (!/\d\d:\d\d:\d\d/.test(log)) {
            errors.push('the log has no timestamps');
        }
        if (!/Error|no port|no hay/i.test(log)) {
            errors.push('the log did not record the failed update');
        }
    }
}

// APRS: the symbol picker in the drawer, 94 symbols (0x21..0x7E)
window.document.querySelector('.tab[data-tab="aprs"]').click();
await new Promise((resolve) => setTimeout(resolve, 80));
const addButton = [...window.document.querySelectorAll('#content .page-head button')]
    .find((b) => /Add|Añadir|添加/.test(b.textContent));
if (!addButton) {
    errors.push('APRS: the add button is missing');
} else {
    addButton.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const symbols = [...window.document.querySelectorAll('#content select')]
        .find((sel) => sel.options.length === 94);
    console.log('símbolos APRS:', symbols ? `${symbols.options.length} (ej. "${symbols.options[0].textContent}")` : 'no hay');
    if (!symbols) {
        errors.push('APRS: the symbol dropdown is missing');
    } else if (!symbols.options[0].textContent.startsWith('!')) {
        errors.push('APRS: the symbol list is not 0x21..0x7E');
    }
}

for (const lang of ['es', 'zh', 'en']) {
    for (let i = 0; i < 4 && window.localStorage.getItem('lang') !== lang; i++) {
        window.document.getElementById('btnLang').click();
    }
    window.document.querySelector('.tab[data-tab="flasher"]').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    text = window.document.getElementById('content').textContent;
    const leaked = text.match(/fl[A-Z]\w+/g) || [];
    console.log(lang, '→', leaked.length ? 'untranslated: ' + leaked.join(', ') : 'texts OK');
    if (leaked.length) {
        errors.push(`${lang}: ${leaked.join(', ')}`);
    }
}

console.log(errors.length ? 'PAGE: ' + errors.join(' | ') : 'PAGE OK');
process.exit(errors.length ? 1 : 0);
