// Themes (OpenDMR src/graphics/theme.h, theme.c): 16 colours each, by what they are for. The firmware's built-in
// themes (themes.c's order: their ids 0 - 5) can be recoloured or hidden; the user's own (ids 0x40 - 0x47) come after
// them in the radio's menu. All in OpenDMR's custom data block "DT" 7: a header (version 1, the number of entries, 2
// bytes of 0), then entries of 68 bytes: the id, flags (1 dark, 2 hidden, 4 recoloured), 2 bytes of 0, the name (UTF-8,
// 16 bytes, the user's themes), the 16 colours as R, G, B. The block keeps its size: always 14 entries of room.

export const THEME_BLOCK_TYPE = 0x44540007;
const VERSION = 1;
const HEADER = 4;
const ENTRY = 68;
const ENTRIES = 14;
export const THEME_BLOCK_LENGTH = HEADER + (ENTRIES * ENTRY);
export const USER_ID = 0x40;
export const USER_THEMES_MAX = 8;
export const NAME_BYTES = 16;
const DARK = 1;
const HIDDEN = 2;
const RECOLOURED = 4;

// theme.h theme_colour_t, in order: [Chinese, English] names and where the radio uses them
export const ROLES = [
    {key: 'background', name: ['背景', 'Background'], use: ['主区域的底色', 'The main area']},
    {key: 'line', name: ['分隔线', 'Lines'], use: ['主区域的分隔线、进度条的空白部分', 'Separators, the empty part of bars']},
    {key: 'off', name: ['未点亮', 'Unlit'], use: ['S 表没点亮的格子、还没输入的数字', 'Unlit S meter segments, digits not typed yet']},
    {key: 'textDim', name: ['暗文字', 'Dim text'], use: ['双守时另一个信道、没点亮的信号格', 'The other channel in dual watch, unlit signal bars']},
    {key: 'textLabel', name: ['标签', 'Labels'], use: ['区域、标签、单位', 'Zone, labels, units']},
    {key: 'textSecond', name: ['次要文字', 'Second text'], use: ['频率、通话组', 'Frequency, talk group']},
    {key: 'text', name: ['正文', 'Text'], use: ['信道名、重要的数值', 'Channel name, important values']},
    {key: 'accent', name: ['强调色', 'Accent'], use: ['选中的行、模式标签', 'The selected row, the mode chip']},
    {key: 'rx', name: ['接收', 'Receive'], use: ['接收、S 表点亮的格子', 'Receiving, lit S meter segments']},
    {key: 'tx', name: ['发射', 'Transmit'], use: ['发射、S9 以上的格子', 'Transmitting, S meter over S9']},
    {key: 'warning', name: ['警告', 'Warning'], use: ['低电量、扫描中', 'Low battery, scanning']},
    {key: 'white', name: ['色块上的字', 'Text on fills'], use: ['接收、发射、警告色块上的字', 'Text on the receive, transmit and warning colours']},
    {key: 'onAccent', name: ['强调色上的字', 'Text on accent'], use: ['选中行、模式标签上的字', 'Text on the selected row and the mode chip']},
    {key: 'panel', name: ['面板', 'Panel'], use: ['状态栏、列表标题、底栏', 'Status bar, list titles, bottom bar']},
    {key: 'panelText', name: ['面板文字', 'Panel text'], use: ['面板上的字', 'Text on the panel']},
    {key: 'panelLabel', name: ['面板标签', 'Panel labels'], use: ['面板上的标签', 'Labels on the panel']},
];
const R = Object.fromEntries(ROLES.map((r, i) => [r.key, i]));

// Pairs whose contrast the radio needs (WCAG ratio, at least): text on its ground, the S meter. Where the firmware
// picks the text colour by contrast, the best of its choices (status_bar.c on_receive(): white on the receive colour,
// else the background or the text)
export const CHECKS = [
    ['text', 'background', 4.5], ['textSecond', 'background', 4.5], ['textLabel', 'background', 4.5],
    ['textDim', 'background', 3], ['panelText', 'panel', 4.5], ['panelLabel', 'panel', 3],
    ['onAccent', 'accent', 3], [['white', 'background', 'text'], 'rx', 3], ['white', 'tx', 3],
    ['rx', 'background', 3], ['tx', 'background', 3], ['rx', 'off', 2],
].map(([a, b, min]) => ({a: [a].flat().map((k) => R[k]), b: R[b], min}));

// The firmware's built-in themes (src/graphics/themes/*.c): [English, Chinese, Spanish] names
export const BUILTIN = [
    {name: ['Deep sea', '深海', 'Mar profundo'], dark: true,
        colours: [0x07131F, 0x1C3448, 0x24425A, 0x8FB0C9, 0xCFE3F1, 0xF4FAFF, 0xF4FAFF, 0x00B4D8,
            0x9BE15D, 0xFF5D5D, 0xFFC145, 0xFFFFFF, 0x04111C, 0x0E2A44, 0xF4FAFF, 0xC2DEF2]},
    {name: ['Sunlight', '阳光', 'Luz solar'], dark: false,
        colours: [0xFFFFFF, 0x7A8696, 0xDDE2E8, 0x2E3A48, 0x101820, 0x000000, 0x000000, 0xB0420A,
            0x008A3E, 0xE0102E, 0x8A5600, 0xFFFFFF, 0xFFFFFF, 0x0B3D91, 0xFFFFFF, 0xD4E2F8]},
    {name: ['Clear sky', '晴空', 'Cielo claro'], dark: false,
        colours: [0xFFFFFF, 0xA9B4C2, 0xDCE3EA, 0x506072, 0x223244, 0x0A1724, 0x0A1724, 0xD9560F,
            0x009E4A, 0xE0102E, 0xC27B00, 0xFFFFFF, 0xFFFFFF, 0x0B3D91, 0xFFFFFF, 0xD4E2F8]},
    {name: ['Graphite', '石墨橙', 'Grafito'], dark: true,
        colours: [0x121316, 0x2C2F35, 0x3A3E45, 0x9EA3AC, 0xD8DBE0, 0xF6F7F8, 0xF6F7F8, 0xFF7A1A,
            0x2FE0A0, 0xFF3D5A, 0xFFC83D, 0xFFFFFF, 0x161616, 0x1E2025, 0xF6F7F8, 0xFF9A4D]},
    {name: ['Night amber', '夜视琥珀', 'Ambar nocturno'], dark: true,
        colours: [0x050403, 0x2A1E08, 0x3A2A0C, 0xB0802C, 0xE0A940, 0xFFC45C, 0xFFC45C, 0xFFB000,
            0x7CD957, 0xFF5A3C, 0xFF8A00, 0x1A1000, 0x140C00, 0x241803, 0xFFC45C, 0xC08A2C]},
    {name: ['High contrast', '高对比', 'Alto contraste'], dark: false,
        colours: [0xFFFFFF, 0x9A9A9A, 0xC8C8C8, 0x3D3D3D, 0x1A1A1A, 0x000000, 0x000000, 0xFFD400,
            0x008A3E, 0xD00000, 0xB86E00, 0xFFFFFF, 0x000000, 0x000000, 0xFFFFFF, 0xFFD400]},
];

function luminance(rgb) {
    const ch = (v) => {
        const c = v / 255;
        return (c <= 0.03928) ? (c / 12.92) : (((c + 0.055) / 1.055) ** 2.4);
    };
    return (0.2126 * ch((rgb >> 16) & 0xFF)) + (0.7152 * ch((rgb >> 8) & 0xFF)) + (0.0722 * ch(rgb & 0xFF));
}

export function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The pairs of a theme's colours under their minimum: [{a, b, min, ratio}]
export function lowContrast(colours) {
    return CHECKS.map((c) => {
        const ratios = c.a.map((a) => contrast(colours[a], colours[c.b]));
        const best = ratios.indexOf(Math.max(...ratios));
        return {a: c.a[best], b: c.b, min: c.min, ratio: ratios[best]};
    }).filter((c) => c.ratio < c.min);
}

// What the CPS edits: the built-in themes ({hidden, dark, colours: null or the user's 16}) and the user's own
// ({id, name, dark, colours})
export function emptyThemes() {
    return {builtin: BUILTIN.map((b) => ({hidden: false, dark: b.dark, colours: null})), user: []};
}

const utf8 = new TextEncoder();

// A name cut to NAME_BYTES of UTF-8 without splitting a character
export function fitName(name) {
    let out = '';
    for (const ch of name) {
        if (utf8.encode(out + ch).length > NAME_BYTES) {
            break;
        }
        out += ch;
    }
    return out;
}

// The block's bytes (null: none) into the themes
export function readThemes(bytes) {
    const t = emptyThemes();
    if (!bytes || bytes.length < HEADER || bytes[0] !== VERSION) {
        return t;
    }
    for (let i = 0; i < Math.min(bytes[1], ENTRIES) && (HEADER + ((i + 1) * ENTRY)) <= bytes.length; i++) {
        const e = bytes.subarray(HEADER + (i * ENTRY), HEADER + ((i + 1) * ENTRY));
        const id = e[0];
        const flags = e[1];
        const colours = [];
        for (let c = 0; c < 16; c++) {
            colours.push((e[20 + (3 * c)] << 16) | (e[21 + (3 * c)] << 8) | e[22 + (3 * c)]);
        }
        if (id < BUILTIN.length) {
            t.builtin[id] = {hidden: !!(flags & HIDDEN), dark: (flags & RECOLOURED) ? !!(flags & DARK) : BUILTIN[id].dark,
                colours: (flags & RECOLOURED) ? colours : null};
        } else if (id >= USER_ID && id < USER_ID + USER_THEMES_MAX && !t.user.some((u) => u.id === id)) {
            const raw = e.subarray(4, 4 + NAME_BYTES);
            const end = raw.indexOf(0);
            t.user.push({id, name: new TextDecoder().decode(raw.subarray(0, (end < 0) ? NAME_BYTES : end)),
                dark: !!(flags & DARK), colours});
        }
    }
    return t;
}

// Nothing changed from the firmware's: no block needed
export function isDefault(t) {
    return !t.user.length && t.builtin.every((b) => !b.hidden && !b.colours);
}

// The themes into the block's bytes
export function writeThemes(t) {
    const entries = [];
    t.builtin.forEach((b, id) => {
        if (b.hidden || b.colours) {
            entries.push({id, flags: (b.hidden ? HIDDEN : 0) | (b.colours ? RECOLOURED | (b.dark ? DARK : 0) : 0),
                name: '', colours: b.colours ?? BUILTIN[id].colours});
        }
    });
    for (const u of t.user.slice(0, USER_THEMES_MAX)) {
        entries.push({id: u.id, flags: u.dark ? DARK : 0, name: u.name, colours: u.colours});
    }
    const bytes = new Uint8Array(THEME_BLOCK_LENGTH);
    bytes[0] = VERSION;
    bytes[1] = entries.length;
    entries.forEach((e, i) => {
        const at = HEADER + (i * ENTRY);
        bytes[at] = e.id;
        bytes[at + 1] = e.flags;
        bytes.set(utf8.encode(fitName(e.name)), at + 4);
        e.colours.forEach((c, k) => bytes.set([(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF], at + 20 + (3 * k)));
    });
    return bytes;
}

// The colours a built-in theme shows with (its own, or the user's)
export function builtinColours(t, id) {
    return t.builtin[id].colours ?? BUILTIN[id].colours;
}

// A theme as a file to share (#117): JSON, the colours by role (theme.h's order in ROLES), "#RRGGBB"
//   {"format": "opendmr-theme", "version": 1, "name": "Night", "dark": true, "colours": {"background": "#07131F", ...}}
export const THEME_FILE_FORMAT = 'opendmr-theme';

export function themeToJson(name, dark, colours) {
    const hex = (c) => '#' + c.toString(16).padStart(6, '0').toUpperCase();
    return JSON.stringify({format: THEME_FILE_FORMAT, version: 1, name, dark: !!dark,
        colours: Object.fromEntries(ROLES.map((r, i) => [r.key, hex(colours[i])]))}, null, 2) + '\n';
}

// A shared theme's file into {name, dark, colours}; an Error saying what is wrong. The colours by role, or a list of 16
export function themeFromJson(text) {
    let d;
    try {
        d = JSON.parse(text);
    } catch (e) {
        throw new Error('not JSON');
    }
    if (!d || d.format !== THEME_FILE_FORMAT) {
        throw new Error(`not an ${THEME_FILE_FORMAT} file`);
    }
    const list = Array.isArray(d.colours) ? d.colours : ROLES.map((r) => d.colours?.[r.key]);
    const colours = ROLES.map((r, i) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(list[i] ?? '').trim());
        return m ? parseInt(m[1], 16) : null;
    });
    const missing = ROLES.filter((r, i) => colours[i] === null).map((r) => r.key);
    if (missing.length) {
        throw new Error('colours missing or wrong: ' + missing.join(', '));
    }
    return {name: fitName(String(d.name ?? '').trim()), dark: !!d.dark, colours};
}

// The first free id of a user's theme; null: all taken
export function freeUserId(t) {
    for (let id = USER_ID; id < USER_ID + USER_THEMES_MAX; id++) {
        if (!t.user.some((u) => u.id === id)) {
            return id;
        }
    }
    return null;
}
