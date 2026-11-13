// The codeplug: the image of the radio's data flash window (layout.js) and the records parsed from it. Records keep
// the bytes they were read from; store() writes back only the fields this editor knows, so whatever else the firmware
// or the OpenGD77 CPS keeps in them is left as it was.

import * as L from './layout.js';
import {u16, setU16, u32, setU32, fromBcd, toBcd, readBcdBigEndian, writeBcdBigEndian, fill} from './bytes.js';
import * as gb from '../gb2312.js';
import {RadioSettings} from './settings.js';
import * as SAT from './satellites.js';

export const MODES = ['FM', 'DMR', 'P25', 'AM', 'USB', 'LSB'];
const OPENDMR_MODE_TAG = 0xA0;       // codeplug.c: byte 37, 0xA1 AM, 0xA2 USB, 0xA3 LSB; 0xA4 P25 (with byte 24 digital)
const OPENDMR_MODE_P25 = 0xA4;
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

// Radio bands (codeplug.c bands[]), Hz
export const BANDS = [[137000000, 180000000], [200000000, 279975000], [280000000, 520000000]];

export function frequencyValid(hz) {
    return BANDS.some(([lo, hi]) => (hz >= lo) && (hz <= hi));
}

// Channel flags (OpenDMR app/channel_details.c)
const FLAG1_OPTIONAL_DMR_ID = 0x80; // libre_dmr_flag1 (byte 38)
const FLAG1_NO_BEEP = 0x40;
const FLAG1_NO_ECO = 0x20;
const FLAG1_FORCE_DMO = 0x04;
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
        this.customRanges = []; // the custom data bytes store() changed
        this.channelsPerZone = (img[L.ZONE_FORMAT_CHECK + 15] <= 0x04) ? 80 : 16;
        this.general = {
            callsign: readName(img, L.CALLSIGN, 8),
            dmrId: readBcdBigEndian(img, L.DMR_ID) || 0,
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
            mode = (raw[37] === OPENDMR_MODE_P25) ? 'P25' : 'DMR';
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
            colourCode: (mode === 'P25') ? 1 : (raw[44] & 0x0F),
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
            raw,
        };
    }

    writeChannel(ch, at = L.channelAddress(ch.number)) {
        const raw = ch.raw ?? Codeplug.newChannelBytes();
        writeName(raw, 0, 16, ch.name);
        setU32(raw, 16, toBcd(Math.round(ch.rx / 10)));
        setU32(raw, 20, toBcd(Math.round(ch.tx / 10)));
        raw[24] = (ch.mode === 'DMR' || ch.mode === 'P25') ? 1 : 0;
        raw[37] = (ch.mode === 'P25') ? OPENDMR_MODE_P25 :
            (ANALOG_MODE_INDEX[ch.mode] ? (OPENDMR_MODE_TAG | ANALOG_MODE_INDEX[ch.mode]) : 0);
        setU16(raw, 32, toneToCodeplug(ch.rxTone));
        setU16(raw, 34, toneToCodeplug(ch.txTone));
        raw[25] = ch.power;
        raw[27] = Math.min(255, Math.round(ch.tot / 15));
        if (ch.mode === 'P25') {
            raw[44] = ch.nac & 0xFF;
            raw[42] = 0xA0 | ((ch.nac >> 8) & 0x0F);
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
        raw[38] = (raw[38] & ~(FLAG1_NO_BEEP | FLAG1_NO_ECO | FLAG1_FORCE_DMO | FLAG1_OPTIONAL_DMR_ID)) |
            (ch.beep ? 0 : FLAG1_NO_BEEP) | (ch.eco ? 0 : FLAG1_NO_ECO) | (ch.forceDmo ? FLAG1_FORCE_DMO : 0) |
            (ch.dmrId ? FLAG1_OPTIONAL_DMR_ID : 0);
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
            power: 0, tot: 0, colourCode: 1, nac: P25_NAC_DEFAULT, timeslot: 1, contact: 0, rxGroup: 0, aprs: 0, wide: true,
            rxOnly: false, zoneSkip: false, allSkip: false, vox: false, squelch: 0, beep: true, eco: true,
            forceDmo: false, dmrId: 0, step: 12500, raw: null,
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

    storeSatellites() {
        const img = this.img;
        if (new TextDecoder().decode(img.subarray(L.CUSTOM_DATA, L.CUSTOM_DATA + 8)) !== 'OpenGD77') {
            // no codeplug written yet: the header, and the blocks from an empty area
            img.set(new TextEncoder().encode('OpenGD77'), L.CUSTOM_DATA);
            setU32(img, L.CUSTOM_DATA + 8, 1);
            fill(img, L.CUSTOM_DATA + 12, 8, 0xFF);
            this.customRanges.push([L.CUSTOM_DATA, L.CUSTOM_DATA + 12]);
        }
        let block = this.findCustomBlock(SAT.BLOCK_TYPE) ?? this.findCustomBlock(0xFFFFFFFF);
        if (!block) {
            throw new Error('no room for the satellites in the custom data');
        }
        if (block.length !== SAT.BLOCK_LENGTH) { // a new block in the first free place
            if (block.data + SAT.BLOCK_LENGTH >= L.CUSTOM_DATA_END) {
                throw new Error('no room for the satellites in the custom data');
            }
            setU32(img, block.at, SAT.BLOCK_TYPE);
            setU32(img, block.at + 4, SAT.BLOCK_LENGTH);
        }
        img.set(SAT.buildBlock(this.satellites), block.data);
        this.customRanges.push([block.at, block.data + SAT.BLOCK_LENGTH]);
    }

    // The records back into the image
    store() {
        const img = this.img;
        this.customRanges = [];
        if (this.satellitesDirty) {
            this.storeSatellites();
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
