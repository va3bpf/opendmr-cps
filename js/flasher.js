// The flasher page: firmware update over the programming cable, and the three backups of the radio (the codeplug, the
// program flash, the whole data flash). The update is tools/debug/fw_update.py in the browser; the backups are
// tools/backup/dm32_dump.py, through the chip bootloader (radio off, then switched on).
//
// Everything it does is written to the page's log (a card at the bottom), with the time, so a session can be read
// back or saved and sent.

import {t} from './i18n.js';
import {icon} from './icons.js';
import {RawPort} from './radio/serial.js';
import {Updater, prepareImage} from './radio/updater.js';
import {Bootloader, CHIP_DATA, CHIP_PROGRAM} from './radio/bootloader.js';
import * as L from './codeplug/layout.js';

const PROGRAM_SIZE = 1 << 20;          // the GD25Q80
const DATA_SIZE = 16 << 20;            // the 25Q128
const FIRMWARE_BASE = 0xC000;          // where opendmr.bin starts in the program flash

// The firmware the package's page carries (make_package.py puts it before the page's own script): {name, b64}. The
// repo's page has none, and the flasher asks for a file as before.
function packageFirmware() {
    try {
        const fw = typeof window !== 'undefined' ? window.__OPENDMR_FIRMWARE : null;
        if (!fw?.b64) {
            return null;
        }
        const bin = atob(fw.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return {name: fw.name || 'opendmr.bin', size: bytes.length, image: prepareImage(bytes)};
    } catch (e) {
        console.warn('the packaged firmware is not usable:', e);
        return null;
    }
}

// The firmware in the page's own folder (a web server, py serve.py, tools/web/make_folder.py): firmware/index.json
// lists it. Nothing to look for either: it is loaded and offered as the one to write.
async function folderFirmware() {
    try {
        const root = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : null;
        if (!root || typeof fetch !== 'function') {
            return null;
        }
        const index = await fetch(new URL('firmware/index.json', root), {cache: 'no-store'});
        if (!index.ok) {
            return null;
        }
        const list = await index.json();
        const first = list?.[0];
        if (!first?.name) {
            return null;
        }
        const reply = await fetch(new URL('firmware/' + encodeURIComponent(first.name), root), {cache: 'no-store'});
        if (!reply.ok) {
            return null;
        }
        const bytes = new Uint8Array(await reply.arrayBuffer());
        return {name: first.name, size: bytes.length, image: prepareImage(bytes)};
    } catch (e) {
        return null;
    }
}

function clock() {
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

// deps: {el, pageHead, toast, status, progress, getLink, getRadio, disconnect, rerender}
export function createFlasher(deps) {
    const {el, pageHead, toast, status, progress, getLink, getRadio, disconnect, rerender} = deps;
    const state = {
        busy: false,
        firmware: null,      // {name, size, image}
        fromPackage: false,  // the firmware comes inside the page (the package's): no file to look for
        firmwareTried: false,
        log: [],             // {time, text, kind}: what the page has done, shown in the log card
        logBox: null,        // the element it is drawn in, while the page is there
        liveText: '',        // what it is doing now, in the panel at the top
        livePercent: 0,
        liveBox: null,       // {text, bar}: the panel's elements, while the page is there
    };

    const included = packageFirmware();
    if (included) {
        state.firmware = included;
        state.fromPackage = true;
    }

    /* ---- the log ---- */

    function logLine(text, kind = '') {
        const entry = {time: clock(), text, kind};
        state.log.push(entry);
        if (state.log.length > 2000) {
            state.log.splice(0, state.log.length - 2000);
        }
        if (state.logBox) {
            state.logBox.append(logRow(entry));
            while (state.logBox.childElementCount > state.log.length) {
                state.logBox.firstElementChild.remove();
            }
            state.logBox.scrollTop = state.logBox.scrollHeight;
        }
    }

    function logRow(entry) {
        return el('div', {class: 'fl-log-line' + (entry.kind ? ' ' + entry.kind : '')},
            el('span', {class: 'fl-log-time'}, entry.time), ' ', entry.text);
    }

    function logText() {
        return state.log.map((e) => `${e.time}  ${e.text}`).join('\n') + '\n';
    }

    function logSave() {
        if (!state.log.length) {
            return;
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        download(`opendmr-log-${stamp}.txt`, new TextEncoder().encode(
            `OpenDMR CPS — flasher log\n${new Date().toString()}\n\n${logText()}`));
    }

    async function logCopy() {
        try {
            await navigator.clipboard.writeText(logText());
            toast(t('flLogCopied'), 3000);
        } catch (e) {
            logSave(); // no clipboard (a file:// page in some browsers): the file
        }
    }

    /* ---- files ---- */

    function download(name, data) {
        const blob = new Blob([data], {type: 'application/octet-stream'});
        const url = (typeof URL.createObjectURL === 'function') ? URL.createObjectURL(blob) : dataUrl(data);
        const a = el('a', {href: url, download: name});
        document.body.append(a);
        a.click();
        setTimeout(() => {
            if (typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(url);
            }
            a.remove();
        }, 1000);
    }

    // A browser without createObjectURL (an old one, or a test): the bytes as a data URL
    function dataUrl(data) {
        let text = '';
        for (let i = 0; i < data.length; i += 0x8000) {
            text += String.fromCharCode(...data.subarray(i, i + 0x8000));
        }
        return 'data:application/octet-stream;base64,' + btoa(text);
    }

    // what the radio's own screen took: its lines come back 'T'; none back means the radio did not draw them
    function screenNote(screen) {
        if (!screen) {
            return;
        }
        if (!screen.enabled) {
            logLine(t('flScreenNoCanvas'));
        } else if (screen.failed) {
            logLine(`${t('flScreenNoAck')}: ${screen.failed}`, 'bad');
        } else {
            logLine(`${t('flScreenOk')}: ${screen.sent}`);
        }
    }

    function radioName() {
        const info = getRadio();
        return (info?.git || 'opendmr').replace(/[^\w.-]+/g, '_');
    }

    function radioInfoText() {
        const info = getRadio();
        if (!info) {
            return null;
        }
        return `Radio: ${info.git || '?'} · build ${info.build || '?'}`;
    }

    // What the page is doing, in the panel at the top (and the status bar below)
    function say(text, done = 0, total = 0) {
        state.liveText = text;
        state.livePercent = total ? Math.round((100 * done) / total) : 0;
        status(text);
        if (state.liveBox) {
            state.liveBox.text.textContent = text;
            state.liveBox.bar.style.width = state.livePercent + '%';
        }
    }

    function card(title, intro, ...body) {
        return el('div', {class: 'card form-card'},
            el('h3', {class: 'card-title'}, title),
            intro ? el('p', {class: 'muted'}, intro) : null,
            ...body);
    }

    function busyGuard(fn) {
        return async (...args) => {
            if (state.busy) {
                toast(t('flBusy'));
                return;
            }
            state.busy = true;
            progress(0, 0);
            try {
                await fn(...args);
            } catch (e) {
                logLine(t('error') + ': ' + (e?.message || e), 'bad');
                toast(t('error') + ': ' + (e?.message || e), 8000);
                status(t('error'));
            } finally {
                state.busy = false;
                progress(0, 0);
                if (state.liveBox) {
                    state.liveBox.bar.style.width = '0%';
                }
            }
        };
    }

    // The cable port for an update or a bootloader read, without a prompt when the CPS already has it. Called in the
    // click itself: the port chooser needs the user's gesture, which waiting first may have used up
    function portForAction() {
        if (!RawPort.supported()) {
            throw new Error(t(window.isSecureContext ? 'noSerial' : 'serialNeedsLocal'));
        }
        const link = getLink();
        if (link?.connected) {
            const port = link.port;
            return (async () => {
                await link.close().catch(() => {});
                disconnect?.();
                return port;
            })();
        }
        return navigator.serial.requestPort();
    }

    function withPort(action) {
        if (state.busy) {
            toast(t('flBusy'));
            return;
        }
        let port;
        try {
            port = portForAction();
        } catch (e) {
            logLine(t('error') + ': ' + e.message, 'bad');
            toast(t('error') + ': ' + e.message, 8000);
            return;
        }
        action(port);
    }

    /* ---- firmware update ---- */

    async function pickFirmware(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const image = prepareImage(bytes); // throws when not an OpenDMR firmware with the loader
        state.firmware = {name: file.name, size: bytes.length, image};
    }

    const doUpdate = busyGuard(async (portPromise, force) => {
        if (!state.firmware) {
            toast(t('flPickFirmware'));
            logLine(t('flPickFirmware'), 'bad');
            return;
        }
        const firmware = state.firmware;
        logLine(`—— ${t(force ? 'flInstallAll' : 'flUpdate')}: ${firmware.name} · ` +
            `${(firmware.size / 1024).toFixed(0)} KB · ${firmware.image.length / 4096} × 4 KB`);
        const info = radioInfoText();
        if (info) {
            logLine(info);
        }
        const updater = new Updater(await portPromise);
        const started = Date.now();
        try {
            say(t('flUpdating') + ' …');
            logLine(t('flUpdating') + ' …');
            await updater.open();
            logLine(`cable: ${updater.s.baud} baud`);
            let lastStep = -1;
            const written = await updater.writeImage(firmware.image, (done, total) => {
                say(`${t('flUpdating')} ${done} / ${total}`, done, total);
                progress(done, total);
                const step = Math.floor((done * 20) / total); // a line each 5 %
                if (step !== lastStep) {
                    lastStep = step;
                    logLine(`${t('flUpdating')} ${done}/${total} (${Math.round((100 * done) / total)} %)`);
                }
            }, force);
            logLine(`cable: ${updater.s.baud} baud`);
            disconnect?.();
            const seconds = Math.round((Date.now() - started) / 1000);
            say(`${t('flUpdateDone')} (${written} × 4 KB)`, 1, 1);
            logLine(`${t('flUpdateDone')}: ${written} × 4 KB · ${seconds} s`, 'ok');
            screenNote(updater.screen);
            toast(t('flUpdateDone'), 6000);
        } finally {
            await updater.close().catch(() => {});
        }
    });

    /* ---- backups ---- */

    const doCodeplug = busyGuard(async () => {
        const link = getLink();
        if (!link?.connected) {
            throw new Error(t('flConnectFirst'));
        }
        logLine(`—— ${t('flBackupCodeplug')}`);
        const info = radioInfoText();
        if (info) {
            logLine(info);
        }
        const img = new Uint8Array(L.IMAGE_SIZE).fill(0xFF);
        const total = L.REGIONS.reduce((n, r) => n + (r.end - r.start), 0);
        let done = 0;
        let lastStep = -1;
        say(t('reading'));
        for (const r of L.REGIONS) {
            await link.readRegion(img, r.start, r.end, progress, done, total);
            done += r.end - r.start;
            say(`${t('reading')} ${Math.round((100 * done) / total)} %`, done, total);
            const step = Math.floor((done * 10) / total);
            if (step !== lastStep) {
                lastStep = step;
                logLine(`${t('flReading')} ${Math.round((100 * done) / total)} %`);
            }
        }
        const name = `${radioName()}-codeplug.bin`;
        download(name, img);
        say(t('flBackupDone'), 1, 1);
        logLine(`${t('flBackupDone')}: ${name} · ${(img.length / 1024).toFixed(0)} KB`, 'ok');
        toast(t('flBackupDone'), 5000);
    });

    async function bootloaderBackup(portPromise, chip, name) {
        const boot = new Bootloader(await portPromise);
        const started = Date.now();
        try {
            await boot.open();
            say(t('flSwitchOffOn'));
            logLine(t('flSwitchOffOn'));
            let lastStep = -1;
            const result = await boot.dump(chip, (done, total) => {
                say(`${t('flReading')} ${done} / ${total} (${Math.round(100 * done / total)}%)`, done, total);
                progress(done, total);
                const step = Math.floor((done * 20) / total);
                if (step !== lastStep) {
                    lastStep = step;
                    logLine(`${t('flReading')} ${done}/${total} (${Math.round((100 * done) / total)} %)`);
                }
            }, null, () => say(t('flSwitchOffOn')));
            download(name, result.data);
            const seconds = Math.round((Date.now() - started) / 1000);
            say(t('flBackupDone'), 1, 1);
            logLine(`${t('flBackupDone')}: ${name} · ${(result.size / 1024).toFixed(0)} KB · ` +
                `JEDEC ${Array.from(result.id).map((b) => b.toString(16)).join(' ')} · ${seconds} s`, 'ok');
            screenNote(boot.screen);
            toast(t('flBackupDone'), 5000);
        } finally {
            await boot.close().catch(() => {});
        }
    }

    const doProgram = busyGuard(async (portPromise) => {
        logLine(`—— ${t('flBackupProgram')}`);
        await bootloaderBackup(portPromise, CHIP_PROGRAM, `${radioName()}-programa.bin`);
    });

    const doData = busyGuard(async (portPromise) => {
        logLine(`—— ${t('flBackupData')}`);
        await bootloaderBackup(portPromise, CHIP_DATA, `${radioName()}-datos-25q128.bin`);
    });

    const doRestore = busyGuard(async (portPromise, file, chip, expect) => {
        logLine(`—— ${expect === 'image' ? t('flInstallStock') : chip === CHIP_DATA
            ? t('flFactoryData') : t('flFactoryProgram')}: ${file.name}`);
        const boot = new Bootloader(await portPromise);
        const started = Date.now();
        try {
            await boot.open();
            say(t('flSwitchOffOn'));
            logLine(t('flSwitchOffOn'));
            await boot.prepare(() => status(t('flSwitchOffOn')));
            const data = new Uint8Array(await file.arrayBuffer());
            if (!data.length || (data.length % 4096)) {
                throw new Error(t('flBadBackup'));
            }
            if (chip === CHIP_PROGRAM && expect === 'image' && data.length === PROGRAM_SIZE) {
                throw new Error(t('flWrongFileImage'));
            }
            if (chip === CHIP_PROGRAM && expect === 'backup' && data.length !== PROGRAM_SIZE) {
                throw new Error(t('flWrongFileFactory'));
            }
            const offset = (chip === CHIP_PROGRAM && data.length !== PROGRAM_SIZE) ? FIRMWARE_BASE : 0;
            logLine(`${file.name} · ${(data.length / 1024).toFixed(0)} KB · ` +
                `${chip === CHIP_PROGRAM ? t('flBackupProgram') : t('flBackupData')} · ` +
                `0x${offset.toString(16)}`);
            let lastStep = -1;
            const written = await boot.restore(chip, data, {
                offset,
                onBlock: (done, total) => {
                    say(`${t('flWriting')} ${done} / ${total}`, done, total);
                    progress(done, total);
                    const step = Math.floor((done * 20) / total);
                    if (step !== lastStep) {
                        lastStep = step;
                        logLine(`${t('flWriting')} ${done}/${total} (${Math.round((100 * done) / total)} %)`);
                    }
                },
            });
            const seconds = Math.round((Date.now() - started) / 1000);
            say(`${t('flRestoreDone')} (${written})`, 1, 1);
            logLine(`${t('flRestoreDone')}: ${written} · ${seconds} s`, 'ok');
            screenNote(boot.screen);
            toast(t('flRestoreDone'), 6000);
        } finally {
            await boot.close().catch(() => {});
        }
    });

    /* ---- the page ---- */

    function view(main) {
        const fwInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        fwInput.addEventListener('change', async () => {
            const file = fwInput.files[0];
            fwInput.value = '';
            if (!file) {
                return;
            }
            try {
                await pickFirmware(file);
                state.fromPackage = false;
                logLine(`${t('flUseOther')} ${state.firmware.name} · ${(state.firmware.size / 1024).toFixed(0)} KB`);
                toast(`${state.firmware.name}: ${(state.firmware.size / 1024).toFixed(0)} KB`, 4000);
                rerender();
            } catch (e) {
                logLine(t('error') + ': ' + e.message, 'bad');
                toast(t('error') + ': ' + e.message, 8000);
            }
        });
        let progExpect = 'image'; // what the program flash picker is for: the firmware, or the 1 MB backup
        const progInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        progInput.addEventListener('change', () => {
            const file = progInput.files[0];
            progInput.value = '';
            if (file) {
                withPort((port) => doRestore(port, file, CHIP_PROGRAM, progExpect));
            }
        });
        const dataInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        dataInput.addEventListener('change', () => {
            const file = dataInput.files[0];
            dataInput.value = '';
            if (file) {
                withPort((port) => doRestore(port, file, CHIP_DATA, 'backup'));
            }
        });

        // the firmware of the folder (served): offered without picking a file, as the package's page does
        if (!state.firmware && !state.firmwareTried) {
            state.firmwareTried = true;
            folderFirmware().then((found) => {
                if (found) {
                    state.firmware = found;
                    state.fromPackage = true;
                    logLine(`${t('flFirmwareIncluded')}: ${found.name} · ${(found.size / 1024).toFixed(0)} KB`);
                    rerender();
                }
            });
        }

        if (!state.log.length) {
            logLine(t('flLogEmpty'));
        }

        const live = el('div', {class: 'fl-live' + (state.busy ? ' on' : '')},
            el('div', {class: 'fl-live-row'},
                el('span', {class: 'fl-live-tag'}, t('flWorking')),
                el('span', {class: 'fl-live-text'}, state.liveText || t('idle'))),
            el('div', {class: 'fl-live-bar'}, el('i', {style: `width:${state.livePercent}%`})));
        state.liveBox = {text: live.querySelector('.fl-live-text'), bar: live.querySelector('i')};

        main.append(pageHead(t('flasher')), live,
            el('div', {class: 'general-cards'},
                card(t('flBackupCard'), t('flBackupIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: doCodeplug}, icon('download'), t('flBackupCodeplug')),
                        el('button', {onclick: () => withPort(doProgram)}, icon('download'), t('flBackupProgram')),
                        el('button', {onclick: () => withPort(doData)}, icon('download'), t('flBackupData'))),
                    el('p', {class: 'muted id-hint'}, t('flBackupHint')),
                    el('dl', {class: 'info'},
                        el('dt', {}, t('flBackupCodeplug')), el('dd', {}, t('flBackupCodeplugWhat')),
                        el('dt', {}, t('flBackupProgram')), el('dd', {}, t('flBackupProgramWhat')),
                        el('dt', {}, t('flBackupData')), el('dd', {}, t('flBackupDataWhat')))),
                card(t('flUpdateCard'), t('flUpdateIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {class: 'primary', disabled: !state.firmware,
                            onclick: () => withPort((p) => doUpdate(p, false))}, icon('upload'), t('flUpdate')),
                        el('button', {disabled: !state.firmware, onclick: () => withPort((p) => doUpdate(p, true))},
                            icon('upload'), t('flInstallAll')),
                        el('button', {onclick: () => {
                            progExpect = 'image';
                            progInput.click();
                        }}, icon('upload'), t('flInstallStock')),
                        el('button', {class: 'ghost', onclick: () => fwInput.click()}, icon('open'), t('flUseOther'))),
                    el('p', {class: 'muted'}, state.firmware
                        ? (state.fromPackage ? `${t('flFirmwareIncluded')}: ` : '') +
                          `${state.firmware.name} · ${(state.firmware.size / 1024).toFixed(0)} KB`
                        : t('flNoFirmware')),
                    state.fromPackage ? el('p', {class: 'muted id-hint'}, t('flFirmwareIncludedHint')) : null,
                    el('p', {class: 'muted id-hint'}, t('flUpdateHint')),
                    el('p', {class: 'muted id-hint'}, t('flStep2StockHint')),
                    el('p', {class: 'muted id-hint'}, t('flFirmwareInFolder'), ' ',
                        el('a', {href: 'https://github.com/va3bpf/OpenDMR/releases', target: '_blank',
                            rel: 'noopener'}, t('flFirmwareLink')))),
                card(t('flBootCard'), t('flBootIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: () => {
                            progExpect = 'backup';
                            progInput.click();
                        }}, icon('upload'), t('flFactoryProgram')),
                        el('button', {onclick: () => dataInput.click()}, icon('upload'), t('flFactoryData'))),
                    el('p', {class: 'muted id-hint'}, t('flFactoryFile')),
                    el('p', {class: 'muted id-hint'}, t('flFactoryHint'))),
                card(t('flLogCard'), t('flLogIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: logCopy}, icon('copy'), t('flLogCopy')),
                        el('button', {onclick: logSave}, icon('save'), t('flLogSave')),
                        el('button', {class: 'ghost', onclick: () => {
                            state.log = [];
                            state.logBox = null;
                            rerender();
                        }}, icon('trash'), t('flLogClear'))),
                    (state.logBox = el('div', {class: 'fl-log', role: 'log', 'aria-live': 'polite'},
                        state.log.map(logRow)))),
                card(t('flNotesCard'),
                    el('ul', {class: 'fl-notes'},
                        el('li', {}, t('flNote1')),
                        el('li', {}, t('flNote2')),
                        el('li', {}, t('flNote3')),
                        el('li', {}, t('flNote4'))))),
            fwInput, progInput, dataInput);

        // the log, at its end
        state.logBox.scrollTop = state.logBox.scrollHeight;
    }

    return {view};
}
