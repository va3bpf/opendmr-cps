// The codeplug as CSV files, in the OpenGD77 CPS's format (its File > CSV export: Channels.csv, Zones.csv,
// Contacts.csv, TG_Lists.csv, APRS.csv; the same headers and values), so its files import here as they are, and a list
// from another CPS can be edited into them by hand or in a spreadsheet. What OpenDMR has more is in columns added at
// the end of Channels.csv (NAC, Step, Force DMO) and in more Channel Type values (AM, USB, LSB, P25).
// docs/csv.md describes the files.
//
// Import: the files given (any of them) are told apart by their header; columns are found by name (any case and
// spacing), the ones not known left out, a missing one takes the default. References go by name (a channel's Contact,
// TG List and APRS, a TG list's contacts, a zone's channels), as in the OpenGD77 CPS.
//   replace (its "Import"): each list given replaces the codeplug's; the channel numbers are the file's
//   append (its "Append"): the channels are added after the codeplug's (their numbers left out); contacts, TG lists,
//     zones and APRS configurations with a name the codeplug has replace that one, the others are added
// With an error nothing is changed.

import {MODES, POWER_LEVELS, STEPS_HZ, P25_NAC_DEFAULT, NXDN_RAN_DEFAULT, NXDN_RAN_MAX, TA_TX, CALL_TYPES,
    APRS_CONFIGS_MAX, newAprsConfig,
    toneFromCodeplug, toneToCodeplug, frequencyValid} from './codeplug.js';
import * as L from './layout.js';
import * as gb from '../gb2312.js';

export const FILES = {
    channels: 'Channels.csv',
    zones: 'Zones.csv',
    contacts: 'Contacts.csv',
    tgLists: 'TG_Lists.csv',
    aprs: 'APRS.csv',
};

const OPENGD77_POWER = ['Master', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', '-W+'];
const ANALOG = ['FM', 'AM', 'USB', 'LSB'];
const CONTACT_TYPES = ['Group', 'Private', 'AllCall'];

const norm = (s) => String(s).toLowerCase().replace(/[\s_\-().%]/g, '');
const yesNo = (v) => (v ? 'Yes' : 'No');
const trueFalse = (v) => (v ? 'True' : 'False');
const degrees = (v) => ((v === null || v === undefined) ? '0' : String(Number(v.toFixed(4))));

/* ---- CSV text ---- */

function quote(v) {
    const s = String(v ?? '');
    return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvText(rows) {
    return '﻿' + rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n'; // the BOM: Excel reads UTF-8
}

// CSV text -> rows of cells (trimmed: the OpenGD77 CPS puts a tab before the frequencies). The separator is the
// header's: comma, semicolon (Excel in some countries) or tab.
export function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                cell += c;
            }
        } else if (c === '"' && cell.trim() === '') {
            quoted = true;
            cell = '';
        } else if (c === sep) {
            row.push(cell);
            cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') {
                i++;
            }
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += c;
        }
    }
    if (cell !== '' || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// A file's bytes -> text: UTF-8, or GBK / GB18030 (a CSV saved by Excel on a Chinese Windows)
export function decodeCsvBytes(bytes) {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch (e) {
        return new TextDecoder('gb18030').decode(bytes);
    }
}

// Which file a header row is
export function tableOf(header) {
    const h = header.map(norm);
    if (h.includes('rxfrequency')) {
        return 'channels';
    }
    if (h[0] === 'zonename') {
        return 'zones';
    }
    if (h[0] === 'tglistname') {
        return 'tgLists';
    }
    if (h[0] === 'aprsconfigname') {
        return 'aprs';
    }
    if (h[0] === 'contactname' && h.includes('id')) {
        return 'contacts';
    }
    if (h[0] === 'contactname' && h.includes('code')) {
        return 'dtmf';
    }
    return null;
}

/* ---- export ---- */

const CHANNEL_HEADER = ['Channel Number', 'Channel Name', 'Channel Type', 'Rx Frequency', 'Tx Frequency',
    'Bandwidth (kHz)', 'Colour Code', 'Timeslot', 'Contact', 'TG List', 'DMR ID', 'TS1_TA_Tx', 'TS2_TA_Tx ID',
    'RX Tone', 'TX Tone', 'Squelch', 'Power', 'Rx Only', 'Zone Skip', 'All Skip', 'TOT', 'VOX', 'No Beep', 'No Eco',
    'APRS', 'Latitude', 'Longitude', 'Use Location',
    'NAC', 'Step (kHz)', 'Force DMO', 'RAN']; // OpenDMR's

function squelchText(sql) {
    if (sql === 0) {
        return 'Disabled';
    }
    if (sql === 1) {
        return 'Open';
    }
    return sql > 20 ? 'Closed' : `${(sql - 1) * 5}%`;
}

function channelRow(ch, cp) {
    const analog = ANALOG.includes(ch.mode);
    const dmr = ch.mode === 'DMR';
    const contact = cp.contacts.find((c) => c.index === ch.contact)?.name;
    const group = cp.rxGroups.find((g) => g.number === ch.rxGroup)?.name;
    const aprs = cp.aprsConfigs.find((c) => c.index === ch.aprs)?.name;
    return [
        ch.number, ch.name, ({FM: 'Analogue', DMR: 'Digital'})[ch.mode] ?? ch.mode,
        (ch.rx / 1e6).toFixed(5), (ch.tx / 1e6).toFixed(5),
        analog ? (ch.wide ? '25' : '12.5') : '',
        dmr ? ch.colourCode : '', dmr ? ch.timeslot : '',
        analog ? '' : (contact ?? 'None'), analog ? '' : (group ?? 'None'),
        dmr ? (ch.dmrId || 'None') : '',
        dmr ? TA_TX[ch.taTx1] : '', dmr ? TA_TX[ch.taTx2] : '',
        analog ? (ch.rxTone || 'None') : '', analog ? (ch.txTone || 'None') : '',
        analog ? squelchText(ch.squelch) : '',
        OPENGD77_POWER[ch.power] ?? 'Master',
        yesNo(ch.rxOnly), yesNo(ch.zoneSkip), yesNo(ch.allSkip), ch.tot, ch.vox ? 'On' : 'Off',
        yesNo(!ch.beep), yesNo(!ch.eco), aprs ?? 'None',
        degrees(ch.latitude), degrees(ch.longitude), yesNo(ch.useLocation),
        ch.mode === 'P25' ? ch.nac.toString(16).toUpperCase().padStart(3, '0') : '',
        String(ch.step / 1000), dmr ? yesNo(ch.forceDmo) : '',
        ch.mode === 'NXDN' ? ch.ran : '',
    ];
}

// The codeplug as CSV files: [{name, text}]
export function exportCsv(cp) {
    const byNumber = new Map(cp.channels.map((c) => [c.number, c]));
    const files = [];
    files.push({name: FILES.channels, text: csvText([CHANNEL_HEADER, ...cp.channels.map((ch) => channelRow(ch, cp))])});
    const zoneSize = cp.channelsPerZone;
    files.push({name: FILES.zones, text: csvText([
        ['Zone Name', ...Array.from({length: zoneSize}, (_, i) => `Channel${i + 1}`)],
        ...cp.zones.map((z) => {
            const names = z.channels.map((n) => byNumber.get(n)?.name).filter((n) => n !== undefined);
            return [z.name, ...names, ...new Array(zoneSize - names.length).fill('')];
        })])});
    files.push({name: FILES.contacts, text: csvText([['Contact Name', 'ID', 'ID Type', 'TS Override'],
        ...cp.contacts.map((c) => [c.name, c.id, CONTACT_TYPES[CALL_TYPES.indexOf(c.callType)],
            c.timeslot === 0 ? 'Disabled' : c.timeslot])])});
    const byIndex = new Map(cp.contacts.map((c) => [c.index, c.name]));
    files.push({name: FILES.tgLists, text: csvText([
        ['TG List Name', ...Array.from({length: L.RX_GROUP_CONTACTS}, (_, i) => `Contact${i + 1}`)],
        ...cp.rxGroups.map((g) => {
            const names = g.contacts.map((i) => byIndex.get(i)).filter((n) => n !== undefined);
            return [g.name, ...names, ...new Array(L.RX_GROUP_CONTACTS - names.length).fill('')];
        })])});
    files.push({name: FILES.aprs, text: csvText([['APRS config Name', 'SSID', 'Via1', 'Via1 SSID', 'Via2', 'Via2 SSID',
        'Icon table', 'Icon', 'Comment text', 'Ambiguity', 'Use position', 'Latitude', 'Longitude', 'TX Frequency',
        'Transmit QSY', 'Baud rate setting'],
    ...cp.aprsConfigs.map((c) => [c.name, c.ssid, c.via1, c.via1Ssid, c.via2, c.via2Ssid, c.iconTable, c.icon,
        c.comment, c.ambiguity, trueFalse(c.usePosition), degrees(c.latitude), degrees(c.longitude),
        c.txFrequency ? (c.txFrequency / 1e6).toFixed(5) : '', trueFalse(c.qsy), c.baud300 ? 1 : 0])])});
    return files;
}

/* ---- import: the cells ---- */

class CellError extends Error {}

function fail(what) {
    throw new CellError(what);
}

function number(text, lo, hi) {
    const v = Number(text);
    if (!/^-?\d+$/.test(text) || v < lo || v > hi) {
        fail(`"${text}" is not a number from ${lo} to ${hi}`);
    }
    return v;
}

function frequency(text) {
    const t = text.replace(',', '.');
    const v = Math.round(parseFloat(t) * 1e5) * 10; // 10 Hz units
    if (!/^\d+(\.\d*)?$/.test(t) || !Number.isFinite(v)) {
        fail(`"${text}" is not a frequency in MHz`);
    }
    if (!frequencyValid(v)) {
        fail(`${text} MHz is outside the radio's bands`);
    }
    return v;
}

function bool(text) {
    const t = text.toLowerCase();
    if (['yes', 'y', 'true', 'on', '1', '是', 'si', 'sí', 's'].includes(t)) {
        return true;
    }
    if (['no', 'n', 'false', 'off', '0', '', '否'].includes(t)) {
        return false;
    }
    return fail(`"${text}" is not Yes / No`);
}

function coordinate(text, max) {
    const t = text.replace(',', '.');
    if (t === '') {
        return null;
    }
    const v = Number(t);
    if (!Number.isFinite(v) || Math.abs(v) > max) {
        fail(`"${text}" is not a coordinate (decimal degrees)`);
    }
    return v === 0 ? null : v;
}

function tone(text) {
    let t = text.toUpperCase().replace(/\s|HZ$/g, '').replace(',', '.');
    if (t === '' || t === 'NONE' || t === 'OFF') {
        return '';
    }
    if (/^D[0-7]{3}$/.test(t)) {
        t += 'N';
    }
    try {
        return toneFromCodeplug(toneToCodeplug(t));
    } catch (e) {
        return fail(`"${text}" is not a tone (None, 88.5, D023N, D023I)`);
    }
}

function power(text) {
    const t = text.toUpperCase().replace(/\s/g, '');
    if (t === '' || t === 'MASTER') {
        return 0;
    }
    let i = OPENGD77_POWER.findIndex((p) => p.toUpperCase() === t);
    if (i < 0 && t === '+W-') {
        i = 10;
    }
    if (i < 0) { // OpenDMR's levels by name: 50mW ... 10W
        const w = POWER_LEVELS.findIndex((p) => p.toUpperCase() === t);
        i = (w >= 0) ? w + 1 : -1;
    }
    if (i < 0) {
        fail(`"${text}" is not a power (Master, P1 - P9, -W+, or ${POWER_LEVELS.slice(0, 9).join(', ')})`);
    }
    return i;
}

function squelch(text) {
    const t = text.toLowerCase().replace(/\s/g, '');
    if (t === '' || t === 'disabled' || t === 'master') {
        return 0;
    }
    if (t === 'open') {
        return 1;
    }
    if (t === 'closed') {
        return 21;
    }
    return Math.round(number(t.replace(/%$/, ''), 0, 100) / 5) + 1;
}

function fitName(text, ctx, bytes = L.NAME_LENGTH) {
    const bad = gb.unencodable(text);
    if (bad.length) {
        ctx.warn(`"${text}": ${bad.join(' ')} cannot be shown on the radio (written as ?)`);
    }
    const fitted = gb.decode(Uint8Array.from(gb.encode(text, bytes)));
    if (fitted.length < text.length) {
        ctx.warn(`"${text}" cut to "${fitted}" (${bytes} bytes; a Chinese character takes 2)`);
    }
    return fitted;
}

function fitAscii(text, length, ctx, what) {
    if (/[^\x20-\x7E]/.test(text)) {
        fail(`${what} "${text}": letters, digits and signs only`);
    }
    if (text.length > length) {
        ctx.warn(`${what} "${text}" cut to ${length} characters`);
    }
    return text.slice(0, length);
}

/* ---- import: the tables ---- */

// The rows of a file as objects by column: cell(name) is '' for a missing column or cell
function table(rows) {
    const header = rows[0].map(norm);
    return rows.slice(1).map((r, i) => ({
        line: i + 2,
        cells: r,
        cell: (...names) => {
            for (const n of names) {
                const at = header.indexOf(norm(n));
                if (at >= 0) {
                    return r[at] ?? '';
                }
            }
            return '';
        },
        has: (n) => header.includes(norm(n)),
        members: (prefix) => header.map((h, at) => [h, at])
            .filter(([h]) => new RegExp('^' + norm(prefix) + '\\d+$').test(h))
            .sort((a, b) => Number(a[0].slice(norm(prefix).length)) - Number(b[0].slice(norm(prefix).length)))
            .map(([, at]) => r[at] ?? '').filter((v) => v !== ''),
    }));
}

// Each row through fn(row, ctx); a CellError becomes an error of that line
function eachRow(rows, file, report, fn) {
    for (const row of rows) {
        const ctx = {warn: (text) => report.warnings.push(`${file} line ${row.line}: ${text}`)};
        try {
            fn(row, ctx);
        } catch (e) {
            if (!(e instanceof CellError)) {
                throw e;
            }
            report.errors.push(`${file} line ${row.line}: ${e.message}`);
        }
    }
}

// Entries by name: an entry of the file replaces the one of that name (append), or the list is the file's (replace)
function mergeByName(old, incoming, replace, key, max) {
    if (replace) {
        return incoming;
    }
    const list = [...old];
    for (const e of incoming) {
        const at = list.findIndex((x) => x.name === e.name);
        if (at >= 0) {
            list[at] = {...e, [key]: list[at][key], raw: list[at].raw};
        } else {
            list.push(e);
        }
    }
    return list.slice(0, max);
}

// Numbers 1 ... for the entries without one, as the slots they take
function number1(list, key, max) {
    const used = new Set(list.map((e) => e[key]).filter(Boolean));
    let next = 1;
    for (const e of list) {
        if (!e[key]) {
            while (used.has(next)) {
                next++;
            }
            e[key] = next;
            used.add(next);
        }
    }
    return list.filter((e) => e[key] <= max);
}

// files: [{name, text}]. Returns {errors, warnings, counts: {table: n}}.
export function importCsv(cp, files, {replace = false, newChannel}) {
    const report = {errors: [], warnings: [], counts: {}};
    const tables = {};
    for (const f of files) {
        const rows = parseCsv(f.text);
        const kind = rows.length ? tableOf(rows[0]) : null;
        if (!kind) {
            report.warnings.push(`${f.name}: not a file of the OpenGD77 CSV export, left out`);
            continue;
        }
        if (kind === 'dtmf') {
            report.warnings.push(`${f.name}: DTMF contacts are not imported`);
            continue;
        }
        if (tables[kind]) {
            report.errors.push(`${f.name}: a second ${FILES[kind]} (${tables[kind].file})`);
            continue;
        }
        tables[kind] = {file: f.name, rows: table(rows)};
    }
    if (!Object.keys(tables).length) {
        report.errors.push('no CSV file of the codeplug (Channels.csv, Zones.csv, Contacts.csv, TG_Lists.csv, APRS.csv)');
        return report;
    }

    // the old names, to keep references from the lists not imported
    const oldContactName = new Map(cp.contacts.map((c) => [c.index, c.name]));
    const oldGroupName = new Map(cp.rxGroups.map((g) => [g.number, g.name]));
    const oldAprsName = new Map(cp.aprsConfigs.map((c) => [c.index, c.name]));
    const oldChannelName = new Map(cp.channels.map((c) => [c.number, c.name]));

    // APRS configurations
    let aprsConfigs = cp.aprsConfigs;
    if (tables.aprs) {
        const incoming = [];
        eachRow(tables.aprs.rows, tables.aprs.file, report, (r, ctx) => {
            const c = newAprsConfig();
            c.name = fitAscii(r.cell('APRS config Name'), 8, ctx, 'name');
            if (!c.name) {
                fail('no name');
            }
            const n = (name, lo, hi, dflt) => (r.cell(name) === '' ? dflt : number(r.cell(name), lo, hi));
            c.ssid = n('SSID', 0, 15, 7);
            c.via1 = fitAscii(r.cell('Via1'), 6, ctx, 'Via1');
            c.via1Ssid = n('Via1 SSID', 0, 15, 0);
            c.via2 = fitAscii(r.cell('Via2'), 6, ctx, 'Via2');
            c.via2Ssid = n('Via2 SSID', 0, 15, 0);
            c.iconTable = n('Icon table', 0, 1, 0);
            c.icon = n('Icon', 0, 93, 58);
            c.comment = fitAscii(r.cell('Comment text'), 24, ctx, 'comment');
            c.ambiguity = n('Ambiguity', 0, 7, 0);
            c.usePosition = bool(r.cell('Use position'));
            c.latitude = coordinate(r.cell('Latitude'), 90);
            c.longitude = coordinate(r.cell('Longitude'), 180);
            const tx = r.cell('TX Frequency');
            c.txFrequency = (tx === '' || Number(tx.replace(',', '.')) === 0) ? 0 : frequency(tx);
            c.qsy = bool(r.cell('Transmit QSY'));
            c.baud300 = n('Baud rate setting', 0, 1, 0) === 1;
            incoming.push(c);
        });
        if (incoming.length > APRS_CONFIGS_MAX && replace) {
            report.warnings.push(`${tables.aprs.file}: ${APRS_CONFIGS_MAX} APRS configurations at most, the others left out`);
        }
        aprsConfigs = number1(mergeByName(cp.aprsConfigs, incoming, replace, 'index', APRS_CONFIGS_MAX), 'index',
            APRS_CONFIGS_MAX);
        report.counts.aprs = incoming.length;
    }

    // contacts
    let contacts = cp.contacts;
    if (tables.contacts) {
        const incoming = [];
        eachRow(tables.contacts.rows, tables.contacts.file, report, (r, ctx) => {
            const name = fitName(r.cell('Contact Name'), ctx);
            if (!name) {
                fail('no name');
            }
            const type = r.cell('ID Type').toLowerCase().replace(/\s/g, '');
            const callType = ({group: 'group', private: 'private', allcall: 'all', all: 'all', '': 'group'})[type];
            if (!callType) {
                fail(`ID Type "${r.cell('ID Type')}" is not Group, Private or AllCall`);
            }
            const ts = r.cell('TS Override').toUpperCase().replace(/^TS/, '');
            const timeslot = (ts === '' || ts === 'DISABLED' || ts === 'NONE' || ts === 'OFF') ? 0 : number(ts, 1, 2);
            incoming.push({name, id: number(r.cell('ID'), 1, 16777215), callType, timeslot, raw: null});
        });
        contacts = number1(mergeByName(cp.contacts, incoming, replace, 'index', L.CONTACTS_MAX), 'index', L.CONTACTS_MAX);
        report.counts.contacts = incoming.length;
    }
    const contactIndex = (name) => contacts.find((c) => c.name === name)?.index ??
        contacts.find((c) => c.name.toLowerCase() === name.toLowerCase())?.index ?? 0;

    // TG lists
    // the lists kept: when a list they refer to was replaced, their references follow the names
    const newContacts = replace && tables.contacts;
    const keptContact = (i) => (newContacts ? contactIndex(oldContactName.get(i) ?? '') : i);
    let rxGroups = cp.rxGroups.map((g) => ({...g, contacts: g.contacts.map(keptContact).filter(Boolean)}));
    if (tables.tgLists) {
        const incoming = [];
        eachRow(tables.tgLists.rows, tables.tgLists.file, report, (r, ctx) => {
            const name = fitName(r.cell('TG List Name'), ctx);
            if (!name) {
                fail('no name');
            }
            const members = [];
            for (const m of r.members('Contact')) {
                const i = contactIndex(m);
                if (!i) {
                    ctx.warn(`contact "${m}" not in the contacts, left out`);
                } else if (members.length >= L.RX_GROUP_CONTACTS) {
                    ctx.warn(`${L.RX_GROUP_CONTACTS} contacts at most, "${m}" left out`);
                } else {
                    members.push(i);
                }
            }
            incoming.push({name, contacts: members});
        });
        rxGroups = number1(mergeByName(rxGroups, incoming, replace, 'number', L.RX_GROUPS_MAX), 'number', L.RX_GROUPS_MAX);
        report.counts.tgLists = incoming.length;
    }
    const groupNumber = (name) => rxGroups.find((g) => g.name === name)?.number ??
        rxGroups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.number ?? 0;
    const aprsIndex = (name) => aprsConfigs.find((c) => c.name.toLowerCase() === name.toLowerCase())?.index ?? 0;

    // channels
    let channels = cp.channels.map((ch) => ({...ch, contact: keptContact(ch.contact),
        rxGroup: (replace && tables.tgLists) ? groupNumber(oldGroupName.get(ch.rxGroup) ?? '') : ch.rxGroup,
        aprs: (replace && tables.aprs) ? aprsIndex(oldAprsName.get(ch.aprs) ?? '') : ch.aprs}));
    let imported = [];
    if (tables.channels) {
        const rows = tables.channels.rows;
        const taken = new Set(replace ? [] : cp.channels.map((c) => c.number));
        if (replace) { // the file's numbers
            const seen = new Map();
            for (const r of rows) {
                const v = r.cell('Channel Number');
                if (v === '') {
                    continue;
                }
                if (!/^\d+$/.test(v) || +v < 1 || +v > L.CHANNELS_MAX) {
                    report.errors.push(`${tables.channels.file} line ${r.line}: Channel Number "${v}" is not from 1 to ${L.CHANNELS_MAX}`);
                } else if (seen.has(+v)) {
                    report.errors.push(`${tables.channels.file} line ${r.line}: channel ${v} is also on line ${seen.get(+v)}`);
                } else {
                    seen.set(+v, r.line);
                    taken.add(+v);
                }
            }
        }
        let next = 1;
        const free = () => {
            while (taken.has(next)) {
                next++;
            }
            taken.add(next);
            return next;
        };
        const existing = new Map(cp.channels.map((c) => [c.number, c]));
        eachRow(rows, tables.channels.file, report, (r, ctx) => {
            const given = replace ? r.cell('Channel Number') : '';
            const n = (given !== '' && /^\d+$/.test(given)) ? +given : free();
            if (n > L.CHANNELS_MAX) {
                fail(`no free channel number (${L.CHANNELS_MAX} at most)`);
            }
            const ch = newChannel(n);
            const old = replace ? existing.get(n) : null;
            ch.raw = old?.raw ? Uint8Array.from(old.raw) : null; // the bytes this editor does not know, kept
            ch.name = fitName(r.cell('Channel Name', 'Name'), ctx) || ('CH' + n);
            const type = r.cell('Channel Type', 'Mode').toUpperCase();
            ch.mode = ({ANALOGUE: 'FM', ANALOG: 'FM', DIGITAL: 'DMR', '': 'FM'})[type] ?? MODES.find((m) => m === type);
            if (!ch.mode) {
                fail(`Channel Type "${r.cell('Channel Type')}" is not Analogue, Digital, AM, USB, LSB or P25`);
            }
            const rx = r.cell('Rx Frequency');
            if (rx === '') {
                fail('no Rx Frequency');
            }
            ch.rx = frequency(rx);
            ch.tx = r.cell('Tx Frequency') === '' ? ch.rx : frequency(r.cell('Tx Frequency'));
            const bw = r.cell('Bandwidth (kHz)').replace(',', '.');
            if (bw !== '') {
                if (!['12.5', '25', '20'].includes(bw)) {
                    fail(`Bandwidth "${bw}" is not 12.5 or 25`);
                }
                ch.wide = bw !== '12.5';
            }
            const cc = r.cell('Colour Code', 'Color Code');
            ch.colourCode = cc === '' ? 1 : number(cc, 0, 15);
            const ts = r.cell('Timeslot').toUpperCase().replace(/^TS/, '');
            ch.timeslot = ts === '' ? 1 : number(ts, 1, 2);
            const ref = (text, find, what) => {
                if (text === '' || text.toLowerCase() === 'none') {
                    return 0;
                }
                const v = find(text);
                if (!v) {
                    ctx.warn(`${what} "${text}" not in the codeplug: none set`);
                }
                return v;
            };
            ch.contact = ref(r.cell('Contact'), contactIndex, 'contact');
            ch.rxGroup = ref(r.cell('TG List'), groupNumber, 'TG list');
            ch.aprs = ref(r.cell('APRS'), aprsIndex, 'APRS configuration');
            const id = r.cell('DMR ID');
            ch.dmrId = (id === '' || id.toLowerCase() === 'none') ? 0 : number(id, 1, 16777215);
            const ta = (text) => {
                const i = TA_TX.findIndex((v) => v.toLowerCase() === text.toLowerCase());
                return (text === '') ? 0 : (i >= 0 ? i : fail(`"${text}" is not ${TA_TX.join(', ')}`));
            };
            ch.taTx1 = ta(r.cell('TS1_TA_Tx', 'TS1_TA_Tx ID'));
            ch.taTx2 = ta(r.cell('TS2_TA_Tx ID', 'TS2_TA_Tx'));
            ch.rxTone = tone(r.cell('RX Tone'));
            ch.txTone = tone(r.cell('TX Tone'));
            ch.squelch = squelch(r.cell('Squelch'));
            ch.power = power(r.cell('Power'));
            ch.rxOnly = bool(r.cell('Rx Only'));
            ch.zoneSkip = bool(r.cell('Zone Skip'));
            ch.allSkip = bool(r.cell('All Skip'));
            const tot = r.cell('TOT');
            ch.tot = tot === '' ? 0 : Math.round(number(tot, 0, 3825) / 15) * 15;
            ch.vox = bool(r.cell('VOX'));
            ch.beep = !bool(r.cell('No Beep'));
            ch.eco = !bool(r.cell('No Eco'));
            ch.latitude = coordinate(r.cell('Latitude'), 90);
            ch.longitude = coordinate(r.cell('Longitude'), 180);
            ch.useLocation = bool(r.cell('Use Location'));
            const nac = r.cell('NAC').replace(/^0x/i, '');
            if (nac === '') {
                ch.nac = P25_NAC_DEFAULT;
            } else if (/^[0-9a-f]{1,3}$/i.test(nac)) {
                ch.nac = parseInt(nac, 16);
            } else {
                fail(`NAC "${nac}" is not 3 hex digits`);
            }
            const step = r.cell('Step (kHz)', 'Step').replace(',', '.');
            if (step !== '') {
                const hz = Math.round(parseFloat(step) * 1000);
                if (!STEPS_HZ.includes(hz)) {
                    fail(`Step "${step}" is not ${STEPS_HZ.map((s) => s / 1000).join(', ')} kHz`);
                }
                ch.step = hz;
            }
            ch.forceDmo = bool(r.cell('Force DMO'));
            const ran = r.cell('RAN');
            ch.ran = ran === '' ? NXDN_RAN_DEFAULT : number(ran, 0, NXDN_RAN_MAX);
            imported.push(ch);
        });
        report.counts.channels = imported.length;
        channels = replace ? imported : [...channels, ...imported];
        channels.sort((a, b) => a.number - b.number);
    }

    // zones: the members of the ones kept follow the channel names
    const channelNumber = (name, preferred) => (preferred.find((c) => c.name === name) ??
        channels.find((c) => c.name === name) ??
        channels.find((c) => c.name.toLowerCase() === name.toLowerCase()))?.number ?? 0;
    const numbers = new Set(channels.map((c) => c.number));
    let zones = cp.zones.map((z) => ({...z, channels: tables.channels ?
        z.channels.map((n) => (replace ? channelNumber(oldChannelName.get(n) ?? '', []) : n)).filter((n) => numbers.has(n)) :
        [...z.channels]}));
    if (tables.zones) {
        const incoming = [];
        eachRow(tables.zones.rows, tables.zones.file, report, (r, ctx) => {
            const name = fitName(r.cell('Zone Name'), ctx);
            if (!name) {
                fail('no name');
            }
            const members = [];
            for (const m of r.members('Channel')) {
                const n = channelNumber(m, imported);
                if (!n) {
                    ctx.warn(`channel "${m}" not in the channels, left out`);
                } else if (members.length >= cp.channelsPerZone) {
                    ctx.warn(`${cp.channelsPerZone} channels a zone at most, "${m}" left out`);
                } else if (!members.includes(n)) {
                    members.push(n);
                }
            }
            incoming.push({name, channels: members});
        });
        if (replace) {
            zones = incoming;
        } else {
            for (const z of incoming) {
                const at = zones.findIndex((x) => x.name === z.name);
                if (at >= 0) {
                    zones[at] = z;
                } else {
                    zones.push(z);
                }
            }
        }
        if (zones.length > L.ZONES_MAX) {
            report.warnings.push(`${tables.zones.file}: ${L.ZONES_MAX} zones at most, the others left out`);
            zones = zones.slice(0, L.ZONES_MAX);
        }
        report.counts.zones = incoming.length;
    }

    if (report.errors.length) {
        return report;
    }
    cp.channels = channels;
    cp.zones = zones;
    cp.contacts = contacts.sort((a, b) => a.index - b.index);
    cp.rxGroups = rxGroups.sort((a, b) => a.number - b.number);
    if (tables.aprs) {
        cp.aprsConfigs = aprsConfigs.sort((a, b) => a.index - b.index);
        cp.aprsDirty = true;
    }
    return report;
}
