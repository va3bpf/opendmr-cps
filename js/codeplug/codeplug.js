// The codeplug: the image of the radio's data flash window (layout.js) and the records parsed from it. Records keep
// the bytes they were read from; store() writes back only the fields this editor knows, so whatever else the firmware
// or the OpenGD77 CPS keeps in them is left as it was.

import * as L from './layout.js';
import {u16, setU16, u32, setU32, fromBcd, toBcd, readBcdBigEndian, writeBcdBigEndian, fill} from './bytes.js';
import * as gb from '../gb2312.js';
import {RadioSettings} from './settings.js';
import * as SAT from './satellites.js';
import * as TH from './themes.js';
import * as BOOT from './boot_image.js';

export const MODES = ['FM', 'DMR', 'P25', 'NXDN', 'M17', 'AM', 'USB', 'LSB'];
export const DIGITAL_MODES = ['DMR', 'P25', 'NXDN', 'M17'];
const OPENDMR_MODE_TAG = 0xA0;       // codeplug.c: byte 37, 0xA1 AM, 0xA2 USB, 0xA3 LSB; 0xA4 P25, 0xA5 NXDN, 0xA6 M17 (byte 24 digital)
const OPENDMR_MODE_P25 = 0xA4;
const OPENDMR_MODE_NXDN = 0xA5;
const OPENDMR_MODE_M17 = 0xA6;
// NXDN's RAN (codeplug.h codeplug_nxdn_ran()): 0 - 63 in byte 44 (DMR's colour code); out of range: 1. 0 receives any
export const NXDN_RAN_DEFAULT = 1;
export const NXDN_RAN_MAX = 63;
export const M17_CAN_MAX = 15; // M17's channel access number, byte 44 (codeplug.h codeplug_m17_can())
// The radio's NXDN ID (OpenDMR services/nxdn_id.c, a custom data block "DT" 6): version 1, 0, the ID little endian;
// 0 or no block: the DMR ID
// store(): a new custom data block needed, but the area's chain of blocks is broken at `at` (#124)
export class CustomDataDamaged extends Error {
    constructor(at) {
        super(`the custom data is damaged at 0x${(at - L.CUSTOM_DATA).toString(16)}: no room for new blocks`);
        this.at = at;
    }
}

const CUSTOM_EMPTY = 0xFFFFFFFF;   // a free place (type and length), the chain's end
const CUSTOM_RETIRED = 0x4454FFFF; // a block replaced by one of another length: kept as space, read by nobody
export const NXDN_ID_BLOCK_TYPE = 0x44540006;
const NXDN_ID_BLOCK_LENGTH = 4;
// The radio's interface language (OpenDMR services/language.c): its code in the custom data block "DT" 8 (version 1,
// 3 bytes 0, the code NUL padded to 8 bytes). Before it (and still followed when there) "DT" 4: version 1, a number
// (0 English, 1 Chinese, 2 Spanish); no block: bit 19 of bitfield_options, Chinese
export const LANGUAGE_BLOCK_TYPE = 0x44540008;
const LANGUAGE_BLOCK_LENGTH = 12;
const OLD_LANGUAGE_BLOCK_TYPE = 0x44540004;
const OLD_LANGUAGES = ['en', 'zh', 'es'];
// P25's NAC (codeplug.h codeplug_p25_nac()): 12 bits, low 8 in byte 44 (DMR's colour code), high 4 in byte 42 with
// 0xA0 over them; not tagged (0x00 / 0xFF from the OpenGD77 CPS): 293
export const P25_NAC_DEFAULT = 0x293;
export const P25_NAC_ANY = 0xF7E;
const ANALOG_MODE_INDEX = {AM: 1, USB: 2, LSB: 3};
export const CALL_TYPES = ['group', 'private', 'all'];
// The firmware's levels: 1W / 4W / 10W the stock Low / Middle / High of the factory table, the others between
export const POWER_LEVELS = ['50mW', '500mW', '1W', '2W', '3W', '4W', '5W', '7W', '10W', '+W-'];
export const STEPS_HZ = [2500, 5000, 6250, 10000, 12500, 25000, 30000, 50000];
export const CTCSS = [670, 693, 719, 744, 770, 797, 825, 854, 885, 915, 948, 974, 1000, 1035, 1072, 1109, 1148, 1188,
    1230, 1273, 1318, 1365, 1413, 1462, 1514, 1567, 1598, 1622, 1655, 1679, 1713, 1738, 1773, 1799, 1835, 1862, 1899,
    1928, 1966, 1995, 2035, 2065, 2107, 2181, 2257, 2291, 2336, 2418, 2503, 2541];
export const DCS = [0x023, 0x025, 0x026, 0x031, 0x032, 0x043, 0x047, 0x051, 0x054, 0x065, 0x071, 0x072, 0x073, 0x074,
    0x114, 0x115, 0x116, 0x125, 0x131, 0x132, 0x134, 0x143, 0x152, 0x155, 0x156, 0x162, 0x165, 0x172, 0x174, 0x205,
    0x223, 0x226, 0x243, 0x244, 0x245, 0x251, 0x261, 0x263, 0x265, 0x271, 0x306, 0x311, 0x315, 0x331, 0x343, 0x345,
    0x351, 0x364, 0x365, 0x371, 0x411, 0x412, 0x413, 0x423, 0x431, 0x432, 0x445, 0x464, 0x465, 0x466, 0x503, 0x506,
    0x516, 0x532, 0x546, 0x565, 0x606, 0x612, 0x624, 0x627, 0x631, 0x632, 0x654, 0x662, 0x664, 0x703, 0x712, 0x723,
    0x731, 0x732, 0x734, 0x743, 0x754];

// Radio bands (codeplug.c bands[]), Hz: the airband receive only (the radio refuses to transmit there)
export const BANDS = [[108000000, 136997500], [137000000, 180000000], [200000000, 279975000], [280000000, 520000000]];

export function frequencyValid(hz) {
    return BANDS.some(([lo, hi]) => (hz >= lo) && (hz <= hi));
}

// VFO frequencies locked out of the scans for good (OpenDMR app/scan.c, a custom data block "DT" 5): the count, then
// up to 32 frequencies in 10 Hz units, little endian
export const LOCKOUT_BLOCK_TYPE = 0x44540005;
export const LOCKOUTS_MAX = 32;
const LOCKOUT_BLOCK_LENGTH = 4 + (4 * LOCKOUTS_MAX);

// Channel flags (OpenDMR app/channel_details.c)
const FLAG1_OPTIONAL_DMR_ID = 0x80; // libre_dmr_flag1 (byte 38)
const FLAG1_NO_BEEP = 0x40;
const FLAG1_NO_ECO = 0x20;
const FLAG1_USE_LOCATION = 0x08;
const FLAG1_FORCE_DMO = 0x04;
const TA_TX_TS1_SHIFT = 0;          // flag1 (byte 48): talker alias Tx, 2 bits a timeslot: off, APRS, text, both
const TA_TX_TS2_SHIFT = 2;
export const TA_TX = ['Off', 'APRS', 'Text', 'APRS+Text'];
const FLAG2_TS2 = 0x40;             // byte 49
const FLAG4_VOX = 0x40;             // byte 51
const FLAG4_ZONE_SKIP = 0x20;
const FLAG4_ALL_SKIP = 0x10;
const FLAG4_RX_ONLY = 0x04;
const FLAG4_25K = 0x02;

function readName(img, at, length) {
    return gb.decode(img.subarray(at, at + length));
}

function writeName(img, at, length, text) {
    const bytes = gb.encode(text, length);
    fill(img, at, length, 0xFF);
    img.set(bytes, at);
}

// Tones: '' none, '88.5' CTCSS, 'D023N' / 'D023I' DCS (codeplug.c css_from_codeplug, tones.h)
export function toneFromCodeplug(v) {
    if ((v === 0) || (v === 0xFFFF)) {
        return '';
    }
    if ((v & 0xC000) === 0) {
        const tenths = fromBcd(v);
        return Number.isNaN(tenths) ? '' : (tenths / 10).toFixed(1);
    }
    return 'D' + (v & 0x0FFF).toString(16).padStart(3, '0') + ((v & 0x4000) ? 'I' : 'N');
}

export function toneToCodeplug(text) {
    const t = String(text ?? '').trim().toUpperCase();
    if (t === '') {
        return 0xFFFF;
    }
    const dcs = /^D?([0-7]{3})([NI])$/.exec(t);
    if (dcs) {
        return 0x8000 | parseInt(dcs[1], 16) | ((dcs[2] === 'I') ? 0x4000 : 0);
    }
    const hz = parseFloat(t);
    if (!Number.isFinite(hz) || hz < 60 || hz > 260) {
        throw new Error('tone');
    }
    return toBcd(Math.round(hz * 10));
}

export function toneChoices() {
    return ['', ...CTCSS.map((t) => (t / 10).toFixed(1)),
        ...DCS.map((c) => 'D' + c.toString(16).padStart(3, '0') + 'N'),
        ...DCS.map((c) => 'D' + c.toString(16).padStart(3, '0') + 'I')];
}

// A channel's or APRS configuration's place (OpenDMR channel_screen.c fixed24_degrees): 24 bits, sign 23, degrees
// 22:15, 1/10000 degree 14:0; null: none (0)
export function degreesFromFixed24(f) {
    if (f === 0) {
        return null;
    }
    const value = ((f & 0x7FFFFF) >> 15) + ((f & 0x7FFF) / 10000);
    return (f & 0x800000) ? -value : value;
}

export function degreesToFixed24(v) {
    if (v === null || v === undefined || v === 0) {
        return 0;
    }
    const a = Math.abs(v);
    let deg = Math.floor(a);
    let frac = Math.round((a - deg) * 10000);
    if (frac >= 10000) {
        deg++;
        frac = 0;
    }
    return ((v < 0) ? 0x800000 : 0) | ((deg & 0xFF) << 15) | frac;
}

// APRS configurations (codeplug.h codeplug_aprs_config_t, 64 bytes, 8 of them): in use with a name and the magic
export const APRS_CONFIG_SIZE = 64;
export const APRS_CONFIGS_MAX = 8;
const APRS_MAGIC = [0x4152, 0x4153];
const u24 = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const setU24 = (b, at, v) => {
    b[at] = v & 0xFF;
    b[at + 1] = (v >> 8) & 0xFF;
    b[at + 2] = (v >> 16) & 0xFF;
};
const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n)).replace(/[\u0000\u00FF].*$/s, '');
function setAscii(b, at, n, text) {
    fill(b, at, n, 0xFF);
    [...String(text ?? '')].slice(0, n).forEach((c, i) => {
        b[at + i] = c.charCodeAt(0) & 0x7F;
    });
}

// The APRS symbols (the primary and alternate tables' characters, 0x21 to 0x7E) with their names, as the old CPS and
// the APRS spec's symbol tables have them: the symbol is the character, its code minus 33 the index in the config
export const APRS_SYMBOL_NAMES = {
    '!': 'Police', '#': 'Digipeater', '$': 'Phone', '%': 'DX cluster', '&': 'HF gateway', "'": 'Aircraft',
    '(': 'Mobile satellite', ')': 'Wheelchair', '*': 'Snowmobile', '+': 'Red cross', ',': 'Boy scouts', '-': 'House',
    '.': 'X', '/': 'Y', ':': 'Fire', ';': 'Campground', '<': 'Motorcycle', '=': 'Railroad', '>': 'Car', '?': 'Server',
    '@': 'Hurricane', A: 'Aid station', B: 'BBS', C: 'Canoe', E: 'Eyeball', F: 'Tractor', G: 'Grid square',
    H: 'Hotel', I: 'TCP/IP', K: 'School', M: 'MacAPRS', N: 'NTS', O: 'Balloon', P: 'Police', R: 'RV', S: 'Shuttle',
    T: 'SSTV', W: 'Weather', X: 'X', Y: 'Yacht', '[': 'Weather site', a: 'Ambulance', b: 'Bike', c: 'Coast guard',
    f: 'Fire truck', h: 'Hospital', j: 'Jeep', k: 'Truck', m: 'Mic-E', n: 'Node', u: 'Bus', v: 'Van',
};

// [character, label] for the symbol picker: every character of the two tables, its name when it has one
export function aprsSymbolChoices() {
    const choices = [];
    for (let code = 0x21; code <= 0x7E; code++) {
        const ch = String.fromCharCode(code);
        const name = APRS_SYMBOL_NAMES[ch] || ((code >= 0x30 && code <= 0x39) ? 'Number' : '');
        choices.push([ch, name ? `${ch}  ${name}` : ch]);
    }
    return choices;
}

// The character of a configuration's symbol (icon: the index, table: 0 primary / 1 alternate)
export function aprsSymbolOf(config) {
    return String.fromCharCode(33 + (config.icon & 0x7F));
}

export function newAprsConfig(name = 'APRS') {
    return {name, ssid: 7, via1: 'WIDE1', via1Ssid: 1, via2: 'WIDE2', via2Ssid: 1, iconTable: 0, icon: 58, // '[': a person (a handheld)
        comment: '', ambiguity: 0, usePosition: false, latitude: null, longitude: null, txFrequency: 0, qsy: false,
        baud300: false, raw: null};
}

function readAprsConfig(r) {
    return {
        name: ascii(r, 0, 8), ssid: r[8],
        latitude: degreesFromFixed24(u24(r, 9)), longitude: degreesFromFixed24(u24(r, 12)),
        via1: ascii(r, 15, 6), via1Ssid: r[21], via2: ascii(r, 22, 6), via2Ssid: r[28],
        iconTable: r[29] ? 1 : 0, icon: r[30], comment: ascii(r, 31, 24),
        txFrequency: u32(r, 55) * 10, // Hz, 0: the channel's
        baud300: (r[61] & 0x01) !== 0, usePosition: (r[61] & 0x02) !== 0, qsy: (r[61] & 0x04) !== 0,
        ambiguity: (r[61] >> 4) & 0x07,
        raw: r,
    };
}

function writeAprsConfig(c) {
    const r = c.raw ?? new Uint8Array(APRS_CONFIG_SIZE).fill(0);
    setAscii(r, 0, 8, c.name.toUpperCase());
    r[8] = c.ssid;
    setU24(r, 9, degreesToFixed24(c.latitude));
    setU24(r, 12, degreesToFixed24(c.longitude));
    setAscii(r, 15, 6, c.via1.toUpperCase());
    r[21] = c.via1Ssid;
    setAscii(r, 22, 6, c.via2.toUpperCase());
    r[28] = c.via2Ssid;
    r[29] = c.iconTable;
    r[30] = c.icon;
    setAscii(r, 31, 24, c.comment);
    setU32(r, 55, Math.round(c.txFrequency / 10));
    r[61] = (r[61] & 0x88) | (c.baud300 ? 0x01 : 0) | (c.usePosition ? 0x02 : 0) | (c.qsy ? 0x04 : 0) |
        ((c.ambiguity & 0x07) << 4);
    if (!APRS_MAGIC.includes(u16(r, 62))) {
        setU16(r, 62, APRS_MAGIC[1]);
    }
    c.raw = r;
    return r;
}

export class Codeplug {
    constructor(img) {
        this.img = img ?? Codeplug.blankImage();
        this.parse();
    }

    static blankImage() {
        const img = new Uint8Array(L.IMAGE_SIZE).fill(0xFF);
        // empty tables: no channel, zone or RX group in use
        for (let bank = 0; bank < L.CHANNEL_BANKS; bank++) {
            fill(img, L.bankHeader(bank), 16, 0);
        }
        fill(img, L.ZONES_IN_USE, 32, 0);
        fill(img, L.RX_GROUP_LENGTHS, L.RX_GROUPS_MAX, 0);
        for (let z = 0; z < L.ZONES_MAX; z++) { // 80 channels a zone: the channel lists 0
            fill(img, L.ZONES + (z * (16 + (2 * 80))) + 16, 2 * 80, 0);
        }
        return img;
    }

    parse() {
        const img = this.img;
        this.settings = new RadioSettings(img); // edited in place in the image
        const satBlock = this.findCustomBlock(SAT.BLOCK_TYPE);
        this.satellites = (satBlock && satBlock.length === SAT.BLOCK_LENGTH) ?
            SAT.parseBlock(img.subarray(satBlock.data, satBlock.data + satBlock.length)) : [];
        this.satellitesDirty = false;
        const lockBlock = this.findCustomBlock(LOCKOUT_BLOCK_TYPE);
        this.lockouts = []; // VFO frequencies (Hz) locked out of the scans
        if (lockBlock && lockBlock.length === LOCKOUT_BLOCK_LENGTH) {
            const n = Math.min(u32(img, lockBlock.data), LOCKOUTS_MAX);
            for (let i = 0; i < n; i++) {
                this.lockouts.push(u32(img, lockBlock.data + 4 + (4 * i)) * 10);
            }
        }
        this.lockoutsDirty = false;
        const themeBlock = this.findCustomBlock(TH.THEME_BLOCK_TYPE);
        this.themes = TH.readThemes(themeBlock ? img.subarray(themeBlock.data, themeBlock.data + themeBlock.length) : null);
        this.hadThemeBlock = !!themeBlock;
        this.themesDirty = false;
        const bootBlock = this.findCustomBlock(BOOT.BOOT_IMAGE_BLOCK_TYPE);
        const bootBytes = bootBlock ? img.slice(bootBlock.data, bootBlock.data + bootBlock.length) : null;
        this.bootImage = BOOT.isValidBootImageBlock(bootBytes) ? bootBytes : null;
        this.hadBootImageBlock = !!bootBlock;
        this.bootImageDirty = false;
        const nxdnBlock = this.findCustomBlock(NXDN_ID_BLOCK_TYPE);
        this.nxdnIdRead = (nxdnBlock && nxdnBlock.length === NXDN_ID_BLOCK_LENGTH && img[nxdnBlock.data] === 1) ?
            (img[nxdnBlock.data + 2] | (img[nxdnBlock.data + 3] << 8)) : 0;
        const langBlock = this.findCustomBlock(LANGUAGE_BLOCK_TYPE);
        const oldLangBlock = this.findCustomBlock(OLD_LANGUAGE_BLOCK_TYPE);
        if (langBlock && langBlock.length === LANGUAGE_BLOCK_LENGTH && img[langBlock.data] === 1) {
            const code = img.subarray(langBlock.data + 4, langBlock.data + 12);
            this.languageRead = new TextDecoder().decode(code.subarray(0, code.indexOf(0) < 0 ? 8 : code.indexOf(0))) || 'en';
        } else if (oldLangBlock && oldLangBlock.length === 2 && img[oldLangBlock.data] === 1 && img[oldLangBlock.data + 1] < 3) {
            this.languageRead = OLD_LANGUAGES[img[oldLangBlock.data + 1]];
        } else {
            this.languageRead = this.settings.language;
        }
        this.settings.language = this.languageRead;
        this.customRanges = []; // the custom data bytes store() changed (and the APRS configurations)
        this.aprsConfigs = []; // {index (1 - 8), ...}
        for (let i = 1; i <= APRS_CONFIGS_MAX; i++) {
            const at = L.APRS_CONFIGS + ((i - 1) * APRS_CONFIG_SIZE);
            if (img[at] !== 0xFF && APRS_MAGIC.includes(u16(img, at + 62))) {
                this.aprsConfigs.push({index: i, ...readAprsConfig(img.slice(at, at + APRS_CONFIG_SIZE))});
            }
        }
        this.aprsDirty = false;
        this.channelsPerZone = (img[L.ZONE_FORMAT_CHECK + 15] <= 0x04) ? 80 : 16;
        this.general = {
            callsign: readName(img, L.CALLSIGN, 8),
            dmrId: readBcdBigEndian(img, L.DMR_ID) || 0,
            nxdnId: this.nxdnIdRead, // 0: not set (the DMR ID)
        };
        this.channels = [];
        for (let n = 1; n <= L.CHANNELS_MAX; n++) {
            const bank = Math.floor((n - 1) / L.CHANNELS_PER_BANK);
            const bit = (n - 1) % L.CHANNELS_PER_BANK;
            if (img[L.bankHeader(bank) + (bit >> 3)] & (1 << (bit & 7))) {
                this.channels.push(this.readChannel(n));
            }
        }
        // the two VFOs: channels without a number (codeplug.c ADDR_VFO_A)
        this.vfos = [0, 1].map((v) => {
            let ch = this.readChannel(0, L.VFO_A + (v * L.CHANNEL_SIZE));
            if (!frequencyValid(ch.rx) || !frequencyValid(ch.tx)) { // out of the bands (a new codeplug: 0xFF bytes,
                // read as Rx only, VOX, TOT 3825 s ...): a VFO as a new channel, at 144 MHz as the firmware reads it
                ch = Object.assign(Codeplug.newChannel(0), {name: '', rx: 144000000, tx: 144000000});
            }
            ch.vfo = v;
            return ch;
        });
        this.zones = [];
        for (let i = 0; i < L.ZONES_MAX; i++) {
            if (img[L.ZONES_IN_USE + (i >> 3)] & (1 << (i & 7))) {
                const at = L.ZONES + (i * (16 + (2 * this.channelsPerZone)));
                const channels = [];
                for (let j = 0; j < this.channelsPerZone; j++) {
                    const c = u16(img, at + 16 + (2 * j));
                    if (c === 0) {
                        break;
                    }
                    channels.push(c);
                }
                this.zones.push({name: readName(img, at, 16), channels});
            }
        }
        this.contacts = [];
        for (let i = 0; i < L.CONTACTS_MAX; i++) {
            const at = L.CONTACTS + (i * L.CONTACT_SIZE);
            if ((img[at] !== 0xFF) && (img[at + 20] < 3)) {
                const ts = img[at + 23];
                this.contacts.push({
                    index: i + 1,
                    name: readName(img, at, 16),
                    id: readBcdBigEndian(img, at + 16) || 0,
                    callType: CALL_TYPES[img[at + 20]],
                    timeslot: (ts & 0x01) ? 0 : ((ts & 0x02) ? 2 : 1),
                    raw: img.slice(at, at + L.CONTACT_SIZE),
                });
            }
        }
        this.rxGroups = [];
        for (let i = 0; i < L.RX_GROUPS_MAX; i++) {
            if (img[L.RX_GROUP_LENGTHS + i] !== 0) {
                const at = L.RX_GROUPS + (i * L.RX_GROUP_SIZE);
                const contacts = [];
                for (let j = 0; j < L.RX_GROUP_CONTACTS; j++) {
                    const c = u16(img, at + 16 + (2 * j));
                    if (c === 0) {
                        break;
                    }
                    contacts.push(c);
                }
                this.rxGroups.push({number: i + 1, name: readName(img, at, 16), contacts});
            }
        }
    }

    readChannel(number, at = L.channelAddress(number)) {
        const img = this.img;
        const raw = img.slice(at, at + L.CHANNEL_SIZE);
        let mode = 'FM';
        if (raw[24] !== 0) {
            mode = (raw[37] === OPENDMR_MODE_P25) ? 'P25' : (raw[37] === OPENDMR_MODE_NXDN) ? 'NXDN' :
                (raw[37] === OPENDMR_MODE_M17) ? 'M17' : 'DMR';
        } else {
            const index = raw[37] ^ OPENDMR_MODE_TAG;
            mode = ['FM', 'AM', 'USB', 'LSB'][index] ?? 'FM';
        }
        const optionalId = (raw[38] & FLAG1_OPTIONAL_DMR_ID) ? ((raw[39] << 16) | (raw[40] << 8) | raw[41]) : 0;
        return {
            number,
            name: readName(raw, 0, 16),
            mode,
            rx: (fromBcd(u32(raw, 16)) || 0) * 10,
            tx: (fromBcd(u32(raw, 20)) || 0) * 10,
            rxTone: toneFromCodeplug(u16(raw, 32)),
            txTone: toneFromCodeplug(u16(raw, 34)),
            power: raw[25],          // 0: the radio's setting, 1 - 10: POWER_LEVELS[power - 1]
            tot: raw[27] * 15,       // s, 0: off
            colourCode: (mode === 'P25' || mode === 'NXDN' || mode === 'M17') ? 1 : (raw[44] & 0x0F),
            ran: (raw[44] <= NXDN_RAN_MAX) ? raw[44] : NXDN_RAN_DEFAULT,
            can: (raw[44] <= M17_CAN_MAX) ? raw[44] : 0,
            nac: ((raw[42] & 0xF0) === 0xA0) ? (((raw[42] & 0x0F) << 8) | raw[44]) : P25_NAC_DEFAULT,
            timeslot: (raw[49] & FLAG2_TS2) ? 2 : 1,
            contact: u16(raw, 46),   // contact index, 0: none
            rxGroup: raw[43],        // RX group list number, 0: none
            aprs: raw[45],
            wide: (raw[51] & FLAG4_25K) !== 0,
            rxOnly: (raw[51] & FLAG4_RX_ONLY) !== 0,
            zoneSkip: (raw[51] & FLAG4_ZONE_SKIP) !== 0,
            allSkip: (raw[51] & FLAG4_ALL_SKIP) !== 0,
            vox: (raw[51] & FLAG4_VOX) !== 0,
            squelch: raw[55] <= 21 ? raw[55] : 0, // 0: the radio's setting, 1 - 21: 0 - 100 % in 5 % steps
            beep: !(raw[38] & FLAG1_NO_BEEP),
            eco: !(raw[38] & FLAG1_NO_ECO),
            forceDmo: (raw[38] & FLAG1_FORCE_DMO) !== 0,
            dmrId: optionalId,       // 0: the radio's
            step: STEPS_HZ[(raw[54] >> 4) % STEPS_HZ.length],
            taTx1: (raw[48] >> TA_TX_TS1_SHIFT) & 0x03, // TA_TX index
            taTx2: (raw[48] >> TA_TX_TS2_SHIFT) & 0x03,
            latitude: degreesFromFixed24(raw[26] | (raw[28] << 8) | (raw[29] << 16)), // null: none
            longitude: degreesFromFixed24(raw[30] | (raw[31] << 8) | (raw[36] << 16)),
            useLocation: (raw[38] & FLAG1_USE_LOCATION) !== 0,
            raw,
        };
    }

    writeChannel(ch, at = L.channelAddress(ch.number)) {
        const raw = ch.raw ?? Codeplug.newChannelBytes();
        writeName(raw, 0, 16, ch.name);
        setU32(raw, 16, toBcd(Math.round(ch.rx / 10)));
        setU32(raw, 20, toBcd(Math.round(ch.tx / 10)));
        raw[24] = DIGITAL_MODES.includes(ch.mode) ? 1 : 0;
        raw[37] = (ch.mode === 'P25') ? OPENDMR_MODE_P25 : (ch.mode === 'NXDN') ? OPENDMR_MODE_NXDN :
            (ch.mode === 'M17') ? OPENDMR_MODE_M17 :
            (ANALOG_MODE_INDEX[ch.mode] ? (OPENDMR_MODE_TAG | ANALOG_MODE_INDEX[ch.mode]) : 0);
        setU16(raw, 32, toneToCodeplug(ch.rxTone));
        setU16(raw, 34, toneToCodeplug(ch.txTone));
        raw[25] = ch.power;
        raw[27] = Math.min(255, Math.round(ch.tot / 15));
        if (ch.mode === 'P25') {
            raw[44] = ch.nac & 0xFF;
            raw[42] = 0xA0 | ((ch.nac >> 8) & 0x0F);
        } else if (ch.mode === 'NXDN') {
            raw[44] = Math.min(Math.max(ch.ran, 0), NXDN_RAN_MAX);
        } else if (ch.mode === 'M17') {
            raw[44] = Math.min(Math.max(ch.can ?? 0, 0), M17_CAN_MAX);
        } else {
            raw[44] = ch.colourCode & 0x0F;
        }
        raw[49] = (raw[49] & ~FLAG2_TS2) | ((ch.timeslot === 2) ? FLAG2_TS2 : 0);
        setU16(raw, 46, ch.contact);
        raw[43] = ch.rxGroup;
        raw[45] = ch.aprs;
        raw[51] = (raw[51] & ~(FLAG4_25K | FLAG4_RX_ONLY | FLAG4_ZONE_SKIP | FLAG4_ALL_SKIP | FLAG4_VOX)) |
            (ch.wide ? FLAG4_25K : 0) | (ch.rxOnly ? FLAG4_RX_ONLY : 0) | (ch.zoneSkip ? FLAG4_ZONE_SKIP : 0) |
            (ch.allSkip ? FLAG4_ALL_SKIP : 0) | (ch.vox ? FLAG4_VOX : 0);
        raw[55] = ch.squelch;
        raw[38] = (raw[38] & ~(FLAG1_NO_BEEP | FLAG1_NO_ECO | FLAG1_FORCE_DMO | FLAG1_OPTIONAL_DMR_ID |
            FLAG1_USE_LOCATION)) | (ch.beep ? 0 : FLAG1_NO_BEEP) | (ch.eco ? 0 : FLAG1_NO_ECO) |
            (ch.forceDmo ? FLAG1_FORCE_DMO : 0) | (ch.dmrId ? FLAG1_OPTIONAL_DMR_ID : 0) |
            (ch.useLocation ? FLAG1_USE_LOCATION : 0);
        raw[48] = (raw[48] & 0xF0) | ((ch.taTx1 & 0x03) << TA_TX_TS1_SHIFT) | ((ch.taTx2 & 0x03) << TA_TX_TS2_SHIFT);
        // the place: written only when changed (the bytes as another CPS left them otherwise)
        if (degreesFromFixed24(raw[26] | (raw[28] << 8) | (raw[29] << 16)) !== ch.latitude) {
            const lat = degreesToFixed24(ch.latitude);
            [raw[26], raw[28], raw[29]] = [lat & 0xFF, (lat >> 8) & 0xFF, (lat >> 16) & 0xFF];
        }
        if (degreesFromFixed24(raw[30] | (raw[31] << 8) | (raw[36] << 16)) !== ch.longitude) {
            const lon = degreesToFixed24(ch.longitude);
            [raw[30], raw[31], raw[36]] = [lon & 0xFF, (lon >> 8) & 0xFF, (lon >> 16) & 0xFF];
        }
        if (ch.dmrId) {
            raw[39] = (ch.dmrId >> 16) & 0xFF;
            raw[40] = (ch.dmrId >> 8) & 0xFF;
            raw[41] = ch.dmrId & 0xFF;
        }
        const stepIndex = Math.max(0, STEPS_HZ.indexOf(ch.step));
        raw[54] = (raw[54] & 0x0F) | (stepIndex << 4);
        this.img.set(raw, at);
        ch.raw = raw;
    }

    // A new channel's bytes as the OpenGD77 CPS leaves them: 0 but the name and the tones
    static newChannelBytes() {
        const raw = new Uint8Array(L.CHANNEL_SIZE);
        fill(raw, 0, 16, 0xFF);
        setU16(raw, 32, 0xFFFF);
        setU16(raw, 34, 0xFFFF);
        raw[39] = 0x00;
        raw[40] = 0x16; // DMR_ID_DEFAULT (channel_details.c): the bytes when the channel has no DMR ID
        raw[41] = 0x00;
        return raw;
    }

    static newChannel(number) {
        return {
            number, name: 'CH' + number, mode: 'FM', rx: 145500000, tx: 145500000, rxTone: '', txTone: '',
            power: 0, tot: 0, colourCode: 1, nac: P25_NAC_DEFAULT, ran: NXDN_RAN_DEFAULT, can: 0, timeslot: 1, contact: 0, rxGroup: 0, aprs: 0, wide: true,
            rxOnly: false, zoneSkip: false, allSkip: false, vox: false, squelch: 0, beep: true, eco: true,
            forceDmo: false, dmrId: 0, step: 12500, taTx1: 0, taTx2: 0, latitude: null, longitude: null,
            useLocation: false, raw: null,
        };
    }

    freeChannelNumber() {
        const used = new Set(this.channels.map((c) => c.number));
        for (let n = 1; n <= L.CHANNELS_MAX; n++) {
            if (!used.has(n)) {
                return n;
            }
        }
        return 0;
    }

    freeContactIndex() {
        const used = new Set(this.contacts.map((c) => c.index));
        for (let i = 1; i <= L.CONTACTS_MAX; i++) {
            if (!used.has(i)) {
                return i;
            }
        }
        return 0;
    }

    freeRxGroupNumber() {
        const used = new Set(this.rxGroups.map((g) => g.number));
        for (let i = 1; i <= L.RX_GROUPS_MAX; i++) {
            if (!used.has(i)) {
                return i;
            }
        }
        return 0;
    }

    // A custom data block (custom_data.c find_block): {at: its header, data, length}; type EMPTY: the first free
    // place; null: none, or no "OpenGD77" header
    findCustomBlock(type) {
        const img = this.img;
        if (new TextDecoder().decode(img.subarray(L.CUSTOM_DATA, L.CUSTOM_DATA + 8)) !== 'OpenGD77') {
            return null;
        }
        for (let at = L.CUSTOM_DATA + 12; at + 8 <= L.CUSTOM_DATA_END;) {
            const t = u32(img, at);
            const length = u32(img, at + 4);
            if (t === type) {
                return {at, data: at + 8, length};
            }
            if (length === 0 || length === 0xFFFFFFFF) {
                return null;
            }
            at += 8 + length;
        }
        return null;
    }

    // Where the custom data's chain of blocks breaks: the header of a block of length 0 (a zero filled area: the CPS
    // and the firmware's custom_data.c can't add a block after it), or one running past the area; -1: a sound chain (or
    // no "OpenGD77" header: started afresh when written). #124
    customDataDamage() {
        const img = this.img;
        if (new TextDecoder().decode(img.subarray(L.CUSTOM_DATA, L.CUSTOM_DATA + 8)) !== 'OpenGD77') {
            return -1;
        }
        let at = L.CUSTOM_DATA + 12;
        for (; at + 8 <= L.CUSTOM_DATA_END;) {
            const t = u32(img, at);
            const length = u32(img, at + 4);
            if (t === CUSTOM_EMPTY && length === CUSTOM_EMPTY) {
                return -1;
            }
            if (length === 0 || length === CUSTOM_EMPTY || (at + 8 + length > L.CUSTOM_DATA_END)) {
                return at;
            }
            at += 8 + length;
        }
        return (at < L.CUSTOM_DATA_END) ? at : -1; // a few bytes left at the end: full, not broken
    }

    // The broken part cleared (0xFF from that header to the end): the blocks before it kept; the firmware sees none
    // after it either
    repairCustomData(at) {
        fill(this.img, at, L.CUSTOM_DATA_END - at, 0xFF);
        this.customRepair = [at, L.CUSTOM_DATA_END];
    }

    // A custom data block written: the same block, or a new one in the first free place (custom_data.c)
    storeCustomBlock(type, bytes, what) {
        const img = this.img;
        if (new TextDecoder().decode(img.subarray(L.CUSTOM_DATA, L.CUSTOM_DATA + 8)) !== 'OpenGD77') {
            // no codeplug written yet: the header, and the blocks from an empty area
            img.set(new TextEncoder().encode('OpenGD77'), L.CUSTOM_DATA);
            setU32(img, L.CUSTOM_DATA + 8, 1);
            fill(img, L.CUSTOM_DATA + 12, 8, 0xFF);
            this.customRanges.push([L.CUSTOM_DATA, L.CUSTOM_DATA + 12]);
        }
        let block = this.findCustomBlock(type);
        if (block && block.length !== bytes.length) {
            // another length (another version's block): retired in place, so the blocks after it stay where they are
            // (resized there, it ran over them); the new one goes into the first free place
            setU32(img, block.at, CUSTOM_RETIRED);
            this.customRanges.push([block.at, block.at + 4]);
            block = null;
        }
        if (!block) {
            block = this.findCustomBlock(CUSTOM_EMPTY);
            if (!block || (block.data + bytes.length + 8 > L.CUSTOM_DATA_END)) {
                throw new Error(`no room for the ${what} in the custom data`);
            }
            setU32(img, block.at, type);
            setU32(img, block.at + 4, bytes.length);
            fill(img, block.data + bytes.length, 8, 0xFF); // the next free place: the chain's end
            this.customRanges.push([block.data + bytes.length, block.data + bytes.length + 8]);
        }
        img.set(bytes, block.data);
        this.customRanges.push([block.at, block.data + bytes.length]);
    }

    storeSatellites() {
        this.storeCustomBlock(SAT.BLOCK_TYPE, SAT.buildBlock(this.satellites), 'satellites');
    }

    storeLockouts() {
        const bytes = new Uint8Array(LOCKOUT_BLOCK_LENGTH);
        const list = this.lockouts.slice(0, LOCKOUTS_MAX);
        setU32(bytes, 0, list.length);
        list.forEach((hz, i) => setU32(bytes, 4 + (4 * i), Math.round(hz / 10)));
        this.storeCustomBlock(LOCKOUT_BLOCK_TYPE, bytes, 'scan lockouts');
    }

    // The custom data blocks store() is about to write: {type, length} (the same conditions as there)
    pendingCustomBlocks() {
        const out = [];
        if (this.satellitesDirty) {
            out.push({type: SAT.BLOCK_TYPE, length: SAT.BLOCK_LENGTH});
        }
        if (this.lockoutsDirty) {
            out.push({type: LOCKOUT_BLOCK_TYPE, length: LOCKOUT_BLOCK_LENGTH});
        }
        if (this.themesDirty && (this.hadThemeBlock || !TH.isDefault(this.themes))) {
            out.push({type: TH.THEME_BLOCK_TYPE, length: TH.THEME_BLOCK_LENGTH});
        }
        if (this.bootImageDirty && (this.bootImage || this.hadBootImageBlock)) {
            out.push({type: BOOT.BOOT_IMAGE_BLOCK_TYPE, length: this.bootImage?.length ?? BOOT.BOOT_IMAGE_BLOCK_LENGTH});
        }
        if (this.general.nxdnId !== this.nxdnIdRead) {
            out.push({type: NXDN_ID_BLOCK_TYPE, length: NXDN_ID_BLOCK_LENGTH});
        }
        if (this.settings.languageDirty || this.settings.language !== this.languageRead) {
            out.push({type: LANGUAGE_BLOCK_TYPE, length: LANGUAGE_BLOCK_LENGTH});
        }
        return out;
    }

    // The records back into the image. CustomDataDamaged (nothing changed yet) when a block needs a new place and the
    // custom data's chain is broken: repairCustomData() with the user's consent, then store() again
    store() {
        const img = this.img;
        const bad = this.customRepair ? -1 : this.customDataDamage();
        if (bad >= 0 && this.pendingCustomBlocks().some(({type, length}) => this.findCustomBlock(type)?.length !== length)) {
            throw new CustomDataDamaged(bad);
        }
        this.customRanges = this.customRepair ? [this.customRepair] : [];
        if (this.satellitesDirty) {
            this.storeSatellites();
        }
        if (this.lockoutsDirty) {
            this.storeLockouts();
        }
        if (this.themesDirty) { // no block made while nothing is changed, unless one was there
            if (this.hadThemeBlock || !TH.isDefault(this.themes)) {
                this.storeCustomBlock(TH.THEME_BLOCK_TYPE, TH.writeThemes(this.themes), 'themes');
                this.hadThemeBlock = true;
            }
            this.themesDirty = false;
        }
        if (this.bootImageDirty) {
            if (this.bootImage) {
                this.storeCustomBlock(BOOT.BOOT_IMAGE_BLOCK_TYPE, this.bootImage, 'boot image');
                this.hadBootImageBlock = true;
            } else if (this.hadBootImageBlock) {
                this.storeCustomBlock(BOOT.BOOT_IMAGE_BLOCK_TYPE, new Uint8Array(BOOT.BOOT_IMAGE_BLOCK_LENGTH).fill(0xFF), 'boot image');
            }
            this.bootImageDirty = false;
        }
        if (this.general.nxdnId !== this.nxdnIdRead) { // no block made for "not set" unless one was there
            const id = this.general.nxdnId;
            this.storeCustomBlock(NXDN_ID_BLOCK_TYPE, new Uint8Array([1, 0, id & 0xFF, (id >> 8) & 0xFF]), 'NXDN ID');
            this.nxdnIdRead = id;
        }
        if (this.settings.languageDirty || this.settings.language !== this.languageRead) {
            const block = new Uint8Array(LANGUAGE_BLOCK_LENGTH);
            block[0] = 1;
            block.set(new TextEncoder().encode(this.settings.language).subarray(0, 7), 4);
            this.storeCustomBlock(LANGUAGE_BLOCK_TYPE, block, 'interface language');
            if (this.findCustomBlock(OLD_LANGUAGE_BLOCK_TYPE)) { // as the radio does: older CPS see the same
                const n = OLD_LANGUAGES.indexOf(this.settings.language);
                this.storeCustomBlock(OLD_LANGUAGE_BLOCK_TYPE, new Uint8Array([1, n < 0 ? 0 : n]), 'interface language');
            }
            this.languageRead = this.settings.language;
            this.settings.languageDirty = false;
        }
        if (this.aprsDirty) { // the APRS configurations: the radio's are written back otherwise
            const byIndex = new Map(this.aprsConfigs.map((c) => [c.index, c]));
            for (let i = 1; i <= APRS_CONFIGS_MAX; i++) {
                const at = L.APRS_CONFIGS + ((i - 1) * APRS_CONFIG_SIZE);
                const c = byIndex.get(i);
                if (c) {
                    img.set(writeAprsConfig(c), at);
                } else {
                    fill(img, at, APRS_CONFIG_SIZE, 0xFF);
                }
            }
            this.customRanges.push([L.APRS_CONFIGS, L.APRS_CONFIGS + (APRS_CONFIGS_MAX * APRS_CONFIG_SIZE)]);
        }
        writeName(img, L.CALLSIGN, 8, this.general.callsign.toUpperCase());
        writeBcdBigEndian(img, L.DMR_ID, this.general.dmrId);

        // channels: the in-use tables, then each channel
        for (let bank = 0; bank < L.CHANNEL_BANKS; bank++) {
            fill(img, L.bankHeader(bank), 16, 0);
        }
        for (const ch of this.channels) {
            const bank = Math.floor((ch.number - 1) / L.CHANNELS_PER_BANK);
            const bit = (ch.number - 1) % L.CHANNELS_PER_BANK;
            img[L.bankHeader(bank) + (bit >> 3)] |= 1 << (bit & 7);
            this.writeChannel(ch);
        }

        this.vfos.forEach((v, i) => this.writeChannel(v, L.VFO_A + (i * L.CHANNEL_SIZE)));

        // zones: packed from the first slot, in the format read (80 channels a zone for a new codeplug)
        const size = 16 + (2 * this.channelsPerZone);
        fill(img, L.ZONES_IN_USE, 32, 0);
        for (let i = 0; i < L.ZONES_MAX; i++) {
            const at = L.ZONES + (i * size);
            const zone = this.zones[i];
            fill(img, at, 16, 0xFF);
            fill(img, at + 16, 2 * this.channelsPerZone, 0);
            if (zone) {
                img[L.ZONES_IN_USE + (i >> 3)] |= 1 << (i & 7);
                writeName(img, at, 16, zone.name);
                zone.channels.slice(0, this.channelsPerZone).forEach((c, j) => setU16(img, at + 16 + (2 * j), c));
            }
        }

        // contacts: free slots as the firmware deletes them (name and call type 0xFF, number 0)
        const byIndex = new Map(this.contacts.map((c) => [c.index, c]));
        for (let i = 1; i <= L.CONTACTS_MAX; i++) {
            const at = L.CONTACTS + ((i - 1) * L.CONTACT_SIZE);
            const c = byIndex.get(i);
            if (!c) {
                if (img[at] !== 0xFF) {
                    fill(img, at, L.CONTACT_SIZE, 0xFF);
                    setU32(img, at + 16, 0);
                }
                continue;
            }
            // a new contact as the OpenGD77 CPS makes it: no receive tone, ring style 0, no timeslot override
            const raw = c.raw ?? Uint8Array.from([...new Array(20).fill(0xFF), 0, 0, 0, 0x01]);
            writeName(raw, 0, 16, c.name);
            writeBcdBigEndian(raw, 16, c.id);
            raw[20] = CALL_TYPES.indexOf(c.callType);
            // ts_override: bit 0 set: none, else bit 1 is the timeslot - 1 (codeplug.h)
            raw[23] = (raw[23] & 0xFC) | ((c.timeslot === 0) ? 0x01 : ((c.timeslot === 2) ? 0x02 : 0));
            img.set(raw, at);
            c.raw = raw;
        }

        // RX group lists
        const groups = new Map(this.rxGroups.map((g) => [g.number, g]));
        for (let i = 1; i <= L.RX_GROUPS_MAX; i++) {
            const at = L.RX_GROUPS + ((i - 1) * L.RX_GROUP_SIZE);
            const g = groups.get(i);
            if (!g) {
                img[L.RX_GROUP_LENGTHS + i - 1] = 0;
                continue;
            }
            const list = g.contacts.slice(0, L.RX_GROUP_CONTACTS);
            img[L.RX_GROUP_LENGTHS + i - 1] = list.length + 1;
            writeName(img, at, 16, g.name);
            fill(img, at + 16, 2 * L.RX_GROUP_CONTACTS, 0);
            list.forEach((c, j) => setU16(img, at + 16 + (2 * j), c));
        }
    }
}
