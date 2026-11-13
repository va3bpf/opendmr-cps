// The codeplug in the radio's data flash window (OpenDMR src/services/codeplug.c, codeplug.h): window addresses.
// The "EEPROM" part is at 0, the "flash" part at FLASH_PART (128 KB), as on the MD-UV380 platform of OpenGD77.

export const FLASH_PART = 0x20000;
export const SECTOR = 4096;

export const CALLSIGN = 0x00E0;          // 8 bytes, 0xFF filled
export const DMR_ID = 0x00E8;            // 4 bytes, BCD, most significant byte first
export const DTMF_CONTACTS = 0x2F88;     // 63 x 32
export const DTMF_DURATIONS = 0x1400 + 0x72;
export const APRS_CONFIGS = 0x1588;      // 8 x 64
export const CHANNEL_BANK0_HEADER = 0x3780; // 16 bytes: channels 1 - 128 in use
export const CHANNEL_BANK0 = 0x3790;
export const VFO_A = 0x7590;             // VFO B follows, 56 bytes each
export const QUICK_KEYS = 0x7524;
export const LAST_USED = 0x6000;         // "LUCZ", the OpenDMR settings at 0x604B (not the CPS's)
export const ZONES_IN_USE = 0x8010;      // 32 bytes, a bit a zone
export const ZONES = 0x8030;
export const ZONE_FORMAT_CHECK = 0x8060; // byte 15: 0 - 4 with 80 channels a zone (a channel number's high byte)
export const CHANNEL_BANKS_HEADER = FLASH_PART + 0x7B1B0; // banks 1 - 7: 16 byte table, then 128 channels
export const CONTACTS = FLASH_PART + 0x87620;
export const RX_GROUP_LENGTHS = FLASH_PART + 0x8D620; // a byte a list, 0: not in use
export const RX_GROUPS = FLASH_PART + 0x8D6A0;
export const CUSTOM_DATA = FLASH_PART;     // "OpenGD77", u32 1, then blocks: type (u32), length (u32), data
export const CUSTOM_DATA_END = FLASH_PART + 0x10000;

export const CHANNEL_SIZE = 56;
export const CHANNELS_PER_BANK = 128;
export const CHANNEL_BANKS = 8;
export const CHANNELS_MAX = 1024;
export const BANK_SIZE = 16 + (CHANNELS_PER_BANK * CHANNEL_SIZE);
export const ZONES_MAX = 68;
export const ZONE_CHANNELS = 80;
export const CONTACT_SIZE = 24;
export const CONTACTS_MAX = 1024;
export const RX_GROUP_SIZE = 80;
export const RX_GROUPS_MAX = 76;
export const RX_GROUP_CONTACTS = 32;
export const NAME_LENGTH = 16;

// What is read from the radio (window addresses, end exclusive, whole sectors): the EEPROM part to the end of the
// zones, and the flash part from the channel banks to the end of the RX group lists
export const REGIONS = [
    {start: 0x0000, end: 0xB000},
    {start: 0x20000, end: 0x30000}, // the custom data blocks (satellites, the radio's key map, tones...)
    {start: 0x9B000, end: 0xAF000},
];

export const IMAGE_SIZE = Math.max(...REGIONS.map((r) => r.end));

// What this editor owns and writes: the rest of the regions (the radio's settings at 0x604B, the VFOs, the quick keys,
// DTMF, APRS...) is written back as the radio has it
export function ownedRanges(channelsPerZone) {
    return [
        [CALLSIGN, DMR_ID + 4],
        [VFO_A, VFO_A + (2 * CHANNEL_SIZE)],
        [CHANNEL_BANK0_HEADER, CHANNEL_BANK0 + (CHANNELS_PER_BANK * CHANNEL_SIZE)],
        [ZONES_IN_USE, ZONES_IN_USE + 32],
        [ZONES, ZONES + (ZONES_MAX * (16 + (2 * channelsPerZone)))],
        [CHANNEL_BANKS_HEADER, RX_GROUPS + (RX_GROUPS_MAX * RX_GROUP_SIZE)],
    ];
}

// The CPS's calibration sector: the radio ignores writes there (cable_link.c CPS_CALIBRATION)
export const IGNORED_SECTORS = [0x10000 / SECTOR];

export function bankHeader(bank) {
    return (bank === 0) ? CHANNEL_BANK0_HEADER : CHANNEL_BANKS_HEADER + ((bank - 1) * BANK_SIZE);
}

export function channelAddress(number) {
    const index = number - 1;
    if (index < CHANNELS_PER_BANK) {
        return CHANNEL_BANK0 + (index * CHANNEL_SIZE);
    }
    const flashIndex = index - CHANNELS_PER_BANK;
    return CHANNEL_BANKS_HEADER + 16 + (16 * Math.floor(flashIndex / CHANNELS_PER_BANK)) + (flashIndex * CHANNEL_SIZE);
}
