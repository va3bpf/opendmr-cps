// The two programs the radio runs (update program, flash reader) as files: assets/updater.bin and assets/dumper.bin,
// read when the page is served from a folder (py serve.py, a web server). Opened from disk (file://) the fetch is
// not allowed: the copies embedded by tools/web/embed_bin.py (js/radio/*-bin.js) are used then, the same bytes.
//
// Both are made from their sources in tools/debug/updater/ and tools/backup/dumper/: run tools/web/embed_bin.py after
// rebuilding either, it writes assets/ and the embedded modules together.

import {updater_bin} from './updater-bin.js';
import {dumper_bin} from './dumper-bin.js';

const loaded = new Map();
export const sources = {}; // path -> 'assets' or 'embedded', for the page to say where each came from

function base() {
    if (typeof document !== 'undefined' && document.baseURI) {
        return document.baseURI;
    }
    if (typeof location !== 'undefined' && location.href) {
        return location.href;
    }
    return null;
}

async function fromFile(path, embedded) {
    if (!loaded.has(path)) {
        loaded.set(path, (async () => {
            const root = base();
            if (root && typeof fetch === 'function') {
                try {
                    const reply = await fetch(new URL(path, root), {cache: 'no-store'});
                    if (reply.ok) {
                        const data = new Uint8Array(await reply.arrayBuffer());
                        if (data.length) {
                            sources[path] = 'assets';
                            return data;
                        }
                    }
                } catch (e) {
                    // file://, or the file is not there: the embedded one
                }
            }
            sources[path] = 'embedded';
            return embedded();
        })());
    }
    return loaded.get(path);
}

export function updaterImage() {
    return fromFile('assets/updater.bin', updater_bin);
}

export function dumperImage() {
    return fromFile('assets/dumper.bin', dumper_bin);
}
