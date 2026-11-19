// The radio's own settings (OpenDMR src/services/settings.h settings_t, 108 bytes at window 0x604B), as its menus
// edit them (app/general_options.c, radio_options.c, menus.c, sound_options.c, aprs_options.c). The radio takes them
// only with the magic number right, and resets any field out of its range (settings.c check_ranges): every field is
// read, changed in its bits only, and written back.

export const SETTINGS = 0x604B;
export const SETTINGS_SIZE = 108;
const MAGIC = 0x477B;

const ONOFF = [[0, 'Off', '关', 'Desactivado'], [1, 'On', '开', 'Activado']];
const TONES = [[0, 'Off', '关', 'Desactivado'], [1, 'Beep', '单音', 'Pitido'], [2, 'Double', '双音', 'Doble'], [3, 'Rising', '上升', 'Ascendente'], [4, 'Falling', '下降', 'Descendente'],
    [5, 'Morse K', '摩尔斯K', 'Morse K']];

const tenths = (v) => `${Math.floor(v / 10)}.${v % 10}s`;
const db3 = (v) => `${(2 - v) * 3}dB`;

// An item: o offset, s size (1, 2, 4), b [shift, mask] in that field, signed; c choices [value, en, zh, es], or a number
// n [min, max] with f(value) -> its label; inv: a bool shown the other way round; when(s): applies
export const GROUPS = [
    {key: 'general', en: 'General', zh: '通用', es: 'General', items: [
        {id: 'keyLong', en: 'Key long', zh: '长按', es: 'Pulsación larga', o: 103, s: 1, n: [1, 90], f: tenths},
        {id: 'keyRepeat', en: 'Key repeat', zh: '连按', es: 'Repetición tecla', o: 104, s: 1, n: [1, 90], f: tenths},
        {id: 'autoLock', en: 'Auto lock', zh: '自动锁键', es: 'Bloqueo automático', o: 105, s: 1, n: [0, 30],
            f: (v) => (v === 0 ? ['Off', '关', 'Desactivado'] : `${v >> 1}${v & 1 ? '.5' : ''}min`)},
        {id: 'hotspot', en: 'Hotspot', zh: '热点', es: 'Hotspot', o: 83, s: 1, c: [[0, 'Off', '关', 'Desactivado'], [1, 'MMDVM', 'MMDVM', 'MMDVM'], [2, 'BlueDV', 'BlueDV', 'BlueDV']]},
        {id: 'battCal', en: 'Batt. Cal', zh: '电池校准', es: 'Calib. batería', o: 97, s: 1, b: [0, 15], n: [0, 10],
            f: (v) => `${v > 5 ? '+' : v < 5 ? '-' : ''}${(Math.abs(v - 5) / 10).toFixed(1)}V`},
        {id: 'eco', en: 'Eco level', zh: '省电级别', es: 'Nivel de ahorro', o: 101, s: 1, n: [0, 5], f: (v) => String(v)},
        {id: 'safePowerOn', en: 'Safe power-on', zh: '安全开机', es: 'Encendido seguro', o: 36, s: 4, b: [14, 1], c: ONOFF},
        {id: 'apo', en: 'Auto power-off', zh: '自动关机', es: 'Auto apagado', o: 102, s: 1,
            c: [[0, 'No', '否', 'No'], [1, '30 min', '30 分钟', '30 min'], [2, '60 min', '60 分钟', '60 min'], [3, '90 min', '90 分钟', '90 min'],
                [4, '120 min', '120 分钟', '120 min'], [6, '180 min', '180 分钟', '180 min']]},
        {id: 'apoRf', en: 'APO with RF', zh: '关机含射频', es: 'Apagado con RF', o: 36, s: 4, b: [13, 1], c: [[0, 'No', '否', 'No'], [1, 'Yes', '是', 'Sí']],
            when: (g) => g('apo') !== 0},
        {id: 'satellite', en: 'Satellite', zh: '卫星', es: 'Satélite', o: 36, s: 4, b: [9, 1], c: [[0, 'Manual', '手动', 'Manual'], [1, 'Auto', '自动', 'Automático']]},
        {id: 'gps', en: 'GPS', zh: 'GPS', es: 'GPS', o: 106, s: 1, c: [[0, 'Not detected', '未检测到', 'No detectado'], [1, 'Off', '关', 'Desactivado'], [2, 'On', '开', 'Activado'], [3, 'NMEA', 'NMEA', 'NMEA']]},
        {id: 'language', en: 'Language', zh: '语言', es: 'Idioma', o: 36, s: 4, b: [19, 1], c: [
            [0, 'English', 'English', 'English'], [1, '中文', '中文', '中文'], [2, 'Español', '西班牙语', 'Español'],
        ]},
    ]},
    {key: 'radio', en: 'Radio', zh: '电台', es: 'Radio', items: [
        {id: 'bandLimits', en: 'Band limits', zh: '频段限制', es: 'Límites de banda', o: 79, s: 1, c: [[0, 'Off', '关', 'Desactivado'], [1, 'On', '开', 'Activado'], [2, 'CPS', 'CPS', 'CPS']]},
        {id: 'filterTime', en: 'Filter time', zh: '过滤时间', es: 'Tiempo de filtro', o: 87, s: 1, n: [2, 90], f: (v) => `${v}s`},
        {id: 'scanDelay', en: 'Scan delay', zh: '扫描延时', es: 'Retardo de escaneo', o: 81, s: 1, n: [1, 30], f: (v) => `${v}s`},
        {id: 'scanDwell', en: 'Scan dwell', zh: '扫描驻留', es: 'Pausa de escaneo', o: 84, s: 1, n: [0, 15], f: (v) => `${30 + (v * 30)}ms`},
        {id: 'scanMode', en: 'Scan mode', zh: '扫描方式', es: 'Modo de escaneo', o: 80, s: 1, c: [[0, 'Hold', '保持', 'Mantener'], [1, 'Pause', '暂停', 'Pausar'], [2, 'Stop', '停止', 'Detener']]},
        {id: 'scanOnBoot', en: 'Scan on boot', zh: '开机扫描', es: 'Scan al inicio', o: 36, s: 4, b: [7, 1], c: ONOFF},
        {id: 'bootScreen', en: 'Boot screen', zh: '开机画面', es: 'Pantalla de inicio', o: 36, s: 4, b: [2, 1], c: ONOFF},
        {id: 'sqlVhf', en: 'VHF squelch', zh: 'VHF静噪', es: 'Squelch VHF', o: 98, s: 1, n: [1, 21], f: (v) => `${(v - 1) * 5}%`},
        {id: 'sql220', en: '220 squelch', zh: '220静噪', es: 'Squelch 220', o: 99, s: 1, n: [1, 21], f: (v) => `${(v - 1) * 5}%`},
        {id: 'sqlUhf', en: 'UHF squelch', zh: 'UHF静噪', es: 'Squelch UHF', o: 100, s: 1, n: [1, 21], f: (v) => `${(v - 1) * 5}%`},
        {id: 'pttLatch', en: 'PTT latch', zh: 'PTT锁定', es: 'Bloqueo PTT', o: 36, s: 4, b: [1, 1], c: ONOFF},
        {id: 'privateCalls', en: 'Allow private calls', zh: '允许个呼', es: 'Permitir llamadas privadas', o: 90, s: 1, c: [[0, 'Off', '关', 'Desactivado'], [1, 'On', '开', 'Activado'], [2, 'PTT', 'PTT', 'PTT']]},
        {id: 'txPower', en: 'Default power', zh: '默认功率', es: 'Potencia predeterminada', o: 66, s: 1, // the channels and VFOs set to Radio
            c: ['50mW', '500mW', '1W', '2W', '3W', '4W', '5W', '7W', '10W', '+W-'].map((p, i) => [i, p, p, p])},
        {id: 'userPower', en: 'User power', zh: '自定功率', es: 'Potencia personalizada', o: 56, s: 2, n: [0, 4100], input: true},
        {id: 'dmrCrc', en: 'DMR CRC', zh: 'DMR校验', es: 'CRC DMR', o: 36, s: 4, b: [12, 1], c: ONOFF, inv: true},
    ]},
    {key: 'display', en: 'Display', zh: '显示', es: 'Pantalla', items: [
        {id: 'brightDay', en: 'Brightness', zh: '亮度', es: 'Brillo', o: 74, s: 1, signed: true, n: [1, 100], f: (v) => `${v}%`, pct: true},
        {id: 'brightNight', en: 'Night brightness', zh: '夜间亮度', es: 'Brillo nocturno', o: 75, s: 1, signed: true, n: [1, 100], f: (v) => `${v}%`, pct: true},
        {id: 'brightOff', en: 'Min brightness', zh: '最低亮度', es: 'Brillo mínimo', o: 76, s: 1, signed: true, n: [0, 100], f: (v) => `${v}%`, pct: true},
        {id: 'backlightMode', en: 'Backlight mode', zh: '背光模式', es: 'Modo retroiluminación', o: 71, s: 1,
            c: [[0, 'Auto', '自动', 'Automático'], [1, 'Squelch', '静噪', 'Squelch'], [2, 'Manual', '手动', 'Manual'], [3, 'Buttons', '按键', 'Botones']]},
        {id: 'backlightTimeout', en: 'Backlight timeout', zh: '背光时间', es: 'Tiempo retroiluminación', o: 72, s: 1,
            c: [0, 5, 10, 15, 20, 25, 30].map((v) => [v, v ? `${v}s` : 'Off', v ? `${v}s` : '关', v ? `${v}s` : 'Desactivado'])},
        {id: 'autoNight', en: 'Auto night', zh: '自动夜间', es: 'Modo nocturno auto', o: 36, s: 4, b: [15, 1], c: ONOFF},
        {id: 'leds', en: 'LEDs', zh: '指示灯', es: 'LEDs', o: 36, s: 4, b: [6, 1], c: ONOFF, inv: true},
        {id: 'timezone', en: 'Timezone', zh: '时区', es: 'Zona horaria', o: 12, s: 1, b: [0, 127],
            c: Array.from({length: 105}, (_, i) => {
                const q = i - 48;
                const label = `${q < 0 ? '-' : '+'}${Math.floor(Math.abs(q) / 4)}:${String((Math.abs(q) % 4) * 15).padStart(2, '0')}`;
                return [64 + q, label, label, label];
            })},
        {id: 'time', en: 'Time shown', zh: '时间显示', es: 'Hora mostrada', o: 12, s: 1, b: [7, 1], c: [[0, 'UTC', 'UTC', 'UTC'], [1, 'Local', '本地', 'Local']]},
    ]},
    {key: 'sound', en: 'Sound', zh: '声音', es: 'Sonido', items: [
        {id: 'prompt', en: 'Prompt', zh: '提示', es: 'Avisos', o: 95, s: 1, c: [[0, 'Silent', '静音', 'Silencio'], [1, 'Beep', '提示音', 'Pitido'], [2, 'No keys', '无按键音', 'Sin teclas']]},
        {id: 'timeoutBeep', en: 'Timeout beep', zh: '超时提示', es: 'Aviso de fin de tiempo', o: 67, s: 1, n: [0, 4],
            f: (v) => (v ? `${v * 5}s` : ['N/A', '无', 'N/D']), when: (g) => g('prompt') !== 0},
        {id: 'beepVolume', en: 'Beep volume', zh: '提示音量', es: 'Volumen de avisos', o: 68, s: 1, n: [0, 10], f: db3, when: (g) => g('prompt') !== 0},
        {id: 'dmrBeep', en: 'DMR beep', zh: 'DMR提示音', es: 'Aviso DMR', o: 13, s: 1, b: [0, 3],
            c: [[0, 'None', '无', 'Ninguno'], [1, 'Start', '开始', 'Inicio'], [2, 'Stop', '停止', 'Fin'], [3, 'Both', '两者', 'Ambos']], when: (g) => g('prompt') !== 0},
        {id: 'rxBeep', en: 'Rx beep', zh: '接收提示音', es: 'Aviso Rx', o: 13, s: 1, b: [2, 3],
            c: [[0, 'None', '无', 'Ninguno'], [1, 'Carrier', '载波', 'Portadora'], [2, 'Talker', '呼叫', 'Llamante'], [3, 'Both', '两者', 'Ambos']], when: (g) => g('prompt') !== 0},
        {id: 'talkerBeep', en: 'Talker beep', zh: '呼叫提示音', es: 'Aviso de llamante', o: 13, s: 1, b: [4, 1],
            c: [[0, 'End only', '仅结束', 'Solo fin'], [1, 'Both', '两者', 'Ambos']], when: (g) => (g('prompt') !== 0) && ((g('rxBeep') & 2) !== 0)},
        {id: 'micDmr', en: 'DMR mic', zh: 'DMR话筒', es: 'Micro DMR', o: 69, s: 1, n: [0, 20], f: (v) => `${v}dB`},
        {id: 'micFm', en: 'FM mic', zh: 'FM话筒', es: 'Micro FM', o: 70, s: 1, n: [0, 31], f: (v) => String(v)},
        {id: 'voxThreshold', en: 'VOX threshold', zh: '声控门限', es: 'Umbral VOX', o: 93, s: 1, n: [0, 13], f: (v) => (v ? String(v) : ['Off', '关', 'Desactivado'])},
        {id: 'voxTail', en: 'VOX tail', zh: '声控拖尾', es: 'Retardo VOX', o: 94, s: 1, n: [1, 10], f: (v) => `${(v / 2).toFixed(1)}s`,
            when: (g) => g('voxThreshold') !== 0},
        {id: 'dmrRxAgc', en: 'DMR Rx AGC', zh: 'DMR接收AGC', es: 'AGC Rx DMR', o: 82, s: 1, n: [0, 8], f: (v) => (v ? `${(v - 1) * 3}dB` : ['Off', '关', 'Desactivado'])},
    ]},
    {key: 'aprs', en: 'APRS', zh: 'APRS', es: 'APRS', items: [
        {id: 'aprsMode', en: 'Mode', zh: '模式', es: 'Modo', o: 40, s: 4, b: [29, 7],
            c: [[0, 'Off', '关', 'Desactivado'], [1, 'Manual', '手动', 'Manual'], [2, 'PTT', 'PTT', 'PTT'], [3, 'Auto', '自动', 'Automático'], [4, 'Smart', '智能', 'Smart']]},
        {id: 'aprsLocation', en: 'Location', zh: '位置', es: 'Ubicación', o: 64, s: 2, b: [5, 3], c: [[1, 'Channel', '信道', 'Canal'], [2, 'GPS', 'GPS', 'GPS']],
            read: (v) => ((v & 2) ? 2 : 1)},
        {id: 'aprsInterval', en: 'Interval', zh: '间隔', es: 'Intervalo', o: 64, s: 2, b: [0, 15],
            c: ['0.2', '0.5', '1', '2', '3', '5', '10', '20', '30', '60'].map((m, i) => [i, `${m} min`, `${m} 分钟`, `${m} min`])},
        {id: 'aprsDecay', en: 'Decay', zh: '衰减', es: 'Atenuación', o: 64, s: 2, b: [7, 1], c: ONOFF},
        {id: 'aprsCompress', en: 'Compress', zh: '压缩', es: 'Compresión', o: 64, s: 2, b: [8, 1], c: ONOFF},
        {id: 'aprsSlow', en: 'Slow rate', zh: '慢速率', es: 'Tasa lenta', o: 44, s: 4, b: [14, 127], n: [1, 100], f: (v) => `${v}min`, input: true},
        {id: 'aprsFast', en: 'Fast rate', zh: '快速率', es: 'Tasa rápida', o: 40, s: 4, b: [16, 255], n: [10, 180], f: (v) => `${v}s`, input: true},
        {id: 'aprsLowSpeed', en: 'Low speed', zh: '低速', es: 'Velocidad baja', o: 40, s: 4, b: [24, 31], n: [2, 30], f: (v) => `${v}km/h`},
        {id: 'aprsHighSpeed', en: 'High speed', zh: '高速', es: 'Velocidad alta', o: 44, s: 4, b: [7, 127], n: [2, 90], f: (v) => `${v}km/h`, input: true},
        {id: 'aprsTurnAngle', en: 'Turn angle', zh: '转弯角度', es: 'Ángulo de giro', o: 44, s: 4, b: [0, 127], n: [5, 90], f: (v) => `${v}°`, input: true},
        {id: 'aprsTurnSlope', en: 'Turn slope', zh: '转弯斜率', es: 'Pendiente de giro', o: 40, s: 4, b: [8, 255], n: [1, 255], f: (v) => `${v * 10}°/v`, input: true},
        {id: 'aprsTurnTime', en: 'Turn time', zh: '转弯时间', es: 'Tiempo de giro', o: 40, s: 4, b: [0, 255], n: [5, 180], f: (v) => `${v}s`, input: true},
    ]},
];

const BY_ID = new Map(GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]));

export class RadioSettings {
    constructor(img) {
        this.img = img;
        this.dirty = false;
        this.languageDirty = false;
        const item = BY_ID.get('language');
        const v = this.field(item);
        this.language = (Math.floor(v / (2 ** item.b[0])) & item.b[1]);
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
        if (id === 'language') {
            return this.language;
        }
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
        if (id === 'language') {
            const v = Number(value);
            this.language = v;
            this.languageDirty = true;
            this.dirty = true;
            // bit 19 follows Chinese for backwards compatibility (src/services/language.c:81)
            const item = BY_ID.get(id);
            const [shift, mask] = item.b;
            const word = this.field(item);
            const unit = 2 ** shift;
            const bit = (v === 1 ? 1 : 0);
            const updated = (word - ((Math.floor(word / unit) & mask) * unit)) + (bit * unit);
            this.setField(item, updated);
            return;
        }
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
