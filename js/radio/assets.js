// The OpenDMR release the flasher writes from: the folder of the unzipped OpenDMR-<version>.zip, chosen by the user
// (as the Languages page does). Its firmware and the two programs the radio runs for it come from the same release,
// so they always go together (the firmware area, the protocol): opendmr.bin, tools/debug/updater/updater.bin (the
// update program) and tools/backup/dumper/dumper.bin (the flash reader of the chip bootloader). OpenDMR's
// make_release.py builds both programs from their source at every release.

const FILES = {
    firmware: 'opendmr.bin',
    updater: 'tools/debug/updater/updater.bin',
    dumper: 'tools/backup/dumper/dumper.bin',
    version: 'VERSION.txt',
};

let release = null; // {name, version, files: {firmware, updater, dumper}: Uint8Array}

export class ReleaseMissing extends Error {}

// The files of the chosen folder (an <input webkitdirectory> FileList, or [{path, data}] in tests): the release, or an
// Error naming what is missing
export async function setRelease(fileList) {
    const found = {};
    let top = '';
    for (const file of Array.from(fileList)) {
        const path = (file.webkitRelativePath || file.path || file.name).replaceAll('\\', '/');
        for (const [key, want] of Object.entries(FILES)) {
            // the folder may be the release's own or the one above it: its path ends with the file's
            if ((path === want || path.endsWith('/' + want)) && !found[key]) {
                found[key] = file;
                if (key === 'firmware') {
                    top = path.slice(0, path.length - want.length).replace(/\/$/, '');
                }
            }
        }
    }
    const missing = ['firmware', 'updater', 'dumper'].filter((k) => !found[k]).map((k) => FILES[k]);
    if (missing.length) {
        throw new ReleaseMissing(missing.join(', '));
    }
    const bytes = async (file) => (file.data ? new Uint8Array(file.data) : new Uint8Array(await file.arrayBuffer()));
    const files = {firmware: await bytes(found.firmware), updater: await bytes(found.updater),
        dumper: await bytes(found.dumper)};
    let version = '';
    if (found.version) {
        const text = new TextDecoder().decode(await bytes(found.version));
        version = (text.match(/^OpenDMR\s+(\S+)/m) || [])[1] || '';
    }
    release = {name: top.split('/').pop() || 'OpenDMR', version, files};
    return release;
}

export function currentRelease() {
    return release;
}

function need(key) {
    if (!release) {
        throw new ReleaseMissing(FILES[key]);
    }
    return release.files[key];
}

export async function updaterImage() {
    return need('updater');
}

export async function dumperImage() {
    return need('dumper');
}
