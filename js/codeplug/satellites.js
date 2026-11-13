// Amateur satellites: the custom data block type 3 of the codeplug (OpenDMR src/services/satellite.c loadKeps(),
// tools/satellite/write_keps.py), 25 records of 100 bytes:
//   name (8, ASCII), TLE line 1 epoch year, day and decay (24 characters in 12 bytes), TLE line 2 elements
//   (56 characters in 28 bytes), voice Rx / Tx (Hz, u32), CTCSS / arm CTCSS (Hz x 10, u16), APRS Rx / Tx, other Rx / Tx
//   (u32), 24 bytes more (kept as they are).
// TLE characters are 2 a byte, the first in the high nibble, from TLE_CHARS.

export const BLOCK_TYPE = 3;
export const BLOCK_LENGTH = 2520;
export const SATELLITES_MAX = 25;
const RECORD = 100;
const TLE_CHARS = '0123456789. +-*';

function compress(text, bytes) {
    const s = text.padEnd(bytes * 2).slice(0, bytes * 2);
    const out = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) {
        const hi = TLE_CHARS.indexOf(s[2 * i]);
        const lo = TLE_CHARS.indexOf(s[(2 * i) + 1]);
        out[i] = ((hi < 0 ? 11 : hi) << 4) | (lo < 0 ? 11 : lo); // anything else as a space
    }
    return out;
}

function decompress(bytes) {
    let s = '';
    for (const b of bytes) {
        s += TLE_CHARS[b >> 4] + TLE_CHARS[b & 15];
    }
    return s;
}

const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16 = (b, at) => b[at] | (b[at + 1] << 8);

function put32(b, at, v) {
    for (let i = 0; i < 4; i++) {
        b[at + i] = (v >>> (8 * i)) & 0xFF;
    }
}

function put16(b, at, v) {
    b[at] = v & 0xFF;
    b[at + 1] = (v >> 8) & 0xFF;
}

// The epoch of the stored TLE (year, day of the year) as a date
export function epochDate(sat) {
    const year = parseInt(sat.tle1.slice(0, 2), 10);
    const day = parseFloat(sat.tle1.slice(2, 14));
    if (!Number.isFinite(year) || !Number.isFinite(day)) {
        return null;
    }
    const full = year < 57 ? 2000 + year : 1900 + year;
    return new Date(Date.UTC(full, 0, 1) + ((day - 1) * 86400000));
}

// A record's TLE parts from the two lines of a TLE (as write_keps.py record())
export function fromTleLines(line1, line2) {
    return {
        tle1: line1.slice(18, 20) + line1.slice(20, 32) + line1.slice(33, 43),
        tle2: line2.slice(8, 16) + line2.slice(17, 25) + line2.slice(26, 33) + line2.slice(34, 42) +
            line2.slice(43, 51) + line2.slice(52, 63) + line2.slice(63, 68),
    };
}

// TLE text (2 or 3 lines a satellite) -> [{name, catalog, line1, line2}]
export function parseTleText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
            const name = (i > 0 && !lines[i - 1].startsWith('1 ') && !lines[i - 1].startsWith('2 ')) ? lines[i - 1].trim() : '';
            out.push({name, catalog: lines[i].slice(2, 7).trim(), line1: lines[i], line2: lines[i + 1]});
            i++;
        }
    }
    return out;
}

export function parseBlock(data) {
    const sats = [];
    for (let i = 0; i < SATELLITES_MAX; i++) {
        const r = data.subarray(i * RECORD, (i + 1) * RECORD);
        if (r[0] === 0 || r[0] === 0xFF) {
            continue;
        }
        sats.push({
            name: new TextDecoder().decode(r.subarray(0, 8)).replace(/[\0\s]+$/, ''),
            catalog: '',
            tle1: decompress(r.subarray(8, 20)),
            tle2: decompress(r.subarray(20, 48)),
            voiceRx: u32(r, 48), voiceTx: u32(r, 52),
            ctcss: u16(r, 56), armCtcss: u16(r, 58),
            aprsRx: u32(r, 60), aprsTx: u32(r, 64),
            otherRx: u32(r, 68), otherTx: u32(r, 72),
            extra: r.slice(76, 100),
        });
    }
    return sats;
}

export function buildBlock(sats) {
    const data = new Uint8Array(BLOCK_LENGTH);
    sats.slice(0, SATELLITES_MAX).forEach((s, i) => {
        const r = data.subarray(i * RECORD, (i + 1) * RECORD);
        r.set(new TextEncoder().encode(s.name.padEnd(8).slice(0, 8)), 0);
        r.set(compress(s.tle1, 12), 8);
        r.set(compress(s.tle2, 28), 20);
        put32(r, 48, s.voiceRx);
        put32(r, 52, s.voiceTx);
        put16(r, 56, s.ctcss);
        put16(r, 58, s.armCtcss);
        put32(r, 60, s.aprsRx);
        put32(r, 64, s.aprsTx);
        put32(r, 68, s.otherRx);
        put32(r, 72, s.otherTx);
        r.set(s.extra ?? new Uint8Array(24), 76);
    });
    return data;
}

// FM satellites and the ISS: the frequencies as the radio uses them (Rx: the satellite's downlink, Tx: its uplink), Hz;
// CTCSS in Hz x 10 (arm: SO-50's 74.4 Hz to switch its timer on). Our own list, from AMSAT's FM satellite frequency
// summary (amsat.org, 2026-11) and the operators' pages; satellites come and go: check AMSAT's status page.
const MHZ = (f) => Math.round(f * 1e6);
const TEVEL2 = [['TEVEL2-1', '63217'], ['TEVEL2-2', '63219'], ['TEVEL2-3', '63218'], ['TEVEL2-4', '63213'],
    ['TEVEL2-5', '63214'], ['TEVEL2-6', '63215'], ['TEVEL2-7', '63238'], ['TEVEL2-8', '63239'], ['TEVEL2-9', '63237']];
export const PRESETS = [
    // the cross band FM repeater (voice), APRS, and the crew's voice downlink (other: Region 2 / 3 uplink)
    {name: 'ISS', catalog: '25544', voiceRx: MHZ(437.800), voiceTx: MHZ(145.990), ctcss: 670,
        aprsRx: MHZ(145.825), aprsTx: MHZ(145.825), otherRx: MHZ(145.800), otherTx: MHZ(144.490)},
    {name: 'SO-50', catalog: '27607', voiceRx: MHZ(436.795), voiceTx: MHZ(145.850), ctcss: 670, armCtcss: 744},
    {name: 'AO-91', catalog: '43017', voiceRx: MHZ(145.960), voiceTx: MHZ(435.250)},
    {name: 'AO-123', catalog: '61781', voiceRx: MHZ(435.400), voiceTx: MHZ(145.850), ctcss: 670},
    {name: 'PO-101', catalog: '43678', voiceRx: MHZ(145.900), voiceTx: MHZ(437.500), ctcss: 1413},
    {name: 'IO-86', catalog: '40931', voiceRx: MHZ(435.880), voiceTx: MHZ(145.880), ctcss: 885},
    {name: 'LilacSat', catalog: '40908', voiceRx: MHZ(437.200), voiceTx: MHZ(144.350)},
    {name: 'AO-27', catalog: '22825', voiceRx: MHZ(436.795), voiceTx: MHZ(145.850)},
    // APRS digipeater only (on a schedule)
    {name: 'SONATE-2', catalog: '59112', aprsRx: MHZ(145.825), aprsTx: MHZ(145.825)},
    // one FM transponder at a time where their footprints overlap
    ...TEVEL2.map(([name, catalog]) => ({name, catalog, voiceRx: MHZ(436.400), voiceTx: MHZ(145.970)})),
];

export function newSatellite(preset = {}) {
    return {
        name: 'SAT', catalog: '', tle1: '', tle2: '', voiceRx: 0, voiceTx: 0, ctcss: 0, armCtcss: 0, aprsRx: 0,
        aprsTx: 0, otherRx: 0, otherTx: 0, extra: null, ...preset,
    };
}

// The current TLE of a satellite (CelesTrak allows pages of other sites to read it)
export async function fetchTle(catalog) {
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(catalog)}&FORMAT=TLE`,
        {cache: 'no-store'});
    const text = await r.text();
    if (!r.ok) {
        throw new Error(`HTTP ${r.status} ${text.trim().slice(0, 80)}`);
    }
    const found = parseTleText(text);
    if (!found.length) {
        const e = new Error(text.trim().slice(0, 80) || 'no TLE');
        e.noData = /no gp data/i.test(text);
        throw e;
    }
    return found[0];
}

// All the amateur satellites' TLEs in one request (CelesTrak's "amateur" group), kept 2 hours in the browser: CelesTrak
// refuses the same query asked again too often. Map catalog -> {line1, line2}
const GROUP_CACHE = 'celestrak-amateur';
const GROUP_MAX_AGE_MS = 2 * 3600 * 1000;

export async function fetchAmateurGroup() {
    try {
        const cached = JSON.parse(localStorage.getItem(GROUP_CACHE) ?? 'null');
        if (cached && (Date.now() - cached.time) < GROUP_MAX_AGE_MS) {
            return new Map(parseTleText(cached.text).map((x) => [x.catalog, x]));
        }
    } catch (e) {
        // no storage: fetched each time
    }
    const r = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=TLE', {cache: 'no-store'});
    const text = await r.text();
    const found = parseTleText(text);
    if (!r.ok || !found.length) {
        throw new Error(`HTTP ${r.status} ${text.trim().slice(0, 80)}`);
    }
    try {
        localStorage.setItem(GROUP_CACHE, JSON.stringify({time: Date.now(), text}));
    } catch (e) {
        // no storage
    }
    return new Map(found.map((x) => [x.catalog, x]));
}

// One satellite's TLE from the TLE API (tle.ivanstanojevic.me, CelesTrak's data, readable by other sites): when
// CelesTrak itself refuses (it blocks an address that asked too often)
export async function fetchTleApi(catalog) {
    const r = await fetch(`https://tle.ivanstanojevic.me/api/tle/${encodeURIComponent(catalog)}`, {cache: 'no-store'});
    if (!r.ok) {
        throw new Error(`TLE API HTTP ${r.status}`);
    }
    const j = await r.json();
    if (!j.line1 || !j.line2) {
        throw new Error('TLE API: no TLE');
    }
    return {name: j.name ?? '', catalog: String(catalog), line1: j.line1, line2: j.line2};
}

export const AMSAT_TLE_URL = 'https://www.amsat.org/tle/current/nasabare.txt';

// AMSAT's TLE file through serve.py (/tle/amsat): amsat.org does not let other sites' pages read it. Map catalog -> TLE
export async function fetchAmsat() {
    const noServer = () => Object.assign(new Error('no serve.py'), {noServer: true});
    if (location.protocol === 'file:') { // opendmr-cps.html opened from disk: no serve.py
        throw noServer();
    }
    let r;
    try {
        r = await fetch('tle/amsat', {cache: 'no-store'});
    } catch (e) {
        throw noServer();
    }
    const text = await r.text();
    if (r.status === 404) {
        throw noServer();
    }
    const found = parseTleText(text);
    if (!r.ok || !found.length) {
        throw new Error(text.trim().slice(0, 80) || `HTTP ${r.status}`);
    }
    return new Map(found.map((x) => [x.catalog, x]));
}

export const TLE_SOURCES = ['auto', 'amsat', 'celestrak', 'tleapi'];
