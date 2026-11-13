// The radio's own settings (OpenDMR src/services/settings.h settings_t, 108 bytes at window 0x604B), as its menus
// edit them (app/general_options.c, radio_options.c, menus.c, sound_options.c, aprs_options.c). The radio takes them
// only with the magic number right, and resets any field out of its range (settings.c check_ranges): every field is
// read, changed in its bits only, and written back.

export const SETTINGS = 0x604B;
export const SETTINGS_SIZE = 108;
const MAGIC = 0x477B;

const ONOFF = [[0, 'Off', '关'], [1, 'On', '开']];
const TONES = [[0, 'Off', '关'], [1, 'Beep', '单音'], [2, 'Double', '双音'], [3, 'Rising', '上升'], [4, 'Falling', '下降'],
    [5, 'Morse K', '摩尔斯K']];

const tenths = (v) => `${Math.floor(v / 10)}.${v % 10}s`;
const db3 = (v) => `${(2 - v) * 3}dB`;

// An item: o offset, s size (1, 2, 4), b [shift, mask] in that field, signed; c choices [value, en, zh], or a number
// n [min, max] with f(value) -> its label; inv: a bool shown the other way round; when(s): applies
export const GROUPS = [
    {key: 'general', en: 'General', zh: '通用', items: [
        {id: 'keyLong', en: 'Key long', zh: '长按', o: 103, s: 1, n: [1, 90], f: tenths},
        {id: 'keyRepeat', en: 'Key repeat', zh: '连按', o: 104, s: 1, n: [1, 90], f: tenths},
        {id: 'autoLock', en: 'Auto lock', zh: '自动锁键', o: 105, s: 1, n: [0, 30],
            f: (v) => (v === 0 ? ['Off', '关'] : `${v >> 1}${v & 1 ? '.5' : ''}min`)},
        {id: 'hotspot', en: 'Hotspot', zh: '热点', o: 83, s: 1, c: [[0, 'Off', '关'], [1, 'MMDVM', 'MMDVM'], [2, 'BlueDV', 'BlueDV']]},
        {id: 'battCal', en: 'Batt. Cal', zh: '电池校准', o: 97, s: 1, b: [0, 15], n: [0, 10],
            f: (v) => `${v > 5 ? '+' : v < 5 ? '-' : ''}${(Math.abs(v - 5) / 10).toFixed(1)}V`},
        {id: 'eco', en: 'Eco level', zh: '省电级别', o: 101, s: 1, n: [0, 5], f: (v) => String(v)},
        {id: 'safePowerOn', en: 'Safe power-on', zh: '安全开机', o: 36, s: 4, b: [14, 1], c: ONOFF},
        {id: 'apo', en: 'Auto power-off', zh: '自动关机', o: 102, s: 1,
            c: [[0, 'No', '否'], [1, '30 min', '30 分钟'], [2, '60 min', '60 分钟'], [3, '90 min', '90 分钟'],
                [4, '120 min', '120 分钟'], [6, '180 min', '180 分钟']]},
        {id: 'apoRf', en: 'APO with RF', zh: '关机含射频', o: 36, s: 4, b: [13, 1], c: [[0, 'No', '否'], [1, 'Yes', '是']],
            when: (g) => g('apo') !== 0},
        {id: 'satellite', en: 'Satellite', zh: '卫星', o: 36, s: 4, b: [9, 1], c: [[0, 'Manual', '手动'], [1, 'Auto', '自动']]},
        {id: 'gps', en: 'GPS', zh: 'GPS', o: 106, s: 1, c: [[0, 'Not detected', '未检测到'], [1, 'Off', '关'], [2, 'On', '开'], [3, 'NMEA', 'NMEA']]},
        {id: 'language', en: 'Language', zh: '语言', o: 36, s: 4, b: [19, 1], c: [[0, 'English', 'English'], [1, '中文', '中文']]},
    ]},
    {key: 'radio', en: 'Radio', zh: '电台', items: [
        {id: 'bandLimits', en: 'Band limits', zh: '频段限制', o: 79, s: 1, c: [[0, 'Off', '关'], [1, 'On', '开'], [2, 'CPS', 'CPS']]},
        {id: 'filterTime', en: 'Filter time', zh: '过滤时间', o: 87, s: 1, n: [2, 90], f: (v) => `${v}s`},
        {id: 'scanDelay', en: 'Scan delay', zh: '扫描延时', o: 81, s: 1, n: [1, 30], f: (v) => `${v}s`},
        {id: 'scanDwell', en: 'Scan dwell', zh: '扫描驻留', o: 84, s: 1, n: [0, 15], f: (v) => `${30 + (v * 30)}ms`},
        {id: 'scanMode', en: 'Scan mode', zh: '扫描方式', o: 80, s: 1, c: [[0, 'Hold', '保持'], [1, 'Pause', '暂停'], [2, 'Stop', '停止']]},
        {id: 'scanOnBoot', en: 'Scan on boot', zh: '开机扫描', o: 36, s: 4, b: [7, 1], c: ONOFF},
        {id: 'bootScreen', en: 'Boot screen', zh: '开机画面', o: 36, s: 4, b: [2, 1], c: ONOFF},
        {id: 'sqlVhf', en: 'VHF squelch', zh: 'VHF静噪', o: 98, s: 1, n: [1, 21], f: (v) => `${(v - 1) * 5}%`},
        {id: 'sql220', en: '220 squelch', zh: '220静噪', o: 99, s: 1, n: [1, 21], f: (v) => `${(v - 1) * 5}%`},
        {id: 'sqlUhf', en: 'UHF squelch', zh: 'UHF静噪', o: 100, s: 1, n: [1, 21], f: (v) => `${(v - 1) * 5}%`},
        {id: 'pttLatch', en: 'PTT latch', zh: 'PTT锁定', o: 36, s: 4, b: [1, 1], c: ONOFF},
        {id: 'privateCalls', en: 'Allow private calls', zh: '允许个呼', o: 90, s: 1, c: [[0, 'Off', '关'], [1, 'On', '开'], [2, 'PTT', 'PTT']]},
        {id: 'txPower', en: 'Default power', zh: '默认功率', o: 66, s: 1, // the channels and VFOs set to Radio
            c: ['50mW', '500mW', '1W', '2W', '3W', '4W', '5W', '7W', '10W', '+W-'].map((p, i) => [i, p, p])},
        {id: 'userPower', en: 'User power', zh: '自定功率', o: 56, s: 2, n: [0, 4100], input: true},
        {id: 'dmrCrc', en: 'DMR CRC', zh: 'DMR校验', o: 36, s: 4, b: [12, 1], c: ONOFF, inv: true},
    ]},
    {key: 'display', en: 'Display', zh: '显示', items: [
        {id: 'brightDay', en: 'Brightness', zh: '亮度', o: 74, s: 1, signed: true, n: [1, 100], f: (v) => `${v}%`, pct: true},
        {id: 'brightNight', en: 'Night brightness', zh: '夜间亮度', o: 75, s: 1, signed: true, n: [1, 100], f: (v) => `${v}%`, pct: true},
        {id: 'brightOff', en: 'Min brightness', zh: '最低亮度', o: 76, s: 1, signed: true, n: [0, 100], f: (v) => `${v}%`, pct: true},
        {id: 'backlightMode', en: 'Backlight mode', zh: '背光模式', o: 71, s: 1,
            c: [[0, 'Auto', '自动'], [1, 'Squelch', '静噪'], [2, 'Manual', '手动'], [3, 'Buttons', '按键']]},
        {id: 'backlightTimeout', en: 'Backlight timeout', zh: '背光时间', o: 72, s: 1,
            c: [0, 5, 10, 15, 20, 25, 30].map((v) => [v, v ? `${v}s` : 'Off', v ? `${v}s` : '关'])},
        {id: 'autoNight', en: 'Auto night', zh: '自动夜间', o: 36, s: 4, b: [15, 1], c: ONOFF},
        {id: 'leds', en: 'LEDs', zh: '指示灯', o: 36, s: 4, b: [6, 1], c: ONOFF, inv: true},
        {id: 'timezone', en: 'Timezone', zh: '时区', o: 12, s: 1, b: [0, 127],
            c: Array.from({length: 105}, (_, i) => {
                const q = i - 48;
                const label = `${q < 0 ? '-' : '+'}${Math.floor(Math.abs(q) / 4)}:${String((Math.abs(q) % 4) * 15).padStart(2, '0')}`;
                return [64 + q, label, label];
            })},
        {id: 'time', en: 'Time shown', zh: '时间显示', o: 12, s: 1, b: [7, 1], c: [[0, 'UTC', 'UTC'], [1, 'Local', '本地']]},
    ]},
    {key: 'sound', en: 'Sound', zh: '声音', items: [
        {id: 'prompt', en: 'Prompt', zh: '提示', o: 95, s: 1, c: [[0, 'Silent', '静音'], [1, 'Beep', '提示音'], [2, 'No keys', '无按键音']]},
        {id: 'timeoutBeep', en: 'Timeout beep', zh: '超时提示', o: 67, s: 1, n: [0, 4],
            f: (v) => (v ? `${v * 5}s` : ['N/A', '无']), when: (g) => g('prompt') !== 0},
        {id: 'beepVolume', en: 'Beep volume', zh: '提示音量', o: 68, s: 1, n: [0, 10], f: db3, when: (g) => g('prompt') !== 0},
        {id: 'dmrBeep', en: 'DMR beep', zh: 'DMR提示音', o: 13, s: 1, b: [0, 3],
            c: [[0, 'None', '无'], [1, 'Start', '开始'], [2, 'Stop', '停止'], [3, 'Both', '两者']], when: (g) => g('prompt') !== 0},
        {id: 'rxBeep', en: 'Rx beep', zh: '接收提示音', o: 13, s: 1, b: [2, 3],
            c: [[0, 'None', '无'], [1, 'Carrier', '载波'], [2, 'Talker', '呼叫'], [3, 'Both', '两者']], when: (g) => g('prompt') !== 0},
        {id: 'talkerBeep', en: 'Talker beep', zh: '呼叫提示音', o: 13, s: 1, b: [4, 1],
            c: [[0, 'End only', '仅结束'], [1, 'Both', '两者']], when: (g) => (g('prompt') !== 0) && ((g('rxBeep') & 2) !== 0)},
        {id: 'micDmr', en: 'DMR mic', zh: 'DMR话筒', o: 69, s: 1, n: [0, 20], f: (v) => `${v}dB`},
        {id: 'micFm', en: 'FM mic', zh: 'FM话筒', o: 70, s: 1, n: [0, 31], f: (v) => String(v)},
        {id: 'voxThreshold', en: 'VOX threshold', zh: '声控门限', o: 93, s: 1, n: [0, 13], f: (v) => (v ? String(v) : ['Off', '关'])},
        {id: 'voxTail', en: 'VOX tail', zh: '声控拖尾', o: 94, s: 1, n: [1, 10], f: (v) => `${(v / 2).toFixed(1)}s`,
            when: (g) => g('voxThreshold') !== 0},
        {id: 'dmrRxAgc', en: 'DMR Rx AGC', zh: 'DMR接收AGC', o: 82, s: 1, n: [0, 8], f: (v) => (v ? `${(v - 1) * 3}dB` : ['Off', '关'])},
    ]},
    {key: 'aprs', en: 'APRS', zh: 'APRS', items: [
        {id: 'aprsMode', en: 'Mode', zh: '模式', o: 40, s: 4, b: [29, 7],
            c: [[0, 'Off', '关'], [1, 'Manual', '手动'], [2, 'PTT', 'PTT'], [3, 'Auto', '自动'], [4, 'Smart', '智能']]},
        {id: 'aprsLocation', en: 'Location', zh: '位置', o: 64, s: 2, b: [5, 3], c: [[1, 'Channel', '信道'], [2, 'GPS', 'GPS']],
            read: (v) => ((v & 2) ? 2 : 1)},
        {id: 'aprsInterval', en: 'Interval', zh: '间隔', o: 64, s: 2, b: [0, 15],
            c: ['0.2', '0.5', '1', '2', '3', '5', '10', '20', '30', '60'].map((m, i) => [i, `${m} min`, `${m} 分钟`])},
        {id: 'aprsDecay', en: 'Decay', zh: '衰减', o: 64, s: 2, b: [7, 1], c: ONOFF},
        {id: 'aprsCompress', en: 'Compress', zh: '压缩', o: 64, s: 2, b: [8, 1], c: ONOFF},
        {id: 'aprsSlow', en: 'Slow rate', zh: '慢速率', o: 44, s: 4, b: [14, 127], n: [1, 100], f: (v) => `${v}min`, input: true},
        {id: 'aprsFast', en: 'Fast rate', zh: '快速率', o: 40, s: 4, b: [16, 255], n: [10, 180], f: (v) => `${v}s`, input: true},
        {id: 'aprsLowSpeed', en: 'Low speed', zh: '低速', o: 40, s: 4, b: [24, 31], n: [2, 30], f: (v) => `${v}km/h`},
        {id: 'aprsHighSpeed', en: 'High speed', zh: '高速', o: 44, s: 4, b: [7, 127], n: [2, 90], f: (v) => `${v}km/h`, input: true},
        {id: 'aprsTurnAngle', en: 'Turn angle', zh: '转弯角度', o: 44, s: 4, b: [0, 127], n: [5, 90], f: (v) => `${v}°`, input: true},
        {id: 'aprsTurnSlope', en: 'Turn slope', zh: '转弯斜率', o: 40, s: 4, b: [8, 255], n: [1, 255], f: (v) => `${v * 10}°/v`, input: true},
        {id: 'aprsTurnTime', en: 'Turn time', zh: '转弯时间', o: 40, s: 4, b: [0, 255], n: [5, 180], f: (v) => `${v}s`, input: true},
    ]},
];

const BY_ID = new Map(GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]));

export class RadioSettings {
    constructor(img) {
        this.img = img;
        this.dirty = false;
    }

    get valid() {
        const b = this.img;
        return ((b[SETTINGS] | (b[SETTINGS + 1] << 8) | (b[SETTINGS + 2] << 16) | (b[SETTINGS + 3] << 24)) >>> 0) === MAGIC;
    }

    field(item) {
        const at = SETTINGS + item.o;
        let v = 0;
        for (let i = item.s - 1; i >= 0; i--) {
            v = (v * 256) + this.img[at + i];
        }
        return v;
    }

    setField(item, v) {
        const at = SETTINGS + item.o;
        for (let i = 0; i < item.s; i++) {
            this.img[at + i] = v % 256;
            v = Math.floor(v / 256);
        }
    }

    get(id) {
        const item = BY_ID.get(id);
        let v = this.field(item);
        if (item.b) {
            v = Math.floor(v / (2 ** item.b[0])) & item.b[1];
        } else if (item.signed && v >= 0x80) {
            v -= 0x100;
        }
        return item.read ? item.read(v) : v;
    }

    set(id, value) {
        const item = BY_ID.get(id);
        let v = Number(value);
        if (item.b) {
            const [shift, mask] = item.b;
            const word = this.field(item);
            const unit = 2 ** shift;
            v = (word - ((Math.floor(word / unit) & mask) * unit)) + ((v & mask) * unit);
        } else if (item.signed && v < 0) {
            v += 0x100;
        }
        this.setField(item, v);
        // the minimum brightness stays below both others (menus.c)
        if (['brightDay', 'brightNight'].includes(id)) {
            const lowest = Math.min(this.get('brightDay'), this.get('brightNight'));
            if (this.get('brightOff') >= lowest) {
                this.setField(BY_ID.get('brightOff'), Math.max(0, lowest - 1));
            }
        }
        this.dirty = true;
    }

    applies(item) {
        return !item.when || item.when((id) => this.get(id));
    }
}
