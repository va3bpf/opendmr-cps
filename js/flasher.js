// The flasher page: updating OpenDMR, installing it on a stock radio, the radio's backups and the way back to the stock
// firmware, one task at a time with its steps. The update is OpenDMR's tools/debug/fw_update.py in the browser; the
// backups and the bootloader writes are its tools/backup/dm32_dump.py (radio off, then switched on). The firmware and
// the two programs the radio runs for these come from the OpenDMR release folder the user chooses (radio/assets.js);
// the port and its speed are the page's (the toolbar), lent to each step.
//
// Everything it does goes to the page's log, with the time, so a session can be read back or saved and sent.

import {t} from './i18n.js';
import {icon} from './icons.js';
import {Updater, prepareImage} from './radio/updater.js';
import {Bootloader, CHIP_DATA, CHIP_PROGRAM} from './radio/bootloader.js';
import {setRelease, currentRelease, ReleaseMissing} from './radio/assets.js';
import {crc32} from './codeplug/oddb.js';

const PROGRAM_SIZE = 1 << 20;          // the GD25Q80
const DATA_SIZE = 16 << 20;            // the 25Q128
const FIRMWARE_BASE = 0xC000;          // where opendmr.bin starts in the program flash
const TASKS = ['update', 'install', 'backup', 'stock'];
const TASK_TEXT = {update: 'flTaskUpdate', install: 'flTaskInstall', backup: 'flTaskBackup', stock: 'flTaskStock'};

function clock() {
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

function stamp() {
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// deps: {el, pageHead, toast, status, progress, getLink, getRadio, giveBack, rerender}; giveBack(): the port back to
// the page's link after a step (and what answers on it read again)
export function createFlasher(deps) {
    const {el, pageHead, toast, status, progress, getLink, getRadio, giveBack, rerender} = deps;
    const state = {
        busy: false,
        task: null,          // the task chosen; null: from the radio (OpenDMR answering: update, else install)
        firmware: null,      // {name, size, image}: the release's opendmr.bin, or another file chosen
        fromRelease: false,
        saved: {[CHIP_PROGRAM]: null, [CHIP_DATA]: null}, // backup file names made this session
        stock: {[CHIP_PROGRAM]: null, [CHIP_DATA]: null},                 // back to stock: {name, data}
        finished: {update: false, install: false, stock: false}, // the task's last step went through (green, and
                                                                 // still there to do again)
        log: [],             // {time, text, kind}
        logBox: null,
        logOpen: false,
        liveText: '',
        livePercent: 0,
        liveBox: null,
    };

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
        download(`opendmr-log-${stamp()}.txt`, new TextEncoder().encode(
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

    // what went over the cable last, into the log (a failed step)
    function traceToLog(raw) {
        for (const line of raw?.trace || []) {
            logLine('  ' + line);
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

    function busyGuard(fn) {
        return async (...args) => {
            if (state.busy) {
                toast(t('flBusy'));
                return;
            }
            state.busy = true;
            progress(0, 0);
            rerender();
            try {
                await fn(...args);
            } catch (e) {
                logLine(t('error') + ': ' + (e?.message || e), 'bad');
                toast(t('error') + ': ' + (e?.message || e), 8000);
                say(t('error') + ': ' + (e?.message || e));
            } finally {
                state.busy = false;
                progress(0, 0);
            }
        };
    }

    // The page's connected port (the toolbar's "Connect": one port for the whole page), lent to a step: the link's
    // reader stopped, the port given back when the step ends (and the page drawn again with what answers then)
    function withPort(action, task = null) {
        if (state.busy) {
            toast(t('flBusy'));
            return;
        }
        const link = getLink();
        if (!link?.connected) {
            logLine(t('flConnectFirst'), 'bad');
            toast(t('flConnectFirst'), 6000);
            return;
        }
        if (task) {
            state.finished[task] = false; // the last result goes as it is done again
        }
        const port = (async () => {
            await link.suspend();
            return link.port;
        })();
        Promise.resolve(action(port)).finally(async () => {
            await giveBack();
            rerender();
        });
    }

    /* ---- firmware update ---- */

    async function pickFirmware(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const image = prepareImage(bytes); // throws when not an OpenDMR firmware with the loader
        state.firmware = {name: file.name, size: bytes.length, image};
    }

    const doUpdate = busyGuard(async (portPromise, force) => {
        const firmware = state.firmware;
        logLine(`—— ${t(force ? 'flInstallAll' : 'flUpdate')}: ${firmware.name} · ${kb(firmware.size)}`);
        const updater = new Updater(await portPromise);
        const started = Date.now();
        try {
            say(t('flUpdating') + ' …');
            await updater.open();
            let lastStep = -1;
            const written = await updater.writeImage(firmware.image, (done, total) => {
                say(`${t('flUpdating')} ${done} / ${total} · ${updater.s.baud} baud`, done, total);
                progress(done, total);
                const step = Math.floor((done * 20) / total); // a line each 5 %
                if (step !== lastStep) {
                    lastStep = step;
                    logLine(`${t('flUpdating')} ${done}/${total} (${Math.round((100 * done) / total)} %)`);
                }
            }, force);
            const seconds = Math.round((Date.now() - started) / 1000);
            say(`${t('flUpdateDone')} (${written} × 4 KB)`, 1, 1);
            logLine(`${t('flUpdateDone')}: ${written} × 4 KB · ${updater.s.baud} baud · ${seconds} s`, 'ok');
            state.finished.update = `${t('flUpdateDone')} ${clock()} · ${written} × 4 KB`;
            screenNote(updater.screen);
            toast(t('flUpdateDone'), 6000);
        } catch (e) {
            traceToLog(updater.s);
            throw e;
        } finally {
            await updater.close().catch(() => {});
        }
    });

    /* ---- backups ---- */

    const doBackup = busyGuard(async (portPromise, chip) => {
        const name = `dm32-${chip === CHIP_DATA ? 'data' : 'program'}-${stamp()}.bin`;
        logLine(`—— ${t(chip === CHIP_DATA ? 'flBackupData' : 'flBackupProgram')}`);
        const boot = new Bootloader(await portPromise);
        const started = Date.now();
        try {
            await boot.open();
            say(t('flSwitchOffOn'));
            logLine(t('flSwitchOffOn'));
            let lastStep = -1;
            const result = await boot.dump(chip, (done, total) => {
                say(`${t('flReading')} ${done} / ${total} · ${boot.s.baud} baud`, done, total);
                progress(done, total);
                const step = Math.floor((done * 20) / total);
                if (step !== lastStep) {
                    lastStep = step;
                    logLine(`${t('flReading')} ${done}/${total} (${Math.round((100 * done) / total)} %)`);
                }
            }, null, () => say(t('flSwitchOffOn')));
            download(name, result.data);
            state.saved[chip] = name;
            const seconds = Math.round((Date.now() - started) / 1000);
            say(t('flBackupDone'), 1, 1);
            logLine(`${t('flBackupDone')}: ${name} · ${kb(result.size)} · ` +
                `JEDEC ${Array.from(result.id).map((b) => b.toString(16)).join(' ')} · ${boot.s.baud} baud · ${seconds} s`, 'ok');
            screenNote(boot.screen);
            toast(t('flBackupDone'), 5000);
        } catch (e) {
            traceToLog(boot.s);
            throw e;
        } finally {
            await boot.close().catch(() => {});
        }
    });

    /* ---- writes through the bootloader ---- */

    // Before a data flash backup goes back: its factory calibration sector must be the one this radio has (the same
    // place, the same bytes). A backup of another radio would write that radio's calibration into this one.
    async function checkSameRadio(boot, data) {
        const at = Bootloader.calibrationSector(data);
        if (at < 0) {
            throw new Error(t('flNoCalInBackup'));
        }
        const [radio] = await boot.sectorCrcs(CHIP_DATA, at, 1);
        if (radio !== crc32(data.subarray(at, at + 4096))) {
            throw new Error(t('flNotThisRadio').replace('{at}', '0x' + at.toString(16)));
        }
        logLine(`${t('flSameRadio')} (0x${at.toString(16)})`);
    }

    // jobs: [{chip, image, name, data}], all in one bootloader session (one power cycle): the firmware ('image': the
    // program flash from 0xC000), a 1 MB program flash backup, a 16 MB data flash backup
    function checkJob(job) {
        const n = job.data.length;
        if (job.image) {
            if (n === PROGRAM_SIZE) {
                throw new Error(t('flWrongFileImage'));
            }
        } else if (job.chip === CHIP_PROGRAM && n !== PROGRAM_SIZE) {
            throw new Error(`${job.name}: ${t('flWrongFileFactory')}`);
        } else if (job.chip === CHIP_DATA && n !== DATA_SIZE) {
            throw new Error(`${job.name}: ${t('flWrongFileData')}`);
        }
    }

    const doWrite = busyGuard(async (portPromise, title, jobs, task) => {
        logLine(`—— ${title}: ${jobs.map((j) => j.name).join(', ')}`);
        jobs.forEach(checkJob);
        const boot = new Bootloader(await portPromise);
        const started = Date.now();
        try {
            await boot.open();
            say(t('flSwitchOffOn'));
            logLine(t('flSwitchOffOn'));
            await boot.prepare(() => say(t('flSwitchOffOn')));
            for (const job of jobs) {
                if (job.chip === CHIP_DATA) {
                    await checkSameRadio(boot, job.data);
                }
            }
            for (const job of jobs) {
                const offset = job.image ? FIRMWARE_BASE : 0;
                logLine(`${job.name} · ${kb(job.data.length)} · 0x${offset.toString(16)}`);
                let lastStep = -1;
                const written = await boot.restore(job.chip, job.data, {
                    offset,
                    onBlock: (done, total) => {
                        say(`${job.name}: ${t('flWriting')} ${done} / ${total} · ${boot.s.baud} baud`, done, total);
                        progress(done, total);
                        const step = Math.floor((done * 20) / total);
                        if (step !== lastStep) {
                            lastStep = step;
                            logLine(`${t('flWriting')} ${done}/${total} (${Math.round((100 * done) / total)} %)`);
                        }
                    },
                });
                logLine(`${job.name}: ${t('flWrittenSectors').replace('{n}', written)}`, 'ok');
            }
            const seconds = Math.round((Date.now() - started) / 1000);
            say(t('flWriteDone'), 1, 1);
            logLine(`${t('flWriteDone')} · ${boot.s.baud} baud · ${seconds} s`, 'ok');
            state.finished[task] = `${t('flWriteDone')} ${clock()}`;
            screenNote(boot.screen);
            toast(t('flWriteDone'), 6000);
        } catch (e) {
            traceToLog(boot.s);
            throw e;
        } finally {
            await boot.close().catch(() => {});
        }
    });

    /* ---- the release folder ---- */

    async function pickRelease(files) {
        try {
            const release = await setRelease(files);
            state.firmware = {name: 'opendmr.bin', size: release.files.firmware.length,
                image: prepareImage(release.files.firmware)};
            state.fromRelease = true;
            state.finished = {update: false, install: false, stock: false};
            logLine(`${t('flRelease')}: ${release.name} · opendmr.bin ${kb(state.firmware.size)}`, 'ok');
        } catch (e) {
            const text = (e instanceof ReleaseMissing) ? `${t('flReleaseMissing')}: ${e.message}` : e.message;
            logLine(t('error') + ': ' + text, 'bad');
            toast(t('error') + ': ' + text, 8000);
        }
        rerender();
    }

    /* ---- the page ---- */

    function view(main) {
        const filePicker = (accept, onFile, directory = false) => {
            const input = el('input', directory ? {type: 'file', webkitdirectory: true, hidden: true}
                : {type: 'file', accept, hidden: true});
            input.addEventListener('change', async () => {
                const files = input.files;
                if (files?.length) {
                    await onFile(directory ? files : files[0]);
                }
                input.value = '';
            });
            main.append(input);
            return () => input.click();
        };
        const chooseFolder = filePicker('', pickRelease, true);
        const chooseFirmware = filePicker('.bin,application/octet-stream', async (file) => {
            try {
                await pickFirmware(file);
                state.fromRelease = false;
                logLine(`${t('flUseOther')}: ${state.firmware.name} · ${kb(state.firmware.size)}`);
            } catch (e) {
                logLine(t('error') + ': ' + e.message, 'bad');
                toast(t('error') + ': ' + e.message, 8000);
            }
            rerender();
        });
        const stockPicker = (chip) => filePicker('.bin,application/octet-stream', async (file) => {
            state.stock[chip] = {name: file.name, data: new Uint8Array(await file.arrayBuffer())};
            rerender();
        });
        const chooseStockProgram = stockPicker(CHIP_PROGRAM);
        const chooseStockData = stockPicker(CHIP_DATA);

        const release = currentRelease();
        const link = getLink();
        const radio = getRadio();
        const task = state.task ?? (radio ? 'update' : 'install');
        const busy = state.busy;

        // a step: its mark (done, now, later), what it is, a line under it, its button
        const stepList = (steps) => {
            let current = false;
            return el('ol', {class: 'fl-steps'}, steps.map((s) => {
                const mark = s.done ? 'done' : (!current && !s.optional) ? (current = true, 'now') : 'later';
                return el('li', {class: 'fl-step ' + mark},
                    el('span', {class: 'fl-mark'}, s.done ? '✓' : ''),
                    el('div', {class: 'fl-step-text'},
                        el('div', {class: 'fl-step-title'}, s.title),
                        s.sub ? el('div', {class: 'muted fl-step-sub'}, s.sub) : null),
                    s.action ?? null);
            }));
        };
        const button = (text, iconName, onclick, opts = {}) => el('button',
            {class: opts.primary ? 'primary' : (opts.ghost ? 'ghost' : ''), disabled: busy || !!opts.disabled, onclick},
            iconName ? icon(iconName) : null, text);

        const backupStep = (chip, optional = false) => ({
            title: t(chip === CHIP_DATA ? 'flBackupData' : 'flBackupProgram'),
            sub: state.saved[chip] ? `${t('flSaved')}: ${state.saved[chip]}`
                : t(chip === CHIP_DATA ? 'flBackupDataSub' : 'flBackupProgramSub'),
            done: !!state.saved[chip], optional,
            action: button(t('flBackUp'), 'download', () => withPort((p) => doBackup(p, chip)),
                {disabled: !release}),
        });

        let panel;
        if (task === 'update') {
            panel = [stepList([{
                title: t('flUpdate'), done: !!state.finished.update,
                sub: state.finished.update || (radio ? `${t('flRadioNow')}: OpenDMR ${radio.git || ''} · ${t('flUpdateSub')}`
                    : t('flNeedsOpenDmr')),
                action: button(t('flUpdate'), 'upload', () => withPort((p) => doUpdate(p, false), 'update'),
                    {primary: true, disabled: !release || !state.firmware || !radio}),
            }])];
        } else if (task === 'install') {
            panel = [stepList([backupStep(CHIP_PROGRAM, true), backupStep(CHIP_DATA, true), {
                title: t('flInstallStock'), done: !!state.finished.install, sub: state.finished.install || t('flInstallSub'),
                action: button(t('flInstall'), 'upload', () => withPort((p) => doWrite(p, t('flInstallStock'),
                    [{chip: CHIP_PROGRAM, image: true, name: state.firmware.name, data: state.firmware.image}],
                    'install'), 'install'),
                {primary: true, disabled: !release || !state.firmware}),
            }])];
        } else if (task === 'backup') {
            panel = [stepList([backupStep(CHIP_PROGRAM, true), backupStep(CHIP_DATA, true)])];
        } else {
            const prog = state.stock[CHIP_PROGRAM];
            const data = state.stock[CHIP_DATA];
            const jobs = [prog && {chip: CHIP_PROGRAM, ...prog}, data && {chip: CHIP_DATA, ...data}].filter(Boolean);
            panel = [stepList([{
                title: t('flStockProgram'), done: !!prog,
                sub: prog ? `${prog.name} · ${kb(prog.data.length)}` : t('flStockProgramSub'),
                action: button(t('flChoose'), 'open', chooseStockProgram),
            }, {
                title: t('flStockData'), done: !!data, optional: true,
                sub: data ? `${data.name} · ${kb(data.data.length)}` : t('flStockDataSub'),
                action: button(t('flChoose'), 'open', chooseStockData),
            }, {
                title: t('flWriteBack'), done: !!state.finished.stock, sub: state.finished.stock || t('flWriteBackSub'),
                action: button(t('flWriteBack'), 'upload', () => withPort((p) => doWrite(p, t('flTaskStock'), jobs,
                    'stock'), 'stock'),
                    {primary: true, disabled: !release || !prog}),
            }])];
        }

        // what it is doing now (or did last), under the steps: only once there is something to say
        const live = (busy || state.liveText) ? el('div', {class: 'fl-live' + (busy ? ' on' : '')},
            el('div', {class: 'fl-live-text'}, state.liveText || t('idle')),
            el('div', {class: 'fl-live-bar'}, el('i', {style: `width:${busy ? state.livePercent : 0}%`}))) : null;
        state.liveBox = live ? {text: live.querySelector('.fl-live-text'), bar: live.querySelector('i')} : null;

        const advanced = el('details', {class: 'fl-fold'},
            el('summary', {}, t('flAdvanced')),
            el('div', {class: 'id-sources'},
                button(t('flInstallAll'), 'upload', () => withPort((p) => doUpdate(p, true), 'update'),
                    {disabled: !state.firmware || !radio}),
                button(t('flUseOther'), 'open', chooseFirmware, {ghost: true})),
            el('p', {class: 'muted'}, state.firmware
                ? `${t('flFirmware')}: ${state.firmware.name} · ${kb(state.firmware.size)}` +
                  (state.fromRelease ? '' : ` (${t('flNotFromRelease')})`) : t('flNoFirmware')));

        const logFold = el('details', {class: 'fl-fold'},
            el('summary', {}, `${t('flLogCard')} (${state.log.length})`),
            el('div', {class: 'id-sources'},
                button(t('flLogCopy'), 'copy', logCopy, {ghost: true}),
                button(t('flLogSave'), 'save', logSave, {ghost: true}),
                button(t('flLogClear'), 'trash', () => {
                    state.log = [];
                    rerender();
                }, {ghost: true})),
            (state.logBox = el('div', {class: 'fl-log', role: 'log', 'aria-live': 'polite'}, state.log.map(logRow))));
        logFold.open = state.logOpen;
        logFold.addEventListener('toggle', () => {
            state.logOpen = logFold.open;
            state.logBox.scrollTop = state.logBox.scrollHeight;
        });

        // what every task works with: the radio on the page's port, and the OpenDMR release folder
        const status = el('div', {class: 'fl-status'},
            el('div', {class: 'fl-status-row'},
                el('span', {class: 'fl-status-label'}, t('flRadioNow')),
                el('span', {class: 'fl-status-value' + (radio ? '' : ' muted')}, !link?.connected
                    ? t('flRadioNotConnected') : radio ? `OpenDMR ${radio.git || ''}` : t('flRadioNoAnswer'))),
            el('div', {class: 'fl-status-row'},
                el('span', {class: 'fl-status-label'}, t('flStepFolder')),
                el('span', {class: 'fl-status-value' + (release ? '' : ' muted')}, release
                    ? `${release.name} · opendmr.bin ${kb(release.files.firmware.length)}` : t('flStepFolderSub')),
                button(release ? t('flChange') : t('flPickRelease'), 'open', chooseFolder, {primary: !release})));

        main.append(pageHead(t('flasher')),
            el('div', {class: 'card form-card fl-card'},
                status,
                el('div', {class: 'fl-tasks', role: 'tablist'}, TASKS.map((k) => el('button',
                    {class: 'fl-task' + (k === task ? ' active' : ''), role: 'tab', disabled: busy && k !== task,
                        onclick: () => {
                            state.task = k;
                            rerender();
                        }}, t(TASK_TEXT[k])))),
                el('p', {class: 'muted fl-task-intro'}, t(TASK_TEXT[task] + 'Intro')),
                ...panel,
                live),
            advanced, logFold);
        state.logBox.scrollTop = state.logBox.scrollHeight;
    }

    return {view};
}
