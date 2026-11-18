// The DMR ID database: the callsign and name of a caller's DMR ID on the radio (OpenDMR src/services/dmr_ids.c).
// Written as the OpenGD77 CPS writes it for a DM-32 (DMRIDForm.writeToOpenGD77, "IdN" format): a 12 byte header
// "IdN" + (0x4A + record length) ... the count (u32 LE at 8), then records sorted by ID: the ID (3 bytes LE) and its
// text, 4 characters in 3 bytes (6 bits each, DECOMPRESS order). The header and the first records at 0x30000, the rest
// at 0xB8000, GD-77 flash addresses to which the CPS adds 0x20000 on a DM-32: 0x50000 and 0xD8000 in our window.

export const AREA_1 = 0x50000;
export const AREA_1_SPACE = 0x40000;
export const AREA_2 = 0xD8000;
export const WINDOW_END = 0x400000; // up to the receive log (OpenDMR rx_log.h RX_LOG_WINDOW_BASE); the window is 9 MB
export const HEADER = 12;
// The radio shows 31 characters at most (OpenDMR last_heard.h LAST_HEARD_TEXT_SIZE 32): no longer choices
export const TEXT_LENGTHS = [8, 12, 16, 20, 24, 31];
export const DEFAULT_TEXT_LENGTH = 16; // as the OpenGD77 CPS
export const SECTOR = 4096;

// The radio's characters, a 6 bit code each (dmr_ids.c DECOMPRESS_LUT); any other one becomes '.'
const DECOMPRESS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.';
const CODE = new Map([...DECOMPRESS].map((c, i) => [c, i]));

// The list downloaded: what the OpenGD77 CPS downloads by default; GitHub lets any page read it (radioid.net does not:
// its user.csv is opened as a file)
import {COUNTRY_OF_CODE} from './countries.js';

export const SOURCES = {
    gridRadio: 'https://api.grid.radio/opengd77/dmr-database',
};

// Regions for the selector (matches the grid.radio API's ?region= values)
export const REGIONS = [
    {id: '', label: 'Worldwide'},
    {id: 'europe', label: 'Europe'},
    {id: 'north-america', label: 'North America'},
    {id: 'south-america', label: 'South America'},
    {id: 'asia-pacific', label: 'Asia & Pacific'},
    {id: 'middle-east-africa', label: 'Middle East & Africa'},
    {id: 'custom', label: 'Custom countries\u2026'},
];

// Country list for the custom-countries selector, grouped by region
export const COUNTRY_LIST = [
    {id: 'europe', region: 'Europe', countries: ['Albania','Andorra','Armenia','Austria','Azerbaijan','Belarus','Belgium','Bosnia and Hercegovina','Bulgaria','Croatia','Cyprus','Czech Republic','Denmark','Estonia','Faroe Islands','Finland','France','Georgia','Germany','Gibraltar','Greece','Hungary','Iceland','Ireland','Italy','Kosovo','Latvia','Liechtenstein','Lithuania','Luxemburg','Macedonia','Malta','Moldova','Monaco','Montenegro','Netherlands','Norway','Poland','Portugal','Romania','Russia','San Marino','Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland','Turkiye','Ukraine','United Kingdom','Corsica','Aaland Islands']},
    {id: 'north-america', region: 'North America', countries: ['Anguilla','Antigua and Barbuda','Aruba','Bahamas','Barbados','Belize','Bermuda','Bonaire','British Virgin Islands','Canada','Cayman Islands','Costa Rica','Cuba','Curacao','Dominica','Dominican Republic','El Salvador','Greenland','Grenada','Guadeloupe','Guatemala','Haiti','Honduras','Jamaica','Martinique','Mexico','Montserrat','Nicaragua','Panama','Puerto Rico','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Trinidad and Tobago','U.S. Virgin Islands','United States']},
    {id: 'south-america', region: 'South America', countries: ['Argentina Republic','Bolivia','Brazil','Chile','Colombia','Ecuador','Falkland Islands','French Guiana','Guyana','Paraguay','Peru','Suriname','Uruguay','Venezuela']},
    {id: 'asia-pacific', region: 'Asia & Pacific', countries: ['American Samoa','Australia','Bangladesh','Brunei Darussalam','China','Cook Islands','Guam','Hong Kong','India','Indonesia','Japan','Kazakhstan','Kiribati','Korea Republic of','Kyrgyzstan','Laos','Macao','Malaysia','Maldives','Micronesia','Mongolia','Nepal','New Caledonia','New Zealand','Pakistan','Palau','Papua New Guinea','Philippines','Samoa','Singapore','Sri Lanka','Taiwan','Thailand','Timor-Leste','Tonga','Turkmenistan','Tuvalu','Uzbekistan','Vanuatu','Vietnam']},
    {id: 'middle-east-africa', region: 'Middle East & Africa', countries: ['Bahrain','Cameroon','Egypt','Ethiopia','Ghana','Iran','Iraq','Israel','Jordan','Kenya','Kuwait','Lebanon','Libya','Malawi','Morocco','Mozambique','Nigeria','Oman','Palestine','Qatar','Rwanda','Saudi Arabia','South Africa','Sudan','Tanzania','Tunisia','Uganda','United Arab Emirates','Yemen','Zimbabwe']},
];

export const compressSize = (n) => (Math.floor(n / 4) * 3) + (n % 4);
export const recordLength = (textLength) => 3 + compressSize(textLength);

export function capacity(textLength) {
    const rl = recordLength(textLength);
    return Math.floor((AREA_1_SPACE - HEADER) / rl) + Math.floor((WINDOW_END - AREA_2) / rl);
}

// One CSV line into its fields ("..." quoted fields may hold commas, "" is a quote)
function csvFields(line) {
    const out = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
            if (c === '"' && line[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === ',') {
            out.push(field);
            field = '';
        } else {
            field += c;
        }
    }
    out.push(field);
    return out.map((f) => f.trim());
}

// The entries of a CSV: radioid.net's (RADIO_ID, CALLSIGN, FIRST_NAME, LAST_NAME, CITY, STATE, COUNTRY) or the
// ContactLists one (Radio ID, Callsign, Name, Nickname, City, State, Country, Remarks). Throws when it has no ID or
// callsign column. given: the first name (RadioID's FIRST_NAME; ContactLists' Name without its last word), country:
// RadioID's name for it (ContactLists gives an ISO 3166 code)
export function parseCsv(text) {
    const lines = text.split(/\r?\n/);
    const head = csvFields(lines[0] ?? '').map((h) => h.toLowerCase().replace(/[\s_]+/g, ''));
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const c = {
        id: col('radioid', 'id', 'dmrid'),
        callsign: col('callsign', 'call'),
        name: col('name'),
        first: col('firstname'),
        last: col('lastname'),
        city: col('city'),
        state: col('state'),
        country: col('country'),
    };
    if (c.id < 0 || c.callsign < 0) {
        throw new Error('no ID / callsign column');
    }
    const entries = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) {
            continue;
        }
        const f = csvFields(lines[i]);
        const id = Number(f[c.id]);
        if (!Number.isInteger(id) || id < 1 || id > 0xFFFFFF) {
            continue;
        }
        const name = (c.name >= 0) ? f[c.name] : [f[c.first] ?? '', f[c.last] ?? ''].join(' ').trim();
        const words = (name ?? '').split(/\s+/).filter((w) => w);
        const given = (c.first >= 0) ? (f[c.first] ?? '') : words.slice(0, Math.max(1, words.length - 1)).join(' ');
        const country = (c.country >= 0) ? (f[c.country] ?? '') : '';
        entries.push({
            id,
            callsign: f[c.callsign] ?? '',
            name: name ?? '',
            given,
            city: (c.city >= 0) ? f[c.city] : '',
            state: (c.state >= 0) ? f[c.state] : '',
            country: COUNTRY_OF_CODE[country] ?? country,
        });
    }
    return entries;
}

// Entries from the grid.radio JSON API ({ entries: [{id, callsign, name, firstName, surname, city, state, country}] })
export function parseJson(data) {
    return (data.entries || []).map((e) => {
        const id = Number(e.id);
        if (!Number.isInteger(id) || id < 1 || id > 0xFFFFFF) {
            return null;
        }
        const name = e.name || [e.firstName || '', e.surname || ''].filter((s) => s).join(' ');
        const given = e.firstName || e.name || '';
        const country = e.country || '';
        return {
            id,
            callsign: e.callsign || '',
            name,
            given,
            city: e.city || '',
            state: e.state || '',
            country: COUNTRY_OF_CODE[country] ?? country,
        };
    }).filter(Boolean);
}

// The text the radio shows: "CALLSIGN Name" (the callsign large, the rest under it), the city with withCity
export function entryText(e, withCity) {
    return [e.callsign, e.name, withCity ? e.city : ''].filter((s) => s).join(' ');
}

// What the radio can show of a text: accents taken off (DMRDataItem.RemoveDiacritics), cut to the length, the other
// characters as '.', the trailing spaces dropped (dmr_ids.c decode_text())
export function radioText(text, length) {
    const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, length);
    return [...plain].map((ch) => (CODE.has(ch) ? ch : '.')).join('').replace(/ +$/, '');
}

// DMRDataItem.compress(): 4 characters in 3 bytes, the first in the top 6 bits
function compress(text, out, at) {
    const codes = [...text].map((ch) => CODE.get(ch) ?? 63);
    for (let i = 0, o = at; i < codes.length; i += 4, o += 3) {
        const [a, b = 0, c = 0, d = 0] = codes.slice(i, i + 4);
        out[o] = (a << 2) | (b >> 4);
        if (i + 1 < codes.length) {
            out[o + 1] = ((b & 0x0F) << 4) | (c >> 2);
        }
        if (i + 2 < codes.length) {
            out[o + 2] = ((c & 0x03) << 6) | d;
        }
    }
}

// The entries kept: valid IDs, one entry an ID (the first), only those starting with one of the prefixes (none: all),
// sorted by ID
export function select(entries, prefixes) {
    const seen = new Set();
    const keep = [];
    for (const e of entries) {
        if (seen.has(e.id)) {
            continue;
        }
        const s = String(e.id);
        if (prefixes.length && !prefixes.some((p) => s.startsWith(p))) {
            continue;
        }
        seen.add(e.id);
        keep.push(e);
    }
    return keep.sort((a, b) => a.id - b.id);
}

// The database bytes and where they go: [{address, data}] in whole sectors (0xFF after the end), the entries cut to
// the capacity
export function build(entries, textLength, withCity) {
    const rl = recordLength(textLength);
    const count = Math.min(entries.length, capacity(textLength));
    const buf = new Uint8Array(HEADER + (rl * count));
    buf.set([0x49, 0x64, 0x4E, 0x4A + rl, 0x30, 0x30, 0x31, 0x00]); // the CPS's "Id-V001": "IdN", the record length, "001"
    new DataView(buf.buffer).setUint32(8, count, true);
    for (let i = 0; i < count; i++) {
        const e = entries[i];
        const at = HEADER + (i * rl);
        buf[at] = e.id & 0xFF;
        buf[at + 1] = (e.id >> 8) & 0xFF;
        buf[at + 2] = (e.id >> 16) & 0xFF;
        compress(radioText(entryText(e, withCity), textLength), buf, at + 3);
    }
    const first = HEADER + (rl * Math.floor((AREA_1_SPACE - HEADER) / rl));
    const parts = [{address: AREA_1, bytes: buf.subarray(0, first)}];
    if (buf.length > first) {
        parts.push({address: AREA_2, bytes: buf.subarray(first)});
    }
    const sectors = [];
    for (const p of parts) {
        for (let off = 0; off < p.bytes.length; off += SECTOR) {
            const data = new Uint8Array(SECTOR).fill(0xFF);
            data.set(p.bytes.subarray(off, off + SECTOR));
            sectors.push({sector: (p.address + off) / SECTOR, data});
        }
    }
    return {count, bytes: buf.length, sectors};
}
