// OpenDMR CPS: the page

import {t, applyTexts, setLanguage} from './i18n.js';
import {icon, applyIcons} from './icons.js';
import {Codeplug, MODES, P25_NAC_ANY, NXDN_RAN_MAX, M17_CAN_MAX, CALL_TYPES, POWER_LEVELS, STEPS_HZ, toneChoices, frequencyValid, LOCKOUTS_MAX,
    TA_TX, APRS_CONFIGS_MAX, newAprsConfig, CustomDataDamaged, aprsSymbolChoices, aprsSymbolOf} from './codeplug/codeplug.js';
import * as L from './codeplug/layout.js';
import {RadioLink, SPEED_MAX, SPEED_MIN, SPEED_SETTING_KEY, radioBaud} from './radio/link.js';
import {GROUPS, SETTINGS, SETTINGS_SIZE, DTMF_DURATIONS_SIZE} from './codeplug/settings.js';
import {language} from './i18n.js';
import {VERSION} from './version.js';
import * as SAT from './codeplug/satellites.js';
import * as SMS from './codeplug/sms.js';
import * as TH from './codeplug/themes.js';
import * as BOOT from './codeplug/boot_image.js';
import {SCREENS, SCREEN_WIDTH, SCREEN_HEIGHT} from './ui/screens.js';
import * as DMR from './codeplug/dmrids.js';
import * as ODDB from './codeplug/oddb.js';
import * as LG from './codeplug/languages.js';
import * as gb from './gb2312.js';
import * as CSV from './codeplug/csv.js';
import {makeZip, readZip, isZip} from './codeplug/zip.js';
import {createFlasher} from './flasher.js';

const FILE_MAGIC = 'OPENDMR-CPS 1\n'; // our codeplug file: this line, then the window image (layout.js IMAGE_SIZE)

let codeplug = new Codeplug();
let link = null;
let radioImage = null; // the image as last read from the radio (or written to it): sectors with its CRC need no read
let tab = 'channels';
let selectedChannel = null; // the channel being edited
let selectedVfo = 0;
let radio = null; // what the connected radio reports (link.js radioInfo)
const $ = (id) => document.getElementById(id);

/* ---- small DOM helpers ---- */

function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) {
            continue;
        }
        if (k === 'class') {
            e.className = v;
        } else if (k.startsWith('on')) {
            e.addEventListener(k.slice(2), v);
        } else if (k in e && k !== 'list') {
            e[k] = v;
        } else {
            e.setAttribute(k, v === true ? '' : v);
        }
    }
    for (const c of children.flat()) {
        if (c !== null && c !== undefined && c !== false) {
            e.append(c instanceof Node ? c : String(c));
        }
    }
    return e;
}

function button(label, iconName, onclick, cls = '') {
    return el('button', {class: cls, onclick, title: label}, iconName ? icon(iconName) : null, label);
}

function iconButton(iconName, title, onclick, cls = '') {
    return el('button', {class: 'ghost icon-only ' + cls, title, onclick}, icon(iconName));
}

function toast(text, ms = 3500) {
    const box = $('toast');
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
        box.hidden = true;
    }, ms);
}

function status(text) {
    $('status').textContent = text;
}

function progress(done, total) {
    $('progressBox').hidden = (total === 0) || (done >= total);
    $('progressBar').style.width = (total ? (100 * done / total) : 0) + '%';
}

function searchBox(onInput) {
    const input = el('input', {type: 'search', placeholder: t('filter')});
    input.addEventListener('input', () => onInput(input.value.trim().toLowerCase()));
    return [el('label', {class: 'search'}, icon('search'), input), input];
}

/* ---- form fields ---- */

// A "?" after a label: its help text (an i18n key) in a bubble over the page, the layout left as it is. One bubble
// at a time; a click elsewhere, Escape, scrolling or resizing closes it.
const helpBubble = {box: null, owner: null};

function closeHelp() {
    helpBubble.box?.remove();
    helpBubble.owner?.classList.remove('on');
    helpBubble.box = null;
    helpBubble.owner = null;
}

function openHelp(btn, key) {
    closeHelp();
    const box = el('div', {class: 'help-bubble', role: 'tooltip'}, t(key));
    document.body.append(box);
    const r = btn.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.max(8, Math.min(r.left + (r.width / 2) - 24, window.innerWidth - w - 8));
    const below = r.bottom + 8 + h <= window.innerHeight - 8;
    box.style.left = left + 'px';
    box.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + 'px';
    box.style.setProperty('--arrow', (r.left + (r.width / 2) - left) + 'px');
    box.classList.add(below ? 'below' : 'above');
    btn.classList.add('on');
    helpBubble.box = box;
    helpBubble.owner = btn;
}

document.addEventListener('click', (e) => {
    if (helpBubble.box && !helpBubble.box.contains(e.target) && e.target !== helpBubble.owner) {
        closeHelp();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeHelp();
    }
});
window.addEventListener('resize', closeHelp);
document.addEventListener('scroll', closeHelp, true);

function helpButton(key) {
    const btn = el('button', {type: 'button', class: 'help-btn', title: t('help'), onclick: (e) => {
        e.preventDefault(); // not the checkbox of a label it is in
        e.stopPropagation();
        if (helpBubble.owner === btn) {
            closeHelp();
        } else {
            openHelp(btn, key);
        }
    }}, '?');
    return btn;
}

function field(label, control, opts = {}) {
    return el('div', {class: 'field' + (opts.wide ? ' wide' : '')},
        el('label', {}, label, opts.help ? helpButton(opts.help) : null), control);
}

// A name: GB2312 bytes limited, the characters the radio can't show flagged
function nameInput(value, maxBytes, onChange) {
    const input = el('input', {value, spellcheck: false});
    input.addEventListener('input', () => {
        const bad = gb.unencodable(input.value);
        input.classList.toggle('invalid', (bad.length > 0) || (gb.byteLength(input.value) > maxBytes));
        input.title = bad.length ? (t('unencodable') + bad.join(' ')) : '';
    });
    input.addEventListener('change', () => {
        const bad = gb.unencodable(input.value);
        if (bad.length) {
            toast(t('unencodable') + bad.join(' '));
        }
        input.value = gb.decode(Uint8Array.from(gb.encode(input.value, maxBytes)));
        input.classList.remove('invalid');
        onChange(input.value);
    });
    return input;
}

function select(options, value, onChange) {
    const s = el('select', {}, options.map(([v, label]) =>
        el('option', {value: String(v), selected: String(v) === String(value)}, label)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

function check(label, value, onChange, help = null) {
    const c = el('input', {type: 'checkbox', checked: value});
    c.addEventListener('change', () => onChange(c.checked));
    return el('label', {class: 'check'}, c, label, help ? helpButton(help) : null);
}

function valueInput(value, onChange, parse, format = (v) => v) {
    const input = el('input', {value: format(value), inputmode: 'decimal'});
    input.addEventListener('change', () => {
        const v = parse(input.value.trim());
        if (v === null) {
            input.classList.add('invalid');
            toast(t('badValue'));
            return;
        }
        input.classList.remove('invalid');
        input.value = format(v);
        onChange(v);
    });
    return input;
}

const mhz = (hz) => (hz / 1e6).toFixed(5);

function parseMhz(text) {
    const v = Math.round(parseFloat(text) * 1e5) * 10; // 10 Hz units
    return (Number.isFinite(v) && frequencyValid(v)) ? v : null;
}

function intRange(lo, hi) {
    return (s) => {
        const v = Number(s);
        return (Number.isInteger(v) && v >= lo && v <= hi) ? v : null;
    };
}

/* ---- shared ---- */

function counts() {
    $('countChannels').textContent = codeplug.channels.length || '';
    $('countZones').textContent = codeplug.zones.length || '';
    $('countContacts').textContent = codeplug.contacts.length || '';
    $('countRxGroups').textContent = codeplug.rxGroups.length || '';
    $('countAprs').textContent = codeplug.aprsConfigs.length || '';
    $('countSatellites').textContent = codeplug.satellites.length || '';
    $('countLockouts').textContent = (codeplug.lockouts.length + lockedChannels().length) || '';
    $('countSms').textContent = codeplug.sms.inbox.length || '';
}

function render() {
    counts();
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const main = $('content');
    main.replaceChildren();
    ({channels: viewChannels, zones: viewZones, contacts: viewContacts, rxGroups: viewRxGroups, vfo: viewVfo,
        general: viewGeneral, radioSettings: viewRadioSettings, satellites: viewSatellites, dmrIds: viewDmrIds,
        lockouts: viewLockouts, sms: viewSms, aprs: viewAprs, debug: viewDebug, themes: viewThemes, languages: viewLanguages, flasher: flasherView.view})[tab](main);
}

function pageHead(title, ...rest) {
    return el('div', {class: 'page-head'}, el('h2', {}, title), ...rest);
}

function contactName(index) {
    const c = codeplug.contacts.find((x) => x.index === index);
    return c ? c.name : '';
}

function rxGroupName(number) {
    return codeplug.rxGroups.find((g) => g.number === number)?.name ?? '';
}

/* ---- the channel editor (channels and VFOs) ---- */

// The radio's default power (Radio settings), null when its settings are not read
function defaultPower() {
    return codeplug.settings.valid ? Math.min(codeplug.settings.get('txPower'), POWER_LEVELS.length - 1) + 1 : null;
}

// The power of a channel or VFO: its own. 0 (written so before) follows the default power; a VFO takes it as its own
// (as the firmware does when it reads the VFO)
function powerSelect(ch, vfo, set) {
    const dflt = defaultPower();
    if (vfo && ch.power === 0 && dflt) {
        ch.power = dflt;
    }
    const radio = t('fromRadio') + (dflt ? ` (${POWER_LEVELS[dflt - 1]})` : '');
    const levels = POWER_LEVELS.map((p, i) => [i + 1, p]);
    return select((vfo && ch.power !== 0) ? levels : [[0, radio], ...levels], ch.power, (v) => set(+v));
}

function channelEditor(ch, opts) {
    const box = el('div');

    function draw() {
        const p25 = ch.mode === 'P25';
        const nxdn = ch.mode === 'NXDN';
        const m17 = ch.mode === 'M17';
        const dmr = ch.mode === 'DMR';
        const analog = !dmr && !p25 && !nxdn && !m17;
        const set = (k, redraw = false) => (v) => {
            ch[k] = v;
            opts.changed?.();
            if (redraw) {
                draw();
            }
        };
        const tones = toneChoices().map((v) => [v, v === '' ? t('none') : v]);
        const sections = [
            el('div', {class: 'section'}, el('h4', {}, t('secBasic')), el('div', {class: 'fields'},
                opts.vfo ? null : field(t('name'), nameInput(ch.name, 16, set('name')), {wide: true}),
                field(t('mode'), select(MODES.map((m) => [m, m]), ch.mode, set('mode', true))),
                field(t('power'), powerSelect(ch, opts.vfo, set('power'))),
                field(t('rxFreq'), valueInput(ch.rx, set('rx'), parseMhz, mhz)),
                field(t('txFreq'), valueInput(ch.tx, set('tx'), parseMhz, mhz)),
                check(t('rxOnly'), ch.rxOnly, set('rxOnly')),
                field(t('tot'), valueInput(ch.tot, set('tot'), (s) => {
                    const v = Number(s);
                    return (Number.isInteger(v) && v >= 0 && v <= 3825) ? Math.round(v / 15) * 15 : null;
                })),
            )),
            analog ? el('div', {class: 'section'}, el('h4', {}, t('secAnalog')), el('div', {class: 'fields'},
                field(t('rxTone'), select(tones, ch.rxTone, set('rxTone'))),
                field(t('txTone'), select(tones, ch.txTone, set('txTone'))),
                ch.mode === 'FM' ? field(t('bandwidth'), select([[0, t('narrow')], [1, t('wideBw')]], ch.wide ? 1 : 0,
                    (v) => set('wide')(v === '1'))) : null,
                field(t('squelch'), select([[0, t('fromRadio')], ...Array.from({length: 21}, (_, i) => [i + 1, (i * 5) + '%'])],
                    ch.squelch, (v) => set('squelch')(+v))),
            )) : el('div', {class: 'section'}, el('h4', {}, t(p25 ? 'secP25' : nxdn ? 'secNxdn' : m17 ? 'secM17' : 'secDmr')),
                el('div', {class: 'fields'},
                m17 ? field(t('can'), select([...Array(M17_CAN_MAX + 1).keys()].map((i) => [i, i]), ch.can,
                    (v) => set('can')(+v)), {help: 'helpCan'}) : null,
                m17 ? field(t('m17Dst'), el('span', {class: 'dim'}, t('m17DstAll')), {help: 'helpM17Dst'}) : null,
                nxdn ? field(t('ran'), select([...Array(NXDN_RAN_MAX + 1).keys()].map((i) => [i, i === 0 ? `0 (${t('ranAny')})` : i]),
                    ch.ran, (v) => set('ran')(+v)), {help: 'helpRan'}) : null,
                (nxdn || m17) ? null : p25 ? field(t('nac'), valueInput(ch.nac, set('nac'), (s) => {
                    const hex = s.trim().split(/\s/)[0];
                    const v = /^[0-9a-fA-F]{1,3}$/.test(hex) ? parseInt(hex, 16) : NaN;
                    return Number.isNaN(v) ? null : v;
                }, (v) => v.toString(16).toUpperCase().padStart(3, '0') + (v === P25_NAC_ANY ? ' (' + t('nacAny') + ')' : '')))
                    : field(t('colourCode'), select([...Array(16).keys()].map((i) => [i, i]), ch.colourCode, (v) => set('colourCode')(+v))),
                !dmr ? null : field(t('timeslot'), select([[1, 'TS1'], [2, 'TS2']], ch.timeslot, (v) => set('timeslot')(+v))),
                m17 ? null : field(t('contact'), select([[0, t('none')], ...codeplug.contacts.map((c) => [c.index, `${c.name} · ${c.id}`])],
                    ch.contact, (v) => set('contact')(+v)), {wide: true}),
                m17 ? null : field(t('rxGroup'), select([[0, t('none')], ...codeplug.rxGroups.map((g) => [g.number, g.name])],
                    ch.rxGroup, (v) => set('rxGroup')(+v)), {wide: true}),
                !dmr ? null : field(t('channelDmrId'), valueInput(ch.dmrId || '', (v) => set('dmrId')(v || 0),
                    (s) => (s === '' ? 0 : intRange(1, 16777215)(s)), (v) => v || ''), {wide: true}),
                !dmr ? null : check(t('forceDmo'), ch.forceDmo, set('forceDmo')),
                !dmr ? null : field(t('taTx1'), select(TA_TX.map((v, i) => [i, v]), ch.taTx1, (v) => set('taTx1')(+v)),
                    {help: 'helpTaTx'}),
                !dmr ? null : field(t('taTx2'), select(TA_TX.map((v, i) => [i, v]), ch.taTx2, (v) => set('taTx2')(+v)),
                    {help: 'helpTaTx'}),
            )),
            el('div', {class: 'section'}, el('h4', {}, t('secOther')), el('div', {class: 'fields'},
                field(t('step'), select(STEPS_HZ.map((s) => [s, (s / 1000) + ' kHz']), ch.step, (v) => set('step')(+v))),
                el('div'),
                check(t('beep'), ch.beep, set('beep')),
                check(t('eco'), ch.eco, set('eco')),
                opts.vfo ? null : check(t('zoneSkip'), ch.zoneSkip, set('zoneSkip')),
                opts.vfo ? null : check(t('allSkip'), ch.allSkip, set('allSkip')),
                check(t('vox'), ch.vox, set('vox')),
                field(t('aprsConfig'), select([[0, t('none')], ...codeplug.aprsConfigs.map((c) => [c.index, c.name])],
                    ch.aprs, (v) => set('aprs')(+v)), {wide: true, help: 'helpChannelAprs'}),
                opts.vfo ? null : field(t('latitude'), valueInput(ch.latitude, set('latitude'), parseDegrees(90), showDegrees),
                    {help: 'helpChannelPlace'}),
                opts.vfo ? null : field(t('longitude'), valueInput(ch.longitude, set('longitude'), parseDegrees(180), showDegrees),
                    {help: 'helpChannelPlace'}),
                opts.vfo ? null : check(t('useLocation'), ch.useLocation, set('useLocation'), 'helpUseLocation'),
            )),
        ];
        box.replaceChildren(...sections);
    }

    draw();
    return box;
}

/* ---- channels ---- */

// Rows ticked to delete many at once: a box per row, one in the header for all the rows shown, and a button that
// deletes the ticked ones after asking. items(): all of them, shown(): those the filter shows, remove(list): deletes
// them, redraw(): the rows drawn again
function bulkDelete({items, shown, remove, redraw}) {
    const ticked = new Set();
    const all = el('input', {type: 'checkbox', title: t('tickAll')});
    const del = button(t('deleteTicked'), 'trash', () => {
        const list = [...ticked];
        if (list.length && confirm(t('deleteTickedAsk').replace('{n}', list.length))) {
            remove(list);
            ticked.clear();
            redraw();
        }
    }, 'danger');
    function update() {
        const present = new Set(items());
        for (const x of ticked) {
            if (!present.has(x)) {
                ticked.delete(x);
            }
        }
        const list = shown();
        const n = list.filter((x) => ticked.has(x)).length;
        all.checked = list.length > 0 && n === list.length;
        all.indeterminate = n > 0 && n < list.length;
        del.hidden = !ticked.size;
        del.lastChild.textContent = `${t('deleteTicked')} (${ticked.size})`;
    }
    all.addEventListener('change', () => {
        for (const x of shown()) {
            if (all.checked) {
                ticked.add(x);
            } else {
                ticked.delete(x);
            }
        }
        redraw();
    });
    const tick = (item) => {
        const box = el('input', {type: 'checkbox', checked: ticked.has(item)});
        box.addEventListener('click', (e) => e.stopPropagation());
        box.addEventListener('change', () => {
            if (box.checked) {
                ticked.add(item);
            } else {
                ticked.delete(item);
            }
            update();
        });
        return el('td', {class: 'check-cell', onclick: (e) => e.stopPropagation()}, box);
    };
    return {head: el('th', {class: 'check-cell'}, all), tick, button: del, update};
}

// Channels deleted, and taken out of the zones
function removeChannels(list) {
    const gone = new Set(list);
    const numbers = new Set(list.map((c) => c.number));
    codeplug.channels = codeplug.channels.filter((c) => !gone.has(c));
    for (const z of codeplug.zones) {
        z.channels = z.channels.filter((n) => !numbers.has(n));
    }
}

// Contacts deleted, and taken out of the TG lists and the channels
function removeContacts(list) {
    const gone = new Set(list);
    const indexes = new Set(list.map((c) => c.index));
    codeplug.contacts = codeplug.contacts.filter((c) => !gone.has(c));
    for (const g of codeplug.rxGroups) {
        g.contacts = g.contacts.filter((i) => !indexes.has(i));
    }
    for (const ch of codeplug.channels) {
        if (indexes.has(ch.contact)) {
            ch.contact = 0;
        }
    }
}

function viewChannels(main) {
    let filter = '';
    let shown = [];
    const [search] = searchBox((f) => {
        filter = f;
        fill();
    });
    const body = el('tbody');
    const drawer = el('div', {class: 'card drawer'});

    function summaryTone(ch) {
        if (ch.mode === 'DMR') {
            return `CC${ch.colourCode} · TS${ch.timeslot}`;
        }
        if (ch.mode === 'P25') {
            return 'NAC' + ch.nac.toString(16).toUpperCase().padStart(3, '0');
        }
        if (ch.mode === 'NXDN') {
            return 'RAN' + ch.ran;
        }
        if (ch.mode === 'M17') {
            return 'CAN' + ch.can;
        }
        return [ch.rxTone, ch.txTone].some((x) => x) ? `${ch.rxTone || '—'} / ${ch.txTone || '—'}` : '';
    }

    function row(ch) {
        const tr = el('tr', {class: ch === selectedChannel ? 'selected' : '', onclick: () => {
            selectedChannel = ch;
            body.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
            tr.classList.add('selected');
            openDrawer();
        }},
        bulk.tick(ch),
        el('td', {class: 'num'}, ch.number),
        el('td', {class: 'name'}, ch.name),
        el('td', {}, el('span', {class: 'pill ' + ch.mode}, ch.mode)),
        el('td', {class: 'mono'}, mhz(ch.rx)),
        el('td', {class: 'mono dim'}, ch.tx === ch.rx ? '' : mhz(ch.tx)),
        el('td', {class: 'dim'}, summaryTone(ch)),
        el('td', {class: 'dim'}, ['DMR', 'P25', 'NXDN'].includes(ch.mode) ? (contactName(ch.contact) || rxGroupName(ch.rxGroup)) : ''),
        el('td', {class: 'dim'}, ch.power ? POWER_LEVELS[ch.power - 1] : ''),
        el('td', {},
            ch.rxOnly ? el('span', {class: 'tag'}, t('rxOnly')) : null,
            (ch.mode === 'FM' && ch.wide) ? el('span', {class: 'tag'}, '25k') : null));
        ch.row = tr;
        return tr;
    }

    function fill() {
        shown = codeplug.channels.filter((c) => !filter || c.name.toLowerCase().includes(filter) ||
            mhz(c.rx).includes(filter));
        body.replaceChildren(...shown.map(row));
        if (!shown.length) {
            body.append(el('tr', {}, el('td', {colspan: 10, class: 'empty'}, '—')));
        }
        bulk.update();
    }

    const bulk = bulkDelete({
        items: () => codeplug.channels,
        shown: () => shown,
        remove: (list) => {
            removeChannels(list);
            if (list.includes(selectedChannel)) {
                selectedChannel = null;
            }
        },
        redraw: () => {
            counts();
            fill();
            openDrawer();
        },
    });

    function refreshRow() {
        if (selectedChannel?.row) {
            const fresh = row(selectedChannel);
            fresh.classList.add('selected');
            selectedChannel.row.replaceWith(fresh);
            selectedChannel.row = fresh;
        }
    }

    function openDrawer() {
        const ch = selectedChannel;
        if (!ch || !codeplug.channels.includes(ch)) {
            drawer.replaceChildren(el('div', {class: 'empty'}, t('pickChannel')));
            return;
        }
        drawer.replaceChildren(
            el('div', {class: 'drawer-head'},
                el('span', {class: 'pill ' + ch.mode}, ch.mode),
                el('h3', {}, `${ch.number}. ${ch.name}`),
                iconButton('copy', t('duplicate'), () => {
                    const n = codeplug.freeChannelNumber();
                    if (!n) {
                        return;
                    }
                    const copy = {...ch, number: n, raw: ch.raw ? Uint8Array.from(ch.raw) : null, row: null};
                    codeplug.channels.push(copy);
                    codeplug.channels.sort((a, b) => a.number - b.number);
                    selectedChannel = copy;
                    counts();
                    fill();
                    openDrawer();
                }),
                iconButton('trash', t('deleteChannel'), () => {
                    removeChannels([ch]);
                    selectedChannel = null;
                    counts();
                    fill();
                    openDrawer();
                }, 'danger')),
            channelEditor(ch, {changed: () => {
                refreshRow();
                drawer.querySelector('.drawer-head h3').textContent = `${ch.number}. ${ch.name}`;
                const pill = drawer.querySelector('.drawer-head .pill');
                pill.className = 'pill ' + ch.mode;
                pill.textContent = ch.mode;
            }}));
    }

    main.append(
        pageHead(t('channels'),
            el('span', {class: 'spacer'}),
            bulk.button,
            search,
            button(t('add'), 'plus', () => {
                const n = codeplug.freeChannelNumber();
                if (!n) {
                    return;
                }
                const ch = Codeplug.newChannel(n);
                if (codeplug.settings.valid) { // a new channel starts with the radio's default power, then its own
                    ch.power = Math.min(codeplug.settings.get('txPower'), POWER_LEVELS.length - 1) + 1;
                }
                codeplug.channels.push(ch);
                codeplug.channels.sort((a, b) => a.number - b.number);
                selectedChannel = ch;
                counts();
                fill();
                openDrawer();
                ch.row?.scrollIntoView({block: 'nearest'});
            }, 'primary')),
        el('div', {class: 'work'},
            el('div', {class: 'card', style: 'flex:1;min-width:0'},
                el('div', {class: 'table-wrap'},
                    el('table', {class: 'grid'},
                        el('thead', {}, el('tr', {}, bulk.head, ['number', 'name', 'mode', 'rxFreq', 'txFreq', 'tone',
                            'contactOrList', 'power', 'flags'].map((k) => el('th', {}, t(k))))),
                        body))),
            drawer));
    fill();
    openDrawer();
}

/* ---- VFOs ---- */

function viewVfo(main) {
    const pick = el('div', {class: 'items'});
    const editor = el('div', {class: 'card drawer', style: 'width:auto;flex:1;max-width:560px'});

    function draw() {
        pick.replaceChildren(...codeplug.vfos.map((v, i) => el('div', {
            class: 'item' + (i === selectedVfo ? ' selected' : ''),
            onclick: () => {
                selectedVfo = i;
                draw();
            },
        }, el('span', {class: 'pill ' + v.mode}, v.mode), t(i ? 'vfoB' : 'vfoA'), el('span', {class: 'sub'}, mhz(v.rx)))));
        const v = codeplug.vfos[selectedVfo];
        editor.replaceChildren(
            el('div', {class: 'drawer-head'}, el('h3', {}, t(selectedVfo ? 'vfoB' : 'vfoA'))),
            channelEditor(v, {vfo: true, changed: () => {
                const item = pick.children[selectedVfo];
                item.querySelector('.pill').className = 'pill ' + v.mode;
                item.querySelector('.pill').textContent = v.mode;
                item.querySelector('.sub').textContent = mhz(v.rx);
            }}));
    }

    main.append(pageHead(t('vfo')),
        el('div', {class: 'work'},
            el('div', {class: 'card', style: 'width:260px;flex:none'}, pick),
            editor));
    draw();
}

/* ---- zones / TG lists: the list, the members, the candidates ---- */

function viewMembers(main, opts) {
    let selected = opts.items()[0] ?? null;
    let filter = '';
    const left = el('div', {class: 'items'});
    const members = el('div', {class: 'items'});
    const candidates = el('div', {class: 'items'});
    const nameBox = el('div', {class: 'name-edit'});
    const memberCount = el('span', {class: 'count'});
    const [search] = searchBox((f) => {
        filter = f;
        draw();
    });

    function move(items, i, d) {
        const j = i + d;
        if (j >= 0 && j < items.length) {
            [items[i], items[j]] = [items[j], items[i]];
        }
    }

    function draw() {
        counts();
        left.replaceChildren(...opts.items().map((item, i) => el('div', {
            class: 'item' + (item === selected ? ' selected' : ''),
            onclick: () => {
                selected = item;
                draw();
            },
        }, el('span', {class: 'n'}, i + 1), item.name, el('span', {class: 'sub'}, opts.members(item).length))));
        nameBox.replaceChildren();
        members.replaceChildren();
        candidates.replaceChildren();
        memberCount.textContent = '';
        if (!selected) {
            nameBox.append(el('div', {class: 'empty', style: 'padding:12px'}, t('pickItem')));
            return;
        }
        nameBox.append(field(t('name'), nameInput(selected.name, 16, (v) => {
            selected.name = v;
            draw();
        })));
        const list = opts.members(selected);
        memberCount.textContent = `${list.length} / ${opts.max}`;
        list.forEach((m, i) => members.append(el('div', {class: 'item'},
            el('span', {class: 'n'}, i + 1), opts.label(m),
            el('span', {class: 'sub'}, opts.sub(m)),
            el('span', {class: 'acts'},
                iconButton('up', t('up'), (e) => {
                    e.stopPropagation();
                    move(list, i, -1);
                    draw();
                }),
                iconButton('down', t('down'), (e) => {
                    e.stopPropagation();
                    move(list, i, 1);
                    draw();
                }),
                iconButton('x', t('delete'), (e) => {
                    e.stopPropagation();
                    list.splice(i, 1);
                    draw();
                }, 'danger')))));
        for (const c of opts.candidates()) {
            const label = opts.label(c);
            if (!list.includes(c) && (!filter || label.toLowerCase().includes(filter))) {
                candidates.append(el('div', {class: 'item', onclick: () => {
                    if (list.length >= opts.max) {
                        toast(opts.fullText);
                        return;
                    }
                    list.push(c);
                    draw();
                }}, el('span', {class: 'add'}, '+'), label, el('span', {class: 'sub'}, opts.sub(c))));
            }
        }
    }

    main.append(
        pageHead(opts.title),
        el('div', {class: 'columns'},
            el('div', {class: 'card'},
                el('div', {class: 'card-head'}, el('h3', {}, opts.title),
                    iconButton('plus', t('add'), () => {
                        const item = opts.add();
                        if (item) {
                            selected = item;
                            draw();
                        }
                    }),
                    iconButton('up', t('up'), () => {
                        move(opts.items(), opts.items().indexOf(selected), -1);
                        draw();
                    }),
                    iconButton('down', t('down'), () => {
                        move(opts.items(), opts.items().indexOf(selected), 1);
                        draw();
                    }),
                    iconButton('trash', t('delete'), () => {
                        if (selected) {
                            opts.remove(selected);
                            selected = opts.items()[0] ?? null;
                            draw();
                        }
                    }, 'danger')),
                left),
            el('div', {class: 'card'}, nameBox,
                el('div', {class: 'card-head'}, el('h3', {}, opts.membersTitle, ' ', memberCount)),
                members),
            el('div', {class: 'card'},
                el('div', {class: 'card-head'}, el('h3', {}, t('available')), search),
                candidates)));
    draw();
}

function viewZones(main) {
    const byNumber = new Map(codeplug.channels.map((c) => [c.number, c]));
    viewMembers(main, {
        title: t('zones'),
        items: () => codeplug.zones,
        members: (z) => z.channels,
        candidates: () => codeplug.channels.map((c) => c.number),
        label: (n) => byNumber.get(n)?.name ?? `#${n}`,
        sub: (n) => (byNumber.get(n) ? mhz(byNumber.get(n).rx) : ''),
        max: codeplug.channelsPerZone,
        fullText: t('zoneFull'),
        membersTitle: t('channelsInZone'),
        add: () => {
            if (codeplug.zones.length >= L.ZONES_MAX) {
                return null;
            }
            const z = {name: 'Zone ' + (codeplug.zones.length + 1), channels: []};
            codeplug.zones.push(z);
            return z;
        },
        remove: (z) => {
            codeplug.zones = codeplug.zones.filter((x) => x !== z);
        },
    });
}

function viewRxGroups(main) {
    const byIndex = new Map(codeplug.contacts.map((c) => [c.index, c]));
    viewMembers(main, {
        title: t('rxGroups'),
        items: () => codeplug.rxGroups,
        members: (g) => g.contacts,
        candidates: () => codeplug.contacts.filter((c) => c.callType === 'group').map((c) => c.index),
        label: (i) => byIndex.get(i)?.name ?? `#${i}`,
        sub: (i) => byIndex.get(i)?.id ?? '',
        max: L.RX_GROUP_CONTACTS,
        fullText: t('listFull'),
        membersTitle: t('contactsInList'),
        add: () => {
            const n = codeplug.freeRxGroupNumber();
            if (!n) {
                return null;
            }
            const g = {number: n, name: 'TG list ' + n, contacts: []};
            codeplug.rxGroups.push(g);
            return g;
        },
        remove: (g) => {
            codeplug.rxGroups = codeplug.rxGroups.filter((x) => x !== g);
            for (const ch of codeplug.channels) {
                if (ch.rxGroup === g.number) {
                    ch.rxGroup = 0;
                }
            }
        },
    });
}

/* ---- contacts ---- */

function viewContacts(main) {
    let filter = '';
    let selected = null;
    let shown = [];
    const [search] = searchBox((f) => {
        filter = f;
        fill();
    });
    const body = el('tbody');
    const drawer = el('div', {class: 'card drawer'});

    function row(c) {
        const tr = el('tr', {class: c === selected ? 'selected' : '', onclick: () => {
            selected = c;
            body.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
            tr.classList.add('selected');
            openDrawer();
        }},
        bulk.tick(c),
        el('td', {class: 'num'}, c.index),
        el('td', {class: 'name'}, c.name),
        el('td', {class: 'mono'}, c.id),
        el('td', {class: 'dim'}, t(c.callType)),
        el('td', {class: 'dim'}, c.timeslot ? 'TS' + c.timeslot : ''));
        c.row = tr;
        return tr;
    }

    function fill() {
        shown = codeplug.contacts.filter((c) => !filter || c.name.toLowerCase().includes(filter) ||
            String(c.id).includes(filter));
        body.replaceChildren(...shown.map(row));
        bulk.update();
    }

    const bulk = bulkDelete({
        items: () => codeplug.contacts,
        shown: () => shown,
        remove: (list) => {
            removeContacts(list);
            if (list.includes(selected)) {
                selected = null;
            }
        },
        redraw: () => {
            counts();
            fill();
            openDrawer();
        },
    });

    function openDrawer() {
        const c = selected;
        if (!c || !codeplug.contacts.includes(c)) {
            drawer.replaceChildren(el('div', {class: 'empty'}, t('pickItem')));
            return;
        }
        const changed = () => {
            const fresh = row(c);
            fresh.classList.add('selected');
            c.row.replaceWith(fresh);
            drawer.querySelector('h3').textContent = c.name;
        };
        drawer.replaceChildren(
            el('div', {class: 'drawer-head'}, el('h3', {}, c.name),
                iconButton('trash', t('delete'), () => {
                    removeContacts([c]);
                    selected = null;
                    counts();
                    fill();
                    openDrawer();
                }, 'danger')),
            el('div', {class: 'section'}, el('div', {class: 'fields'},
                field(t('name'), nameInput(c.name, 16, (v) => {
                    c.name = v;
                    changed();
                }), {wide: true}),
                field(t('id'), valueInput(c.id, (v) => {
                    c.id = v;
                    changed();
                }, intRange(1, 16777215))),
                field(t('callType'), select(CALL_TYPES.map((x) => [x, t(x)]), c.callType, (v) => {
                    c.callType = v;
                    changed();
                })),
                field(t('tsOverride'), select([[0, t('none')], [1, 'TS1'], [2, 'TS2']], c.timeslot, (v) => {
                    c.timeslot = +v;
                    changed();
                })))));
    }

    main.append(
        pageHead(t('contacts'), el('span', {class: 'spacer'}), bulk.button, search,
            button(t('add'), 'plus', () => {
                const i = codeplug.freeContactIndex();
                if (!i) {
                    return;
                }
                const c = {index: i, name: 'TG ' + i, id: 1, callType: 'group', timeslot: 0, raw: null};
                codeplug.contacts.push(c);
                codeplug.contacts.sort((a, b) => a.index - b.index);
                selected = c;
                counts();
                fill();
                openDrawer();
                c.row?.scrollIntoView({block: 'nearest'});
            }, 'primary')),
        el('div', {class: 'work'},
            el('div', {class: 'card', style: 'flex:1;min-width:0'},
                el('div', {class: 'table-wrap'},
                    el('table', {class: 'grid'},
                        el('thead', {}, el('tr', {}, bulk.head, ['number', 'name', 'id', 'callType', 'tsOverride']
                            .map((k) => el('th', {}, t(k))))),
                        body))),
            drawer));
    fill();
    openDrawer();
}

/* ---- APRS configurations ---- */

// Decimal degrees: '' none (null)
function parseDegrees(max) {
    return (s) => {
        if (s === '' || Number(s.replace(',', '.')) === 0) {
            return null;
        }
        const v = Number(s.replace(',', '.'));
        return (Number.isFinite(v) && Math.abs(v) <= max) ? Math.round(v * 10000) / 10000 : null;
    };
}

const showDegrees = (v) => ((v === null || v === undefined) ? '' : String(v));

// Letters, digits and signs, at most max characters
function asciiInput(value, max, onChange, upper = true) {
    const input = el('input', {value, maxLength: max, spellcheck: false});
    input.addEventListener('change', () => {
        let v = input.value.replace(/[^\x20-\x7E]/g, '').slice(0, max);
        v = upper ? v.toUpperCase() : v;
        input.value = v;
        onChange(v);
    });
    return input;
}

function viewAprs(main) {
    let selected = null;
    const body = el('tbody');
    const drawer = el('div', {class: 'card drawer'});
    const touched = () => {
        codeplug.aprsDirty = true;
    };
    const path = (c) => [c.via1 && `${c.via1}-${c.via1Ssid}`, c.via2 && `${c.via2}-${c.via2Ssid}`].filter(Boolean).join(',');

    function row(c) {
        const tr = el('tr', {class: c === selected ? 'selected' : '', onclick: () => {
            selected = c;
            body.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
            tr.classList.add('selected');
            openDrawer();
        }},
        el('td', {class: 'num'}, c.index),
        el('td', {class: 'name'}, c.name),
        el('td', {class: 'mono'}, `${codeplug.general.callsign || '—'}-${c.ssid}`),
        el('td', {class: 'mono dim'}, path(c)),
        el('td', {class: 'mono'}, (c.iconTable ? '\\' : '/') + String.fromCharCode(c.icon + 33)),
        el('td', {class: 'dim'}, c.comment),
        el('td', {class: 'dim'}, codeplug.channels.filter((ch) => ch.aprs === c.index).length || ''));
        c.row = tr;
        return tr;
    }

    function fill() {
        body.replaceChildren(...codeplug.aprsConfigs.map(row));
        if (!codeplug.aprsConfigs.length) {
            body.append(el('tr', {}, el('td', {colspan: 7, class: 'empty'}, '—')));
        }
    }

    function openDrawer() {
        const c = selected;
        if (!c || !codeplug.aprsConfigs.includes(c)) {
            drawer.replaceChildren(el('div', {class: 'empty'}, t('pickItem')));
            return;
        }
        const set = (k, redraw = false) => (v) => {
            c[k] = v;
            touched();
            const fresh = row(c);
            fresh.classList.add('selected');
            c.row.replaceWith(fresh);
            drawer.querySelector('h3').textContent = c.name;
            if (redraw) {
                openDrawer();
            }
        };
        const ssids = Array.from({length: 16}, (_, i) => [i, i]);
        drawer.replaceChildren(
            el('div', {class: 'drawer-head'}, el('h3', {}, c.name),
                iconButton('trash', t('delete'), () => {
                    codeplug.aprsConfigs = codeplug.aprsConfigs.filter((x) => x !== c);
                    for (const ch of [...codeplug.channels, ...codeplug.vfos]) {
                        if (ch.aprs === c.index) {
                            ch.aprs = 0;
                        }
                    }
                    touched();
                    selected = null;
                    counts();
                    fill();
                    openDrawer();
                }, 'danger')),
            el('div', {class: 'section'}, el('h4', {}, t('secBasic')), el('div', {class: 'fields'},
                field(t('name'), asciiInput(c.name, 8, set('name')), {help: 'helpAprsName'}),
                field(t('ssid'), select(ssids, c.ssid, (v) => set('ssid')(+v)), {help: 'helpSsid'}),
                field(t('via1'), asciiInput(c.via1, 6, set('via1')), {help: 'helpVia1'}),
                field('SSID', select(ssids, c.via1Ssid, (v) => set('via1Ssid')(+v)), {help: 'helpViaSsid'}),
                field(t('via2'), asciiInput(c.via2, 6, set('via2')), {help: 'helpVia2'}),
                field('SSID', select(ssids, c.via2Ssid, (v) => set('via2Ssid')(+v)), {help: 'helpViaSsid'}),
                field(t('iconTable'), select([[0, t('iconPrimary')], [1, t('iconAlternate')]], c.iconTable,
                    (v) => set('iconTable')(+v)), {help: 'helpIconTable'}),
                field(t('aprsIcon'), select(aprsSymbolChoices(), aprsSymbolOf(c),
                    (v) => set('icon')(Math.max(0, Math.min(93, (v || '!').charCodeAt(0) - 33)))),
                    {help: 'helpAprsIcon'}),
                field(t('comment'), asciiInput(c.comment, 24, set('comment'), false), {wide: true, help: 'helpComment'}),
                field(t('baud'), select([[0, '1200'], [1, '300']], c.baud300 ? 1 : 0, (v) => set('baud300')(v === '1')),
                    {help: 'helpBaud'}),
                field(t('beaconFreq'), valueInput(c.txFrequency, set('txFrequency'),
                    (s) => (s === '' ? 0 : parseMhz(s)), (v) => (v ? mhz(v) : '')), {help: 'helpBeaconFreq'}),
                check(t('transmitQsy'), c.qsy, set('qsy'), 'helpTransmitQsy'),
            )),
            el('div', {class: 'section'}, el('h4', {}, t('aprsPosition')), el('div', {class: 'fields'},
                check(t('usePosition'), c.usePosition, set('usePosition', true), 'helpUsePosition'),
                field(t('ambiguity'), select([...Array(8).keys()].map((i) => [i, i]), c.ambiguity,
                    (v) => set('ambiguity')(+v)), {help: 'helpAmbiguity'}),
                c.usePosition ? field(t('latitude'), valueInput(c.latitude, set('latitude'), parseDegrees(90), showDegrees),
                    {help: 'helpLatitude'}) : null,
                c.usePosition ? field(t('longitude'), valueInput(c.longitude, set('longitude'), parseDegrees(180), showDegrees),
                    {help: 'helpLongitude'}) : null,
            )));
    }

    main.append(
        pageHead(t('aprsConfigs'), el('span', {class: 'spacer'}),
            button(t('add'), 'plus', () => {
                const used = new Set(codeplug.aprsConfigs.map((c) => c.index));
                const index = [...Array(APRS_CONFIGS_MAX).keys()].map((i) => i + 1).find((i) => !used.has(i));
                if (!index) {
                    toast(t('aprsFull'));
                    return;
                }
                const c = {...newAprsConfig('APRS' + index), index};
                codeplug.aprsConfigs.push(c);
                codeplug.aprsConfigs.sort((a, b) => a.index - b.index);
                touched();
                selected = c;
                counts();
                fill();
                openDrawer();
            }, 'primary')),
        el('p', {class: 'muted'}, t('aprsHelp')),
        el('div', {class: 'work'},
            el('div', {class: 'card', style: 'flex:1;min-width:0'},
                el('div', {class: 'table-wrap'},
                    el('table', {class: 'grid'},
                        el('thead', {}, el('tr', {}, [t('number'), t('name'), t('ssid'), 'Via', t('aprsIcon'), t('comment'),
                            t('channels')].map((k) => el('th', {}, k)))),
                        body))),
            drawer));
    fill();
    openDrawer();
}

/* ---- general ---- */

let bootSourceImage = null;
let bootFitMode = 'cover';
let bootDither = true;

function bootImageCard() {
    const canvas = el('canvas', {class: 'theme-screen', width: BOOT.BOOT_WIDTH, height: BOOT.BOOT_HEIGHT,
        style: 'width:180px;height:240px;border-radius:8px;border:1px solid var(--border);display:block;margin:8px 0'});
    const tag = el('span', {class: 'tag', style: 'margin-left:8px'});
    const fileInput = el('input', {type: 'file', accept: 'image/*', hidden: true});
    const presetBtn = button(t('bootImagePresetLogo'), null, () => {
        bootSourceImage = null;
        codeplug.bootImage = BOOT.buildDefaultBlock();
        codeplug.bootImageDirty = true;
        if (codeplug.settings.valid && !codeplug.settings.get('bootScreen')) {
            codeplug.settings.set('bootScreen', 1);
        }
        refreshPreview();
    }, 'ghost');
    const resetBtn = button(t('bootImageDefault'), null, () => {
        bootSourceImage = null;
        codeplug.bootImage = null;
        codeplug.bootImageDirty = true;
        refreshPreview();
    }, 'ghost');

    function recomputeFromSource() {
        if (!bootSourceImage) {
            return;
        }
        codeplug.bootImage = BOOT.convertImageElementToBlock(bootSourceImage, {fit: bootFitMode, dither: bootDither});
        codeplug.bootImageDirty = true;
        if (codeplug.settings.valid && !codeplug.settings.get('bootScreen')) {
            codeplug.settings.set('bootScreen', 1);
        }
        refreshPreview();
    }

    function refreshPreview() {
        if (codeplug.bootImage) {
            BOOT.renderBlockToCanvas(codeplug.bootImage, canvas);
        } else {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#07131F';
            ctx.fillRect(0, 0, BOOT.BOOT_WIDTH, BOOT.BOOT_HEIGHT);
            ctx.fillStyle = '#8FB0C9';
            ctx.textAlign = 'center';
            ctx.font = '13px system-ui, sans-serif';
            ctx.fillText(t('bootImageBuiltinTag'), BOOT.BOOT_WIDTH / 2, BOOT.BOOT_HEIGHT / 2);
        }
        tag.textContent = codeplug.bootImage ? t('bootImageCustomTag') : t('bootImageBuiltinTag');
        resetBtn.disabled = !codeplug.bootImage;
    }

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) {
            return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            bootSourceImage = img;
            recomputeFromSource();
            toast(t('bootImageLoaded'));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            toast(t('bootImageBad'));
        };
        img.src = url;
    });

    const fitSelect = select([['cover', t('bootImageCover')], ['contain', t('bootImageContain')]], bootFitMode, (v) => {
        bootFitMode = v;
        recomputeFromSource();
    });
    const ditherCheck = check(t('bootImageDither'), bootDither, (v) => {
        bootDither = v;
        recomputeFromSource();
    });

    refreshPreview();

    return el('div', {class: 'card form-card'},
        el('h3', {class: 'card-title'}, t('bootImageTitle'), tag),
        el('p', {class: 'muted'}, t('bootImageIntro')),
        canvas,
        el('div', {class: 'fields'},
            field(t('bootImageFit'), fitSelect),
            ditherCheck),
        el('div', {class: 'id-sources', style: 'margin-top:8px'},
            button(t('bootImageChoose'), 'open', () => fileInput.click(), 'primary'),
            presetBtn,
            resetBtn,
            fileInput));
}

function viewGeneral(main) {
    const g = codeplug.general;
    const info = radio ? [
        [t('model'), 'Baofeng DM-32'],
        [t('firmware'), firmwareRelease(radio.git) ? `${firmwareRelease(radio.git)} (${radio.git})` : radio.git],
        [t('buildTime'), buildTime(radio.build)],
        [t('flashId'), '0x' + radio.flashId.toString(16).toUpperCase()],
    ] : null;
    main.append(pageHead(t('general')),
        el('div', {class: 'general-cards'},
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('identity')),
                el('div', {class: 'fields'},
                    field(t('callsign'), nameInput(g.callsign, 8, (v) => (g.callsign = v.toUpperCase()))),
                    field(t('dmrId'), valueInput(g.dmrId, (v) => (g.dmrId = v), intRange(0, 16777215))),
                    field(t('nxdnId'), valueInput(g.nxdnId || '', (v) => (g.nxdnId = v || 0),
                        (s) => (s === '' ? 0 : intRange(1, 65535)(s)), (v) => v || ''), {help: 'helpNxdnId'}))),
            bootImageCard(),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('radioInfo')),
                info ? el('dl', {class: 'info'}, info.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))
                    : el('p', {class: 'muted'}, t('notConnected'))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, 'OpenDMR CPS'),
                el('dl', {class: 'info'}, el('dt', {}, t('version')), el('dd', {}, 'v' + VERSION)))));
}

/* ---- the DMR ID database (not in the codeplug: written to the radio on its own) ---- */

const ID_WRITE_SPEED = 9000;   // the old format: bytes a second over the cable (measured: 300 KB in 32 s)
const ODDB_WRITE_SPEED = 18000; // ours, at 750000 baud (measured with id_db.py: 3.5 MB in about 3 minutes)
let dmrDb = null; // the ID list loaded: {entries, source}
// prefixes: the IDs kept; textLength / withCity: the OpenGD77 format for a firmware before 0.4.0, its CPS's defaults
// (not shown: our format has neither)
const dmrIdOptions = {textLength: DMR.DEFAULT_TEXT_LENGTH, withCity: false, prefixes: ''};
let dmrIdBusy = false;
let oddbCache = null; // {key, db, error}: our database of the list and prefixes (built in a few seconds)

async function loadDmrIds(file) {
    status(t('idReading'));
    try {
        const text = await file.text();
        let entries;
        try {
            entries = DMR.parseCsv(text);
        } catch (e) {
            throw new Error(t('idBadCsv'));
        }
        dmrDb = {entries, source: file.name};
        oddbCache = null;
        status(`${t('idLoaded')} ${entries.length} ${t('idEntries')}`);
    } catch (e) {
        toast(`${t('error')}: ${e.message}`, 10000);
        status(t('error'));
    } finally {
        progress(0, 0);
    }
    render();
}

function dmrIdPrefixes() {
    return dmrIdOptions.prefixes.split(/[\s,;]+/).filter((p) => /^\d+$/.test(p));
}

// Our database of the list (firmware 0.4.0 and later): built once for the list and the prefixes
function oddbPlan() {
    if (!dmrDb) {
        return null;
    }
    const prefixes = dmrIdPrefixes();
    const key = prefixes.join(' ');
    if (oddbCache?.key !== key || oddbCache.list !== dmrDb) {
        const entries = prefixes.length
            ? dmrDb.entries.filter((e) => prefixes.some((p) => String(e.id).startsWith(p))) : dmrDb.entries;
        const rows = ODDB.records(entries);
        oddbCache = {key, list: dmrDb, rows, db: null, error: null};
        try {
            oddbCache.db = rows.length ? ODDB.build(rows) : null;
        } catch (e) {
            oddbCache.error = e.message;
        }
    }
    return oddbCache;
}

// The old format (OpenGD77's, for a firmware before 0.4.0)
function dmrIdPlan() {
    const o = dmrIdOptions;
    const chosen = dmrDb ? DMR.select(dmrDb.entries, dmrIdPrefixes()) : [];
    const cap = DMR.capacity(o.textLength);
    const count = Math.min(chosen.length, cap);
    const bytes = DMR.HEADER + (count * DMR.recordLength(o.textLength));
    return {chosen, cap, count, bytes, minutes: Math.max(1, Math.round(bytes / ID_WRITE_SPEED / 60))};
}

const oddbMinutes = (db) => Math.max(1, Math.round((db.body.length + db.header.length) / ODDB_WRITE_SPEED / 60));

// Ours: the radio's CRC of each sector first, only the changed ones written; the header blanked first and written
// last, so the radio never reads half of it
async function writeOddb(db) {
    const sectors = ODDB.sectors(db);
    const header = sectors.pop();
    status(t('idSpeed'));
    const baud = await link.speedUp(ODDB.HEADER_AT);
    status(`${t('idComparing')} (${baud} baud)`);
    const changed = [];
    for (let i = 0; i < sectors.length; i++) {
        const s = sectors[i];
        if ((await link.sectorCrc(s.sector * ODDB.SECTOR)) !== ODDB.crc32(s.data)) {
            changed.push(s);
        }
        progress(i + 1, sectors.length);
    }
    const headerSame = (await link.sectorCrc(ODDB.HEADER_AT)) === ODDB.crc32(header.data);
    if (changed.length || !headerSame) {
        const all = changed.length + 2;
        const put = async (s, n) => {
            await link.writeVerifiedSector(s.sector, s.data, (baud) => {
                status(t('idRetrySlower').replace('{baud}', baud));
            });
            progress(n, all);
            status(`${t('idWriting')} ${Math.floor(100 * n / all)}% (${link.baud} baud)`);
        };
        await put({sector: header.sector, data: new Uint8Array(ODDB.SECTOR).fill(0xFF)}, 1); // no database meanwhile
        for (let i = 0; i < changed.length; i++) {
            await put(changed[i], i + 2);
        }
        await put(header, all);
    }
    return changed.length;
}

async function writeOldFormat(plan) {
    const o = dmrIdOptions;
    const db = DMR.build(plan.chosen, o.textLength, o.withCity);
    for (let i = 0; i < db.sectors.length; i++) {
        await link.writeSector(db.sectors[i].sector, db.sectors[i].data);
        progress(i + 1, db.sectors.length);
        status(`${t('idWriting')} ${Math.floor(100 * (i + 1) / db.sectors.length)}% (${link.baud} baud)`);
    }
    return db.count;
}

async function writeDmrIds() {
    if (!online() || !dmrDb || dmrIdBusy) {
        return;
    }
    dmrIdBusy = true;
    let transferStarted = false;
    $('btnRead').disabled = true;
    $('btnWrite').disabled = true;
    render();
    try {
        // the firmware: 0.4.0 and later answer 'D' 'K' and read our database
        const ours = (await link.sectorCrc(ODDB.HEADER_AT)) !== null;
        if (ours) {
            const plan = oddbPlan();
            if (!plan?.db) {
                throw new Error(plan?.error ?? t('idNone'));
            }
            if (!window.confirm(t('idWriteConfirmNew').replace('{n}', plan.db.records).replace('{m}', oddbMinutes(plan.db)))) {
                return;
            }
            transferStarted = true;
            const written = await writeOddb(plan.db);
            status(`${t('idWritten')}: ${plan.db.records} ${t('idEntries')} (${written} ${t('idSectorsChanged')})`);
        } else {
            const plan = dmrIdPlan();
            if (!plan.count) {
                return;
            }
            if (!window.confirm(t('idWriteConfirmOld').replace('{n}', plan.count).replace('{m}', plan.minutes))) {
                return;
            }
            transferStarted = true;
            const count = await writeOldFormat(plan);
            status(`${t('idWritten')}: ${count} ${t('idEntries')}`);
        }
        toast(t('idWritten'));
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        status(t('error'));
    } finally {
        progress(0, 0);
        try {
            if (transferStarted && online()) {
                await link.speedDown(); // the radio is back at 115200 by itself after 5 s of quiet
                await link.closeScreen();
            }
        } catch (e) {
            // the port went away
        }
        dmrIdBusy = false;
        setConnected(!!link?.connected); // the buttons back, the page redrawn
    }
}

function viewDmrIds(main) {
    const o = dmrIdOptions;
    const old = dmrIdPlan();
    const plan = oddbPlan();
    const db = plan?.db;
    const fileInput = el('input', {type: 'file', accept: '.csv,text/csv', hidden: true});
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) {
            loadDmrIds(fileInput.files[0]);
        }
    });
    // as the radio shows a caller: the callsign, the name, the city and state, the country
    const shown = (r) => [r[1], r[2], [r[3], r[4]].filter((s) => s).join(', '), r[5]].filter((s) => s).join(' · ');
    const rows = plan?.rows ?? [];
    const mine = rows.find((r) => r[0] === codeplug.general.dmrId);
    const samples = [...(mine ? [mine] : []), ...rows.filter((r) => r !== mine).slice(0, mine ? 4 : 5)];
    const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
    const prefixInput = el('input', {value: o.prefixes, placeholder: '302 310', spellcheck: false});
    prefixInput.addEventListener('change', () => {
        o.prefixes = prefixInput.value.trim();
        render();
    });
    main.append(pageHead(t('dmrIds')),
        el('div', {class: 'general-cards'},
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('idSource')),
                el('p', {class: 'muted'}, t('idIntro')),
                el('div', {class: 'id-sources'},
                    button(t('idDownload'), 'download', () => window.open(DMR.RADIOID_CSV, '_blank', 'noopener')),
                    button(t('idOpenCsv'), 'open', () => fileInput.click(), 'primary'),
                    fileInput),
                el('p', {class: 'id-loaded'}, dmrDb ? `${dmrDb.entries.length} ${t('idEntries')} · ${dmrDb.source}`
                    : t('idNone'))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('idOptions')),
                el('div', {class: 'fields'}, field(t('idPrefixes'), prefixInput)),
                el('p', {class: 'muted id-hint'}, t('idPrefixHint'))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('idSummary')),
                dmrDb ? el('dl', {class: 'info'},
                    el('dt', {}, t('idSelected')), el('dd', {}, db ? db.records : '–'),
                    el('dt', {}, t('idCountries')), el('dd', {}, db ? db.countries : '–'),
                    el('dt', {}, t('idSize')), el('dd', {}, db ? mb(db.body.length + db.header.length) : '–'),
                    el('dt', {}, t('idTime')), el('dd', {}, db ? t('idMinutesNew').replace('{m}', oddbMinutes(db)) : '–'))
                    : el('p', {class: 'id-next'}, t('idNoListYet')),
                plan?.error ? el('p', {class: 'id-warn'}, `${plan.error} ${t('idFewerCountries')}`) : null,
                samples.length ? el('div', {class: 'id-preview'},
                    el('div', {class: 'muted'}, t('idPreview')),
                    samples.map((r) => el('div', {class: 'id-sample'}, el('span', {class: 'dim'}, r[0]), ' ', shown(r))))
                    : null,
                el('div', {class: 'id-write'},
                    el('button', {class: 'primary', disabled: !online() || dmrIdBusy || !dmrDb || (!db && !old.count),
                        onclick: writeDmrIds}, icon('upload'), t('idWrite')),
                    online() ? null : el('span', {class: 'muted'}, t('idConnectFirst'))),
                el('p', {class: 'muted id-hint'}, t('idFirmwareNote')))));
}

/* ---- the radio's own settings (its menus) ---- */

let settingsGroup = GROUPS[0].key; // the group the Radio settings page shows

function viewRadioSettings(main) {
    const s = codeplug.settings;
    const l = language();
    const label = (x) => {
        if (!Array.isArray(x)) return x;
        if (l === 'zh') return x[1];
        if (l === 'es') return x[2] ?? x[0];
        return x[0];
    };
    const groupName = (g) => (l === 'zh' ? g.zh : (l === 'es' ? (g.es ?? g.en) : g.en));
    // one group at a time, chosen in the page head
    const seg = el('span', {class: 'sms-seg'},
        ...GROUPS.map((g) => el('button', {class: settingsGroup === g.key ? 'on' : '', onclick: () => {
            settingsGroup = g.key;
            render();
        }}, groupName(g))));
    main.append(pageHead(t('radioSettings'), s.valid ? seg : null));
    if (!s.valid) {
        main.append(el('div', {class: 'card empty'}, t('settingsInvalid')));
        return;
    }
    const grid = el('div', {class: 'settings-page'});
    const controls = [];

    function control(item) {
        const value = s.get(item.id);
        if (item.language) { // a code: English or a language file in the radio (the Languages page)
            return select(languageChoices(value), value, (v) => change(item, v));
        }
        if (item.c) {
            return select(item.c.map(([v, en, cn, es]) => [v, l === 'zh' ? cn : (l === 'es' ? (es ?? en) : en)]), value, (v) => change(item, +v));
        }
        if (item.input || !item.f) {
            const [lo, hi] = item.n;
            return valueInput(value, (v) => change(item, v), intRange(lo, hi));
        }
        const [lo, hi] = item.n;
        const options = [];
        for (let v = lo; v <= hi; v++) {
            options.push([v, label(item.f(v))]);
        }
        return select(options, value, (v) => change(item, +v));
    }

    function change(item, v) {
        s.set(item.id, v);
        refresh();
    }

    function refresh() { // what applies depends on other settings; the minimum brightness may have moved
        for (const {item, row, box} of controls) {
            const ok = s.applies(item);
            row.classList.toggle('na', !ok);
            box.replaceChildren(ok ? control(item) : el('span', {class: 'na-text'}, t('na')));
            if (ok && item.id === 'txPower') { // the default power into every channel and both VFOs
                box.append(button(t('applyToAll'), null, () => {
                    const level = s.get('txPower') + 1;
                    const label = POWER_LEVELS[level - 1];
                    if (!confirm(`${t('applyToAllAsk')} ${label}?`)) {
                        return;
                    }
                    codeplug.channels.forEach((ch) => (ch.power = level));
                    codeplug.vfos.forEach((v) => (v.power = level));
                    toast(`${t('applyToAllDone')} ${label}: ${codeplug.channels.length} ${t('channels')} + VFO A / B`);
                }, 'ghost'));
            }
        }
    }

    for (const g of GROUPS.filter((x) => x.key === settingsGroup)) {
        const rows = el('div', {class: 'set-rows'});
        for (const item of g.items) {
            const box = el('div', {class: 'set-control'});
            const row = el('div', {class: 'set-row'}, el('label', {}, l === 'zh' ? item.zh : (l === 'es' ? (item.es ?? item.en) : item.en)), box);
            controls.push({item, row, box});
            rows.append(row);
        }
        grid.append(el('div', {class: 'card set-card'}, el('div', {class: 'card-head'}, el('h3', {}, groupName(g))), rows));
    }
    main.append(el('div', {class: 'settings-scroll'}, grid));
    refresh();
}

/* ---- the radio's interface languages and fonts (OpenDMR docs/i18n.md) ---- */

// The files the user chose (the languages folder of opendmr-languages: zh.json, es.json, cjk.bin ..., or single files). {languages: [{file, doc, errors, warnings, ticked}], fonts: [{file, bytes, name, error}]}
let langSet = null;
let radioLangs = null; // what the radio has: {slots: [header or null] x 8, fonts: [directory entries]}; null: not read
let langBusy = false;

function loadLangFiles(files) { // {file name: Uint8Array}
    const english = files['en.json'] ? JSON.parse(new TextDecoder().decode(files['en.json'])) : null;
    const set = {languages: [], fonts: []};
    for (const [file, bytes] of Object.entries(files)) {
        if (/\.json$/i.test(file) && file !== 'en.json') {
            let doc = null;
            let result;
            try {
                doc = JSON.parse(new TextDecoder().decode(bytes));
                result = LG.checkLanguage(doc, english);
            } catch (e) {
                result = {errors: [e.message], warnings: []};
            }
            set.languages.push({file, doc, ...result,
                ticked: !result.errors.length && LG.DEFAULT_TICKED.includes(doc?.code)});
        } else if (/\.bin$/i.test(file)) {
            set.fonts.push({file, bytes, ...LG.checkFont(bytes)});
        }
    }
    set.languages.sort((a, b) => a.file.localeCompare(b.file));
    return set;
}

async function pickLangFiles(fileList) {
    const files = {};
    for (const f of fileList) {
        if (/\.(json|bin)$/i.test(f.name)) {
            files[f.name] = new Uint8Array(await f.arrayBuffer());
        }
    }
    langSet = loadLangFiles(files);
    render();
}

async function readRadioLangs() {
    const slots = [];
    for (let i = 0; i < LG.SLOTS; i++) {
        const h = await link.readLanguageArea(LG.LANGUAGE_ADDRESS + (i * LG.SLOT_SIZE), 92);
        if (h === null) {
            return null; // a firmware before language files
        }
        slots.push(LG.parseSlotHeader(h, i));
    }
    const dir = await link.readLanguageArea(LG.FONT_DIRECTORY, 12 + (LG.FONTS_MAX * 20));
    return {slots, fonts: LG.parseDirectory(dir)};
}

async function refreshRadioLangs() {
    if (!online() || langBusy) {
        return;
    }
    langBusy = true;
    try {
        radioLangs = await readRadioLangs();
        if (radioLangs === null) {
            radioLangs = {old: true, slots: [], fonts: []};
        }
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
    } finally {
        langBusy = false;
        render();
    }
}

// The radio's languages for the settings page's list: English, the ones in the radio, the one set
function languageChoices(current) {
    const out = new Map([['en', 'English']]);
    for (const s of radioLangs?.slots ?? []) {
        if (s && !out.has(s.code)) {
            out.set(s.code, s.name || s.englishName);
        }
    }
    for (const [code, name] of Object.entries(LG.NAMES)) {
        if (!out.has(code)) {
            out.set(code, name);
        }
    }
    if (!out.has(current)) {
        out.set(current, current);
    }
    return [...out];
}

async function writeSectors(address, data, done, total) {
    for (let at = 0; at < data.length; at += LG.SECTOR) {
        await link.writeVerifiedSector((address + at) / LG.SECTOR, data.subarray(at, at + LG.SECTOR), (baud) => {
            status(t('idRetrySlower').replace('{baud}', baud));
        }, true);
        done.n += 1;
        progress(done.n, total);
        status(`${t('langWriting')} ${Math.floor(100 * done.n / total)}% (${link.baud} baud)`);
    }
}

async function writeLanguages() {
    if (!online() || langBusy || !langSet) {
        return;
    }
    const chosen = langSet.languages.filter((l) => l.ticked && !l.errors.length);
    if (!chosen.length) {
        return;
    }
    langBusy = true;
    let started = false;
    $('btnRead').disabled = true;
    $('btnWrite').disabled = true;
    render();
    try {
        const now = await readRadioLangs(); // at 115200: long replies are not safe faster on some cables
        if (now === null) {
            throw new Error(t('langOldFirmware'));
        }
        // the fonts the chosen languages need, unless the radio has the same
        let fonts = now.fonts;
        const fontJobs = [];
        const lacking = chosen.filter((l) => l.doc.font && !fonts.some((f) => f.name === l.doc.font) &&
            !langSet.fonts.some((f) => f.name === l.doc.font && !f.error));
        if (lacking.length && !window.confirm(lacking.map((l) => t('langFontAsk').replace('{lang}', l.doc.name)
            .replaceAll('{font}', `${l.doc.font}.bin`)).join('\n'))) {
            return;
        }
        for (const name of new Set(chosen.map((l) => l.doc.font).filter((f) => f))) {
            const file = langSet.fonts.find((f) => f.name === name && !f.error);
            const there = fonts.find((f) => f.name === name);
            if (!file) {
                continue;
            }
            if (!there || there.length !== file.bytes.length || there.crc !== ODDB.crc32(file.bytes)) {
                fontJobs.push(file);
            }
        }
        // the languages: into the slot of the same code, else an empty one; left when the radio has the same
        const slots = [...now.slots];
        const langJobs = [];
        for (const l of chosen) {
            const data = LG.buildSlot(l.doc);
            const crc = new DataView(data.buffer).getUint32(12, true);
            let slot = slots.findIndex((s) => s?.code === l.doc.code);
            if (slot >= 0 && slots[slot].length === data.length && slots[slot].crc === crc) {
                continue;
            }
            if (slot < 0) {
                slot = slots.findIndex((s) => !s);
            }
            if (slot < 0) {
                throw new Error(t('langNoSlot'));
            }
            slots[slot] = {code: l.doc.code};
            langJobs.push({slot, data: LG.pad(data)});
        }
        const total = fontJobs.reduce((n, f) => n + (LG.pad(f.bytes).length / LG.SECTOR) + 2, 0) +
            langJobs.reduce((n, j) => n + (j.data.length / LG.SECTOR), 0);
        if (!total) {
            toast(t('langUpToDate'));
            return;
        }
        started = true;
        const done = {n: 0};
        await link.speedUp(0);
        for (const f of fontJobs) {
            // out of the directory while it is rewritten: the radio does not draw from half a font
            fonts = fonts.filter((x) => x.name !== f.name);
            await writeSectors(LG.FONT_DIRECTORY, LG.buildDirectory(fonts), done, total);
            const address = LG.placeFont(fonts, f.bytes.length);
            if (address === null) {
                throw new Error(t('langNoRoom').replaceAll('{font}', f.name));
            }
            await writeSectors(address, LG.pad(f.bytes), done, total);
            fonts = [...fonts, {name: f.name, address, length: f.bytes.length, crc: ODDB.crc32(f.bytes)}];
            await writeSectors(LG.FONT_DIRECTORY, LG.buildDirectory(fonts), done, total);
        }
        for (const j of langJobs) {
            // the header's sector last: cut half way, the slot is not used
            const address = LG.LANGUAGE_ADDRESS + (j.slot * LG.SLOT_SIZE);
            await writeSectors(address + LG.SECTOR, j.data.subarray(LG.SECTOR), done, total);
            await writeSectors(address, j.data.subarray(0, LG.SECTOR), done, total);
        }
        await link.reloadLanguages();
        status(t('langWritten'));
        toast(t('langWritten'));
    } catch (e) {
        toast(t('error') + ': ' + e.message, 8000);
        status(t('error'));
    } finally {
        progress(0, 0);
        try {
            if (started && online()) {
                await link.speedDown();
                await link.closeScreen();
            }
            if (online()) {
                radioLangs = await readRadioLangs() ?? {old: true, slots: [], fonts: []};
            }
        } catch (e) {
            // the port went away
        }
        langBusy = false;
        setConnected(!!link?.connected);
    }
}

async function deleteFromRadio(kind, what) {
    if (!online() || langBusy || !window.confirm(t('langDeleteAsk').replace('{name}', what))) {
        return;
    }
    langBusy = true;
    render();
    try {
        if (kind === 'language') {
            const s = radioLangs.slots.find((x) => x?.code === what);
            await link.writeVerifiedSector((LG.LANGUAGE_ADDRESS + (s.slot * LG.SLOT_SIZE)) / LG.SECTOR,
                new Uint8Array(LG.SECTOR).fill(0xFF), null, true);
        } else {
            await link.writeVerifiedSector(LG.FONT_DIRECTORY / LG.SECTOR,
                LG.buildDirectory(radioLangs.fonts.filter((f) => f.name !== what)), null, true);
        }
        await link.reloadLanguages();
        await link.closeScreen();
        radioLangs = await readRadioLangs();
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
    } finally {
        langBusy = false;
        render();
    }
}

function viewLanguages(main) {
    if (!langSet) {
        langSet = loadLangFiles({}); // the user chooses the languages folder of opendmr-languages
    }
    if (online() && !radioLangs && !langBusy) {
        refreshRadioLangs();
    }
    const folderInput = el('input', {type: 'file', webkitdirectory: true, hidden: true});
    const filesInput = el('input', {type: 'file', accept: '.json,.bin', multiple: true, hidden: true});
    for (const input of [folderInput, filesInput]) {
        input.addEventListener('change', () => pickLangFiles(input.files));
    }
    const fontState = (name) => {
        if (!name) {
            return t('langNoFontNeeded');
        }
        if (radioLangs?.fonts.some((f) => f.name === name)) {
            return `${t('langFont')} ${name}: ${t('langFontInRadio')}`;
        }
        return langSet.fonts.some((f) => f.name === name && !f.error) ? `${t('langFont')} ${name}: ${t('langFontWritten')}`
            : `${t('langFont')} ${name}: ${t('langFontNotHere')}`;
    };
    // needs a font the radio does not have and none was chosen: written, it shows "??"
    const fontLacking = (name) => !!name && !radioLangs?.fonts.some((f) => f.name === name) &&
        !langSet.fonts.some((f) => f.name === name && !f.error);
    const fontWarning = (doc) => (fontLacking(doc.font) ?
        el('p', {class: 'id-warn'}, t('langFontAsk').replace('{lang}', doc.name).replaceAll('{font}', `${doc.font}.bin`)) : null);
    const rows = langSet.languages.map((l) => el('div', {class: 'lang-row'},
        check(l.doc ? `${l.doc.name} · ${l.doc.english_name} (${l.doc.code})` : l.file, l.ticked && !l.errors.length, (v) => {
            l.ticked = v;
            render();
        }),
        el('div', {class: 'muted'}, l.errors.length ? l.errors.slice(0, 3).join('; ') :
            [`${Object.keys(l.doc.strings).length} ${t('langStrings')}`, fontState(l.doc.font), ...l.warnings.slice(0, 1)].join(' · ')),
        (l.ticked && !l.errors.length) ? fontWarning(l.doc) : null));
    for (const f of langSet.fonts.filter((x) => x.error)) {
        rows.push(el('div', {class: 'lang-row'}, el('div', {}, f.file), el('div', {class: 'muted'}, f.error)));
    }
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    const used = (radioLangs?.fonts ?? []).reduce((n, f) => n + LG.pad(new Uint8Array(f.length)).length, 0);
    const inRadio = radioLangs?.old ? el('p', {class: 'id-warn'}, t('langOldFirmware')) : radioLangs ? el('div', {},
        el('div', {class: 'lang-row'}, el('div', {}, 'English'), el('div', {class: 'muted'}, t('langBuiltIn'))),
        ...radioLangs.slots.filter((s) => s).map((s) => el('div', {class: 'lang-row'},
            el('div', {}, `${s.name} · ${s.englishName} (${s.code})`,
                iconButton('trash', t('delete'), () => deleteFromRadio('language', s.code), 'ghost')),
            el('div', {class: 'muted'}, `${s.count} ${t('langStrings')}` + (s.font ? ` · ${fontState(s.font)}` : '')),
            (s.font && !radioLangs.fonts.some((f) => f.name === s.font)) ?
                el('p', {class: 'id-warn'}, t('langFontAsk').replace('{lang}', s.name).replaceAll('{font}', `${s.font}.bin`)) : null)),
        ...radioLangs.fonts.map((f) => el('div', {class: 'lang-row'},
            el('div', {}, `${t('langFont')} ${f.name}`, iconButton('trash', t('delete'), () => deleteFromRadio('font', f.name), 'ghost')),
            el('div', {class: 'muted'}, kb(f.length)))),
        el('p', {class: 'muted'}, `${t('langSpace')}: ${kb(used)} / ${kb(LG.FONT_END - LG.FONT_ADDRESS)}`))
        : el('p', {class: 'muted'}, online() ? t('langReading') : t('idConnectFirst'));
    main.append(pageHead(t('languages')),
        el('div', {class: 'general-cards'},
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('langFiles')),
                el('p', {class: 'muted'}, langSet.languages.length ? t('langIntro') : t('langNoFiles')),
                rows.length ? el('div', {class: 'lang-list'}, rows) : null,
                el('div', {class: 'id-sources'},
                    button(t('langPickFolder'), 'open', () => folderInput.click()),
                    button(t('langPickFiles'), 'open', () => filesInput.click(), 'ghost'),
                    folderInput, filesInput),
                el('div', {class: 'id-write'},
                    el('button', {class: 'primary', disabled: !online() || langBusy ||
                        !langSet.languages.some((l) => l.ticked && !l.errors.length) || radioLangs?.old,
                    onclick: writeLanguages}, icon('upload'), t('langWrite')),
                    online() ? null : el('span', {class: 'muted'}, t('idConnectFirst'))),
                el('p', {class: 'muted id-hint'}, t('langHint'))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('langInRadio')),
                inRadio,
                online() ? button(t('langReadRadio'), 'download', () => {
                    radioLangs = null;
                    refreshRadioLangs();
                }, 'ghost') : null)));
}

/* ---- scan lockouts (OpenDMR: * held on a scan, the quick menu's Scan lockout, the main menu's list) ---- */

function lockedChannels() {
    return codeplug.channels.filter((ch) => ch.zoneSkip || ch.allSkip);
}

function viewLockouts(main) {
    const input = el('input', {placeholder: '144.10000', spellcheck: false, class: 'lockout-input'});
    const add = () => {
        const hz = parseMhz(input.value);
        if (hz === null) {
            toast(t('lockoutBadFrequency'));
            return;
        }
        if (codeplug.lockouts.includes(hz)) {
            toast(t('lockoutAlready'));
            return;
        }
        if (codeplug.lockouts.length >= LOCKOUTS_MAX) {
            toast(t('lockoutFull').replace('{n}', LOCKOUTS_MAX));
            return;
        }
        codeplug.lockouts.push(hz);
        codeplug.lockouts.sort((a, b) => a - b);
        codeplug.lockoutsDirty = true;
        render();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            add();
        }
    });
    const freqRows = codeplug.lockouts.map((hz) => el('div', {class: 'lockout-row'},
        el('span', {class: 'lockout-freq'}, mhz(hz) + ' MHz'),
        button(t('unlock'), 'x', () => {
            codeplug.lockouts = codeplug.lockouts.filter((f) => f !== hz);
            codeplug.lockoutsDirty = true;
            render();
        }, 'ghost')));
    const channels = lockedChannels();
    const channelRows = channels.map((ch) => el('div', {class: 'lockout-row'},
        el('span', {class: 'lockout-freq'}, `${ch.number}  ${ch.name}`),
        el('span', {class: 'muted'}, [ch.zoneSkip ? t('zoneSkip') : null, ch.allSkip ? t('allSkip') : null]
            .filter((s) => s).join(' · ')),
        button(t('unlock'), 'x', () => {
            ch.zoneSkip = false;
            ch.allSkip = false;
            render();
        }, 'ghost')));
    main.append(pageHead(t('scanLockouts')),
        el('div', {class: 'general-cards'},
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, `${t('lockoutFrequencies')} (${codeplug.lockouts.length} / ${LOCKOUTS_MAX})`),
                el('p', {class: 'muted'}, t('lockoutFrequenciesHint')),
                freqRows.length ? el('div', {class: 'lockout-list'}, freqRows) : el('p', {class: 'muted'}, t('lockoutNone')),
                el('div', {class: 'lockout-add'}, input, button(t('lockoutAdd'), 'plus', add))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, `${t('lockoutChannels')} (${channels.length})`),
                el('p', {class: 'muted'}, t('lockoutChannelsHint')),
                channelRows.length ? el('div', {class: 'lockout-list'}, channelRows) : el('p', {class: 'muted'}, t('lockoutNone')))));
}

/* ---- text messages ---- */

let smsBox = 0; // the box shown: 0 the inbox, 1 the outbox
const smsSelected = new Set(); // the records ticked (their flash addresses)

function smsTime(seconds) {
    if (!seconds) {
        return '';
    }
    const d = new Date(seconds * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// who: the sender (inbox) or the receiver (outbox); a contact's name for its ID
function smsPeer(m) {
    if (m.mode === 1) {
        return m.peer || t('smsAll');
    }
    const id = (m.box === 0) ? m.src : m.dst;
    if (m.group && m.box === 1) {
        return 'TG ' + id;
    }
    const c = codeplug.contacts.find((x) => x.id === id);
    return c ? `${c.name} (${id})` : String(id);
}

function smsMode(m) {
    if (m.mode === 1) {
        return 'M17' + (m.group ? ' ' + t('smsAll') : '');
    }
    return 'DMR ' + (m.group ? 'TG ' + m.dst : t('smsPrivate'));
}

const SMS_STATUS = ['smsSending', 'smsSent', 'smsDelivered', 'smsFailed'];

function smsCsv() {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [['box', 'time', 'peer', 'mode', 'status', 'text'].join(',')];
    for (const [box, list] of [['inbox', codeplug.sms.inbox], ['outbox', codeplug.sms.outbox]]) {
        for (const m of list) {
            lines.push([box, smsTime(m.time), smsPeer(m), smsMode(m), box === 'outbox' ? t(SMS_STATUS[m.status & 3]) : '',
                m.text].map(q).join(','));
        }
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], {type: 'text/csv'});
    const a = el('a', {href: URL.createObjectURL(blob), download: (codeplug.general.callsign || 'radio') + '-sms.csv'});
    a.click();
    URL.revokeObjectURL(a.href);
}

function viewSms(main) {
    const list = smsBox === 0 ? codeplug.sms.inbox : codeplug.sms.outbox;
    for (const at of [...smsSelected]) { // ticks of the box shown only
        if (!list.some((m) => m.at === at)) {
            smsSelected.delete(at);
        }
    }
    const seg = el('span', {class: 'sms-seg'},
        ...[0, 1].map((b) => el('button', {class: smsBox === b ? 'on' : '', onclick: () => {
            smsBox = b;
            smsSelected.clear();
            render();
        }}, t(b === 0 ? 'smsInbox' : 'smsOutbox') + ' ' + (b === 0 ? codeplug.sms.inbox : codeplug.sms.outbox).length)));
    const del = button(t('smsDeleteSelected'), 'trash', () => {
        const box = smsBox === 0 ? codeplug.sms.inbox : codeplug.sms.outbox;
        for (const m of box.filter((x) => smsSelected.has(x.at))) {
            codeplug.smsDeletes.push(m);
        }
        const keep = box.filter((x) => !smsSelected.has(x.at));
        if (smsBox === 0) {
            codeplug.sms.inbox = keep;
        } else {
            codeplug.sms.outbox = keep;
        }
        smsSelected.clear();
        render();
        toast(t('smsDeletedWrite'));
    }, 'danger');
    del.disabled = smsSelected.size === 0;
    // the quick texts
    const presetRows = codeplug.sms.presets.map((text, i) => {
        const bytes = el('span', {class: 'sms-bytes'});
        const show = (v) => {
            bytes.textContent = v ? `${new TextEncoder().encode(v).length}/${SMS.PRESET_SIZE - 1}` : '';
        };
        const input = el('input', {value: text, placeholder: t('smsEmpty'), spellcheck: false});
        input.addEventListener('input', () => {
            let v = input.value;
            if (new TextEncoder().encode(v).length > SMS.PRESET_SIZE - 1) { // cut on a character
                v = new TextDecoder().decode(SMS.presetBytes(v));
                input.value = v;
            }
            codeplug.sms.presets[i] = v;
            codeplug.smsPresetsDirty = true;
            show(v);
        });
        show(text);
        return el('div', {class: 'sms-preset'}, el('span', {class: 'sms-n'}, String(i + 1)), input, bytes);
    });
    const used = codeplug.sms.presets.filter((p) => p).length;
    // the box
    const all = el('input', {type: 'checkbox', onchange: (e) => {
        smsSelected.clear();
        if (e.target.checked) {
            list.forEach((m) => smsSelected.add(m.at));
        }
        render();
    }});
    all.checked = list.length > 0 && smsSelected.size === list.length;
    const rows = list.map((m) => {
        const tick = el('input', {type: 'checkbox', onchange: (e) => {
            if (e.target.checked) {
                smsSelected.add(m.at);
            } else {
                smsSelected.delete(m.at);
            }
            render();
        }});
        tick.checked = smsSelected.has(m.at);
        return el('tr', {class: smsSelected.has(m.at) ? 'selected' : ''},
            el('td', {}, tick),
            el('td', {class: 'mono'}, smsTime(m.time)),
            el('td', {class: 'name'}, m.unread ? el('span', {class: 'sms-unread'}) : null, smsPeer(m)),
            el('td', {}, el('span', {class: 'sms-tag'}, smsMode(m))),
            smsBox === 1 ? el('td', {class: 'sms-status-' + (m.status & 3)}, t(SMS_STATUS[m.status & 3])) : null,
            el('td', {class: 'sms-text'}, m.text));
    });
    const head = ['', 'smsTime', smsBox === 0 ? 'smsFrom' : 'smsTo', 'smsMode', smsBox === 1 ? 'smsStatus' : null, 'smsText']
        .filter((k) => k !== null).map((k, i) => el('th', i === 0 ? {style: 'width:28px'} : {}, i === 0 ? all : t(k)));
    main.append(
        pageHead(t('sms'), seg, el('span', {class: 'spacer'}), button(t('smsExport'), 'save', smsCsv, 'ghost'), del),
        el('div', {class: 'sms-cols'},
            el('div', {class: 'card sms-presets'},
                el('div', {class: 'card-head'}, el('h3', {}, t('smsPresets') + ' ', el('span', {class: 'count'},
                    `${used} / ${SMS.PRESETS}`))),
                el('div', {class: 'sms-preset-list'}, ...presetRows),
                el('div', {class: 'sms-hint'}, t('smsPresetsHint'))),
            el('div', {class: 'card', style: 'min-width:0'},
                list.length ? el('div', {class: 'table-wrap'}, el('table', {class: 'grid'},
                    el('thead', {}, el('tr', {}, ...head)), el('tbody', {}, ...rows)))
                    : el('div', {class: 'sms-hint'}, t(smsBox === 0 ? 'smsInboxEmpty' : 'smsOutboxEmpty')))));
}

/* ---- satellites ---- */

const CTCSS_LIST = [670, 693, 719, 744, 770, 797, 825, 854, 885, 915, 948, 974, 1000, 1035, 1072, 1109, 1148, 1188,
    1230, 1273, 1318, 1365, 1413, 1462, 1514, 1567, 1598, 1622, 1655, 1679, 1713, 1738, 1773, 1799, 1835, 1862, 1899,
    1928, 1966, 1995, 2035, 2065, 2107, 2181, 2257, 2291, 2336, 2418, 2503, 2541];

function parseMhzAny(text) { // a satellite frequency: any value, not only the radio's bands
    const v = Math.round(parseFloat(text) * 1e5) * 10;
    return (Number.isFinite(v) && v > 0 && v < 4e9) ? v : null;
}

function satAgeDays(s) {
    const d = SAT.epochDate(s);
    return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
}

// Where the TLEs come from (the satellites page's choice, kept in the browser)
const tleSource = 'auto'; // AMSAT (through serve.py), then CelesTrak, then the TLE API

/* ---- debug: the radio's receive log (OpenDMR src/services/rx_log.h) ---- */

const RX_LOG_MAGIC = 0x314C5852; // "RXL1": a sector of the log
const RX_LOG_FILE = 'ODRXLOG1';
const RX_LOG_HEADER = 16;
const RX_LOG_STATES = ['rxLogOff', 'rxLogRecording', 'rxLogPaused', 'rxLogClearing', 'rxLogForeign', 'rxLogError'];
let rxLog = null;      // the last status
let rxLogBusy = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Where the records of a sector end in its first bytes: {end, done}; done: the end found (0xFF where a record would
// start, or the sector's end), else more bytes are needed
function rxLogEnd(bytes, sectorSize) {
    let i = RX_LOG_HEADER;
    for (;;) {
        if ((i + 6) > sectorSize) {
            return {end: i, done: true};
        }
        if ((i + 2) > bytes.length) {
            return {end: i, done: false};
        }
        const n = bytes[i + 1];
        if (bytes[i] === 0xFF || n < 6 || (i + n) > sectorSize) {
            return {end: i, done: true};
        }
        if ((i + n) > bytes.length) {
            return {end: i, done: false};
        }
        i += n;
    }
}

// A sector of the log up to its last record (1 KB reads as they are: records pack badly; the 0xFF after the last
// one not read)
async function rxLogReadSector(address) {
    const data = new Uint8Array(L.SECTOR);
    let got = 0;
    for (;;) {
        data.set(await link.readPlain(address + got, 1024), got);
        got += 1024;
        const e = rxLogEnd(data.subarray(0, got), L.SECTOR);
        if (e.done) {
            return data.slice(0, e.end);
        }
    }
}

// The sectors of the log: in one request ('D' 'L' 'h'), or each header read (the first firmware with the log)
async function rxLogFind(s) {
    try {
        return (await link.rxLogSectors(s.sectors)).map((seq, n) => (seq === null ? null : {n, seq}))
            .filter((x) => x);
    } catch (e) {
        if (e.message !== 'refused') {
            throw e;
        }
    }
    const found = [];
    for (let n = 0; n < s.sectors; n++) {
        const head = await link.readPacked(s.base + (n * L.SECTOR), RX_LOG_HEADER);
        const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
        if (v.getUint32(0, true) === RX_LOG_MAGIC) {
            found.push({n, seq: v.getUint32(4, true)});
        }
        progress(n + 1, s.sectors);
    }
    return found;
}

function rxLogError(e) {
    toast(e.message === 'refused' ? t('rxLogNoFirmware') : `${t('error')}: ${e.message}`, 6000);
}

async function rxLogDo(op, arg = null) {
    if (!online() || rxLogBusy) {
        return;
    }
    rxLogBusy = true;
    try {
        rxLog = await link.rxLog(op, arg);
    } catch (e) {
        rxLog = null;
        rxLogError(e);
    } finally {
        rxLogBusy = false;
        render();
    }
}

async function rxLogClear() {
    const yes = await dialog(t('rxLogClear'), el('p', {}, t('rxLogClearAsk')),
        [[t('rxLogClear'), true, 'primary'], [t('cancel'), false]]);
    if (!yes) {
        return;
    }
    await rxLogDo('c');
    // the erase takes a while (up to about 10 s)
    for (let i = 0; i < 60 && rxLog?.state === 3; i++) {
        await wait(500);
        await rxLogDo('s');
    }
}

// Paused, all of it in the flash, every sector of the log read (packed: an empty one costs a few bytes), resumed.
// The file: RX_LOG_FILE, the JSON length (u32 LE), JSON, then each sector oldest first: its length (u16 LE) and its
// bytes up to its last record (no 0xFF)
async function rxLogExport() {
    if (!online() || rxLogBusy) {
        return;
    }
    rxLogBusy = true;
    status(t('rxLogReading'));
    const sectors = [];
    let s = null;
    try {
        s = await link.rxLog('p', 1);
        for (let i = 0; i < 50 && s.pending > 0; i++) {
            await wait(100);
            s = await link.rxLog('s');
        }
        const found = await rxLogFind(s);
        if (found.length) {
            await link.speedUp(s.base + (found[0].n * L.SECTOR), true); // as the DMR IDs: up to 750000
            try {
                for (let i = 0; i < found.length; i++) {
                    const x = found[i];
                    sectors.push({seq: x.seq, data: await rxLogReadSector(s.base + (x.n * L.SECTOR))});
                    progress(i + 1, found.length);
                }
            } finally {
                await link.speedDown();
            }
        }
        s = await link.rxLog('p', 0);
    } catch (e) {
        await link.rxLog('p', 0).catch(() => {});
        rxLogError(e);
        status(t('error'));
        return;
    } finally {
        rxLogBusy = false;
        progress(0, 0);
    }
    rxLog = s;
    if (!sectors.length) {
        status(t('rxLogEmpty'));
        toast(t('rxLogEmpty'), 5000);
        render();
        return;
    }
    sectors.sort((a, b) => a.seq - b.seq);
    const now = new Date();
    const enc = new TextEncoder();
    const meta = enc.encode(JSON.stringify({
        cps: VERSION, firmware: radio ? `${radio.git} ${radio.build}` : '', callsign: codeplug.general.callsign,
        dmrId: codeplug.general.dmrId, read: now.toISOString(), dropped: s.dropped, sectors: sectors.length,
    }));
    const parts = [enc.encode(RX_LOG_FILE), new Uint8Array(new Uint32Array([meta.length]).buffer), meta];
    let bytes = 0;
    for (const x of sectors) {
        parts.push(new Uint8Array([x.data.length & 0xFF, x.data.length >> 8]), x.data);
        bytes += x.data.length;
    }
    const pad = (n) => String(n).padStart(2, '0');
    const name = `${codeplug.general.callsign || 'radio'}-rxlog-${now.getFullYear()}${pad(now.getMonth() + 1)}` +
        `${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.rxlog`;
    const a = el('a', {href: URL.createObjectURL(new Blob(parts, {type: 'application/octet-stream'})), download: name});
    a.click();
    URL.revokeObjectURL(a.href);
    status(t('rxLogSaved').replace('{name}', name).replace('{kb}', Math.max(1, Math.round(bytes / 1024))));
    render();
}

function viewDebug(main) {
    const connected = !!online();
    const st = rxLog;
    const off = !connected || rxLogBusy;
    main.append(pageHead(t('debug')),
        el('div', {class: 'general-cards'},
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('rxLog')),
                el('p', {class: 'muted'}, t('rxLogIntro')),
                el('dl', {class: 'info'},
                    el('dt', {}, t('rxLogRecord')), el('dd', {}, st ? t(st.enabled ? 'on' : 'off') : '–'),
                    el('dt', {}, t('rxLogState')), el('dd', {}, st ? t(RX_LOG_STATES[st.state] ?? 'error') : '–'),
                    el('dt', {}, t('rxLogDropped')), el('dd', {}, st ? String(st.dropped) : '–')),
                st?.state === 4 ? el('p', {class: 'id-warn'}, t('rxLogForeignHint')) : null,
                el('div', {class: 'id-sources'},
                    el('button', {class: 'primary', disabled: off, onclick: rxLogExport}, icon('download'), t('rxLogExport')),
                    el('button', {disabled: off || !st, onclick: () => rxLogDo('e', st?.enabled ? 0 : 1)},
                        icon('plug'), t(st?.enabled ? 'rxLogTurnOff' : 'rxLogTurnOn')),
                    el('button', {disabled: off, onclick: () => rxLogDo('s')}, icon('scan'), t('rxLogRefresh')),
                    el('button', {disabled: off, onclick: rxLogClear}, icon('trash'), t('rxLogClear'))),
                connected ? null : el('p', {class: 'muted'}, t('idConnectFirst')),
                el('p', {class: 'muted id-hint'}, t('rxLogHow')))));
    if (connected && !st && !rxLogBusy) {
        rxLogDo('s');
    }
}

// The TLEs of these satellites from the chosen source; auto: AMSAT (through serve.py), then CelesTrak's amateur group,
// then the TLE API one by one for those still missing (CelesTrak not asked one by one: it blocks an address that asks
// too often). Returns the notes: what failed ("name: reason"), sources refused, orbits too old
async function fetchTles(sats, progressText = t('updateTle')) {
    const notes = [];
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let rest = [...sats];
    const used = [];
    const take = (map, source) => {
        const before = rest.length;
        rest = rest.filter((s) => {
            const tle = s.catalog && map.get(s.catalog);
            if (tle) {
                Object.assign(s, SAT.fromTleLines(tle.line1, tle.line2));
                codeplug.satellitesDirty = true;
            }
            return !tle;
        });
        if (rest.length < before && !used.includes(source)) {
            used.push(source);
        }
        const text = `${progressText} ${sats.length - rest.length} / ${sats.length}`;
        status(text);
        const b = document.getElementById('satUpdate');
        if (b) {
            b.lastChild.textContent = text;
        }
    };
    status(`${progressText} …`);
    const auto = tleSource === 'auto';
    if (auto || tleSource === 'amsat') {
        try {
            take(await SAT.fetchAmsat(), 'AMSAT');
        } catch (e) {
            console.warn('AMSAT', e);
            if (!auto || !e.noServer) {
                notes.push(e.noServer ? t('amsatNeedsServer') : `AMSAT: ${e.message || e}`);
            }
        }
    }
    if (rest.length && (auto || tleSource === 'celestrak')) {
        try {
            take(await SAT.fetchAmateurGroup(), 'CelesTrak');
        } catch (e) {
            console.warn('CelesTrak', e);
            notes.push((/HTTP 403|Failed to fetch|NetworkError/.test(e.message)) ? t('celestrakBlocked') : `${t('celestrakDown')}: ${e.message || e}`);
        }
    }
    if (rest.length && (auto || tleSource === 'tleapi')) {
        for (const s of [...rest]) {
            try {
                if (!s.catalog) {
                    throw new Error(t('noCatalog'));
                }
                take(new Map([[s.catalog, await SAT.fetchTleApi(s.catalog)]]), 'TLE API');
            } catch (e) {
                console.warn('TLE API', s.name, e);
            }
            await pause(250);
        }
    }
    for (const s of rest) {
        notes.push(`${s.name}: ${s.catalog ? t('tleNotFound') : t('noCatalog')}`);
    }
    const old = sats.filter((s) => (satAgeDays(s) ?? 0) > 30).map((s) => `${s.name} (${satAgeDays(s)} ${t('days')})`);
    if (old.length) {
        notes.push(`${t('tleOld')}: ${old.join(', ')}`);
    }
    return notes;
}

// All the satellites of the chosen source's file (AMSAT, else CelesTrak's amateur group): Map catalog -> TLE
async function fetchTleCatalog() {
    const errors = [];
    const order = (tleSource === 'celestrak') ? ['celestrak'] : (tleSource === 'amsat') ? ['amsat'] : ['amsat', 'celestrak'];
    for (const src of order) {
        try {
            return (src === 'amsat') ? await SAT.fetchAmsat() : await SAT.fetchAmateurGroup();
        } catch (e) {
            if (src === 'amsat') {
                errors.push(e.noServer ? t('amsatNeedsServer') : `AMSAT: ${e.message}`);
            } else {
                errors.push((/HTTP 403|Failed to fetch|NetworkError/.test(e.message)) ? t('celestrakBlocked') : `CelesTrak: ${e.message}`);
            }
        }
    }
    throw new Error(errors.join('\n'));
}

// A short name for the radio (8 characters): the designation in brackets when there is one ("SAUDISAT 1C (SO-50)")
function shortSatName(name, catalog) {
    const inner = /\(([^)]+)\)/.exec(name);
    return (inner ? inner[1] : (name || catalog)).trim().slice(0, 8);
}

// The orbit file (all the amateur satellites with their TLE), fetched once when the satellites page opens:
// {map, time, sources} or {error}; null: not yet
let tleCatalog = null;
let tleLoading = null;

function orbitState(s) {
    const age = satAgeDays(s);
    if (age === null) {
        return 'none';
    }
    return (age <= 14) ? 'fresh' : 'old';
}

// The newer orbit of the file for the satellites that have one; true when one changed
function refreshOrbits(map) {
    let changed = false;
    for (const s of codeplug.satellites) {
        const x = s.catalog && map.get(s.catalog);
        if (x) {
            const fresh = SAT.fromTleLines(x.line1, x.line2);
            if (fresh.tle1 !== s.tle1 || fresh.tle2 !== s.tle2) {
                Object.assign(s, fresh);
                changed = true;
            }
        }
    }
    if (changed) {
        codeplug.satellitesDirty = true;
    }
    return changed;
}

async function loadTleCatalog() {
    tleLoading ??= (async () => {
        try {
            const map = await fetchTleCatalog();
            tleCatalog = {map, time: new Date()};
        } catch (e) {
            tleCatalog = {map: new Map(), error: e.message};
        }
        tleLoading = null;
    })();
    return tleLoading;
}

// Unticked satellites edited (catalog -> satellite): what they get once ticked
const satDrafts = new Map();

// The common satellites: the user's own list (kept in the browser) or our presets
let satList = SAT.loadList();
const commonSats = () => satList ?? SAT.PRESETS;

function setSatList(list) {
    satList = list;
    SAT.saveList(list);
}

// Tick the satellites to have in the radio: the common ones first (frequencies known), the others of the orbit file
// below. Orbits come by themselves (here, and again before writing); a name opens its editor
function viewSatellites(main) {
    let selected = null;
    let preview = null; // an unticked satellite clicked: its details, read only
    let filter = '';
    let presetOf = new Map(); // the common satellites by key (draw())
    const mhzOrEmpty = (hz) => (hz ? mhz(hz) : '');
    // catalog numbers are not stored in the radio: the presets give them by name
    for (const s of codeplug.satellites) {
        s.catalog ||= commonSats().find((p) => p.name === s.name)?.catalog ?? '';
    }
    const changed = () => {
        codeplug.satellitesDirty = true;
        $('countSatellites').textContent = codeplug.satellites.length || '';
    };
    const inRadio = (key) => codeplug.satellites.find((s) => SAT.satKey(s) === key);
    // an unticked satellite as it would go in: its preset or name, its orbit, what was edited of it
    const draftFor = (entry) => {
        if (!satDrafts.has(entry.catalog)) {
            const s = SAT.newSatellite(presetOf.get(entry.catalog) ?? {name: entry.short, catalog: entry.catalog});
            const x = tleCatalog?.map.get(entry.catalog);
            if (x) {
                Object.assign(s, SAT.fromTleLines(x.line1, x.line2));
            }
            satDrafts.set(entry.catalog, s);
        }
        return satDrafts.get(entry.catalog);
    };
    const putIn = (entry) => {
        if (codeplug.satellites.length >= SAT.SATELLITES_MAX) {
            toast(t('satFull'));
            return null;
        }
        const s = draftFor(entry);
        satDrafts.delete(entry.catalog);
        codeplug.satellites.push(s);
        changed();
        return s;
    };
    const box = el('div', {class: 'sat-page'});
    main.append(box);

    if (!tleCatalog) {
        loadTleCatalog().then(() => {
            refreshOrbits(tleCatalog.map);
            draw();
        });
    }

    function orbitLine() {
        if (!tleCatalog) {
            return el('span', {class: 'muted'}, t('orbitsLoading'));
        }
        if (tleCatalog.error) {
            return el('span', {class: 'warn-text'}, t('orbitsFailed'), ' ',
                el('a', {href: '#', onclick: (e) => {
                    e.preventDefault();
                    tleCatalog = null;
                    draw();
                    loadTleCatalog().then(() => {
                        refreshOrbits(tleCatalog.map);
                        draw();
                    });
                }}, t('retry')),
                el('span', {class: 'muted small', title: tleCatalog.error}, ' ⓘ'));
        }
        const old = codeplug.satellites.filter((s) => orbitState(s) !== 'fresh');
        return el('span', {class: old.length ? 'warn-text' : 'muted'},
            old.length ? `${t('orbitsSomeOld')}: ${old.map((s) => s.name).join(', ')}` :
                `${t('orbitsUpdatedAt')} ${tleCatalog.time.toLocaleTimeString().slice(0, 5)}`);
    }

    // One satellite of the table: ticked = in the radio
    function row(entry) {
        const sat = inRadio(entry.catalog);
        const preset = presetOf.get(entry.catalog);
        const known = sat ?? satDrafts.get(entry.catalog) ?? preset;
        const tick = el('input', {type: 'checkbox', checked: !!sat});
        tick.addEventListener('click', (e) => e.stopPropagation());
        tick.addEventListener('change', () => {
            if (tick.checked) {
                const s = putIn(entry);
                if (!s) {
                    tick.checked = false;
                    return;
                }
                selected = s;
                preview = null;
            } else {
                satDrafts.set(entry.catalog, sat); // its edits kept if ticked again
                codeplug.satellites = codeplug.satellites.filter((s) => s !== sat);
                if (selected === sat) {
                    selected = null;
                }
            }
            changed();
            draw();
        });
        let orbit;
        if (sat) {
            const state = orbitState(sat);
            const age = satAgeDays(sat);
            orbit = el('span', {class: 'orbit ' + state}, state === 'none' ? t('orbitNone') :
                (age === 0 ? t('today') : `${age} ${t('days')}`));
        } else {
            orbit = el('span', {class: 'muted small'}, tleCatalog?.map.has(entry.catalog) ? t('orbitAvailable') : '—');
        }
        const gone = sat && tleCatalog && !tleCatalog.error && sat.catalog && !tleCatalog.map.has(sat.catalog);
        const cell = (v) => el('td', {class: 'mono' + (sat ? '' : ' dim')}, v ? mhz(v) : '');
        const isSelected = sat ? (sat === selected) : (preview?.catalog === entry.catalog);
        return el('tr', {class: (sat ? 'on' : 'off') + (isSelected ? ' selected' : ''), onclick: () => {
            selected = sat ?? null;
            preview = sat ? null : entry;
            draw();
        }},
        el('td', {class: 'check-cell'}, tick),
        el('td', {class: 'name'}, sat?.name ?? entry.short),
        el('td', {class: 'dim small full-name'}, (entry.name && entry.name !== (sat?.name ?? entry.short)) ? entry.name : ''),
        cell(known?.voiceRx),
        cell(known?.voiceTx),
        el('td', {class: 'dim'}, known?.ctcss ? (known.ctcss / 10).toFixed(1) : ''),
        cell(known?.aprsRx),
        el('td', {}, orbit, gone ? el('span', {class: 'orbit old', title: t('goneLong'), style: 'margin-left:6px'}, t('gone')) : null),
        el('td', {class: 'mono dim'}, /^\d+$/.test(entry.catalog) ? entry.catalog : ''));
    }

    function draw() {
        const catalog = tleCatalog?.map ?? new Map();
        const f = filter.trim().toLowerCase();
        const match = (x) => !f || x.short.toLowerCase().includes(f) || (x.name ?? '').toLowerCase().includes(f) ||
            String(x.catalog).includes(f);
        presetOf = new Map(commonSats().map((p) => [SAT.satKey(p), p]));
        const common = commonSats().map((p) => ({catalog: SAT.satKey(p), short: p.name,
            name: (p.catalog && catalog.get(p.catalog)?.name) || ''}));
        // a satellite keeps its place when ticked: "mine" are only those the orbit file does not have
        const mine = codeplug.satellites.filter((s) => !presetOf.has(SAT.satKey(s)) && !catalog.has(s.catalog))
            .map((s) => ({catalog: SAT.satKey(s), short: s.name, name: ''}));
        const others = [...catalog.values()]
            .filter((x) => !presetOf.has(x.catalog))
            .map((x) => ({catalog: x.catalog, short: shortSatName(x.name, x.catalog), name: x.name}))
            .sort((a, b) => a.short.localeCompare(b.short));
        const group = (title, entries) => {
            const shown = entries.filter(match);
            return shown.length ? [el('tr', {class: 'group-row'}, el('td', {colspan: 9}, `${title} (${shown.length})`)),
                ...shown.map(row)] : [];
        };
        const drawer = el('div', {class: 'card drawer'});
        if (selected && codeplug.satellites.includes(selected)) {
            drawer.append(...satelliteEditor(selected));
        } else if (preview && !inRadio(preview.catalog)) {
            drawer.append(...satelliteEditor(draftFor(preview), preview));
        } else {
            drawer.append(el('div', {class: 'empty'}, t('satPickHint')));
        }
        const focused = document.activeElement?.classList?.contains('sat-search');
        const scrolled = box.querySelector('.table-wrap')?.scrollTop ?? 0; // kept across the redraw
        const drawerScrolled = box.querySelector('.drawer')?.scrollTop ?? 0;
        box.replaceChildren(
            pageHead(t('satellites'), el('span', {class: 'count-chip'},
                `${t('chosen')} ${codeplug.satellites.length} / ${SAT.SATELLITES_MAX}`)),
            el('p', {class: 'sat-intro'}, t('satIntro'), el('br'), orbitLine()),
            el('div', {class: 'work'},
                el('div', {class: 'card', style: 'flex:1;min-width:0'},
                    ...listTools(),
                    el('div', {class: 'table-wrap'},
                        el('table', {class: 'grid sat-table'},
                            el('thead', {}, el('tr', {}, el('th', {class: 'check-cell'}),
                                ...['name', 'fullName', 'downlink', 'uplink', 'CTCSS', 'APRS', 'orbit', 'catalog']
                                    .map((k) => el('th', {}, t(k))))),
                            el('tbody', {},
                                ...group(t('commonSats'), common),
                                ...group(t('mySats'), mine),
                                ...group(t('otherSats'), others))))),
                drawer));
        box.querySelector('.table-wrap').scrollTop = scrolled;
        box.querySelector('.drawer').scrollTop = drawerScrolled;
        if (focused) {
            const s = box.querySelector('.sat-search');
            s.focus();
            s.setSelectionRange(s.value.length, s.value.length);
        }
    }

    // Select all the common satellites (or none), and the list and orbits fetched again; then the common list's own
    // tools: a new satellite, the list imported, exported, back to ours
    function listTools() {
        const list = commonSats();
        const commonIn = list.filter((p) => inRadio(SAT.satKey(p)));
        const all = el('input', {type: 'checkbox', checked: commonIn.length === list.length});
        all.indeterminate = commonIn.length > 0 && commonIn.length < list.length;
        all.addEventListener('change', () => {
            if (all.checked) {
                for (const p of list) {
                    if (inRadio(SAT.satKey(p))) {
                        continue;
                    }
                    if (codeplug.satellites.length >= SAT.SATELLITES_MAX) {
                        toast(t('satFull'));
                        break;
                    }
                    const s = SAT.newSatellite(p);
                    const x = p.catalog && tleCatalog?.map.get(p.catalog);
                    if (x) {
                        Object.assign(s, SAT.fromTleLines(x.line1, x.line2));
                    }
                    codeplug.satellites.push(s);
                }
            } else {
                codeplug.satellites = codeplug.satellites.filter((s) => !presetOf.has(SAT.satKey(s)));
                if (selected && !codeplug.satellites.includes(selected)) {
                    selected = null;
                }
            }
            changed();
            draw();
        });
        const refresh = button(tleLoading ? t('orbitsLoading') : t('updateTle'), 'download', () => {
            tleCatalog = null;
            draw();
            loadTleCatalog().then(() => {
                refreshOrbits(tleCatalog.map);
                draw();
                toast(tleCatalog.error ? t('orbitsFailed') :
                    `${t('listRefreshed')}: ${tleCatalog.map.size} ${t('satsInFileShort')}`);
            });
        }, 'ghost');
        refresh.disabled = !!tleLoading;
        const search = el('input', {type: 'search', class: 'sat-search', placeholder: t('filter'), value: filter});
        search.addEventListener('input', () => {
            filter = search.value;
            draw();
        });
        const fileInput = el('input', {type: 'file', accept: '.json,application/json', hidden: true});
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) {
                return;
            }
            try {
                setSatList(SAT.parseListFile(await file.text()));
                toast(`${t('satListImported')}: ${satList.length}`);
            } catch (e) {
                toast(`${t('satListBad')}: ${e.message}`, 8000);
            }
            draw();
        });
        const newSat = button(t('newSat'), 'plus', () => {
            if (codeplug.satellites.length >= SAT.SATELLITES_MAX) {
                toast(t('satFull'));
                return;
            }
            let n = 1;
            while (inRadio(`NEW${n}`) || presetOf.has(`NEW${n}`)) {
                n++;
            }
            const s = SAT.newSatellite({name: `NEW${n}`});
            codeplug.satellites.push(s);
            changed();
            selected = s;
            preview = null;
            draw();
        }, 'ghost');
        const exportList = button(t('satListExport'), 'download', () => {
            const a = el('a', {href: URL.createObjectURL(new Blob([SAT.listFile(commonSats())], {type: 'application/json'})),
                download: 'opendmr-satellites.json'});
            a.click();
            URL.revokeObjectURL(a.href);
        }, 'ghost');
        const reset = satList ? button(t('satListReset'), null, () => {
            if (confirm(t('satListResetAsk'))) {
                setSatList(null);
                draw();
            }
        }, 'ghost') : null;
        return [
            el('div', {class: 'sat-tools'},
                el('label', {class: 'sat-all'}, all, t('selectAllCommon')),
                el('label', {class: 'search'}, icon('search'), search),
                el('span', {style: 'flex:1'}),
                tleCatalog && !tleCatalog.error ? el('span', {class: 'muted small'},
                    `${t('listOf')} ${tleCatalog.time.toLocaleTimeString().slice(0, 5)}`) : null,
                refresh),
            el('div', {class: 'sat-tools'},
                el('span', {class: 'muted small'}, satList ? t('satListMine') : t('satListOurs')),
                el('span', {style: 'flex:1'}),
                newSat, button(t('satListImport'), 'open', () => fileInput.click(), 'ghost'), exportList, reset,
                fileInput),
        ];
    }

    // The editor of one satellite: its frequencies, and a TLE of its own when no source has one
    function satelliteEditor(s, draft = null) {
        const tones = [[0, t('none')], ...CTCSS_LIST.map((v) => [v, (v / 10).toFixed(1)])];
        const tleBox = el('textarea', {rows: 3, spellcheck: false, placeholder: t('pasteTleOne')});
        const epoch = SAT.epochDate(s);
        const edit = () => {
            if (!draft) {
                changed(); // a draft is not in the radio: nothing to write yet
            }
        };
        const freq = (label, key) => field(label, valueInput(s[key], (v) => {
            s[key] = v;
            edit();
            draw();
        }, (x) => (x === '' ? 0 : parseMhzAny(x)), mhzOrEmpty));
        // the common list: this satellite put in it with what it has now (its TLE when no orbit file has it), or out
        const key = SAT.satKey(s);
        const listed = presetOf.has(key);
        const saveToList = () => {
            const entry = SAT.toListEntry(s, !(s.catalog && tleCatalog?.map.has(s.catalog)));
            if (!entry) {
                toast(t('satListBad'));
                return;
            }
            const list = [...commonSats()];
            const at = list.findIndex((p) => SAT.satKey(p) === key);
            list.splice((at < 0) ? list.length : at, (at < 0) ? 0 : 1, entry);
            setSatList(list);
            toast(t('satListSaved'));
            draw();
        };
        const removeFromList = () => {
            setSatList(commonSats().filter((p) => SAT.satKey(p) !== key));
            toast(t('satListRemoved'));
            draw();
        };
        return [
            el('div', {class: 'drawer-head'}, el('h3', {}, s.name),
                draft ? button(t('addToRadio'), 'plus', () => {
                    if (putIn(draft)) {
                        selected = s;
                        preview = null;
                        draw();
                    }
                }, 'primary') : el('span', {class: 'tag'}, t('inRadio'))),
            el('div', {class: 'sat-list-actions'},
                button(t(listed ? 'satListUpdate' : 'satListAdd'), listed ? null : 'plus', saveToList, 'ghost'),
                listed ? button(t('satListRemove'), null, removeFromList, 'ghost') : null),
            el('div', {class: 'section'}, el('div', {class: 'fields'},
                field(t('name'), valueInput(s.name, (v) => {
                    s.name = v;
                    edit();
                    draw();
                }, (x) => (/^[\x20-\x7e]{1,8}$/.test(x) ? x : null))),
                field(t('catalog'), valueInput(s.catalog, (v) => {
                    s.catalog = v;
                    edit();
                }, (x) => (/^\d{0,6}$/.test(x) ? x : null))))),
            el('div', {class: 'section'}, el('h4', {}, t('voice')), el('div', {class: 'fields'},
                freq(t('downlink'), 'voiceRx'), freq(t('uplink'), 'voiceTx'),
                field('CTCSS', select(tones, s.ctcss, (v) => {
                    s.ctcss = +v;
                    edit();
                })),
                field(t('armTone'), select(tones, s.armCtcss, (v) => {
                    s.armCtcss = +v;
                    edit();
                })))),
            el('div', {class: 'section'}, el('h4', {}, 'APRS'), el('div', {class: 'fields'},
                freq(t('downlink'), 'aprsRx'), freq(t('uplink'), 'aprsTx'))),
            el('div', {class: 'section'}, el('h4', {}, t('otherFreq')), el('div', {class: 'fields'},
                freq(t('downlink'), 'otherRx'), freq(t('uplink'), 'otherTx'))),
            el('div', {class: 'section'}, el('h4', {}, t('orbit')),
                el('p', {class: 'muted small', style: 'margin:0 0 8px'},
                    epoch ? `${t('epoch')} ${epoch.toISOString().slice(0, 16).replace('T', ' ')} UTC` : t('orbitNone'),
                    s.catalog ? [' · ', el('a', {href: `https://db.satnogs.org/satellite/${s.catalog}`, target: '_blank',
                        rel: 'noopener'}, 'SatNOGS')] : null),
                tleBox,
                el('div', {style: 'margin:8px 0 14px'}, button(t('useTle'), null, () => {
                    const found = SAT.parseTleText(tleBox.value)[0];
                    if (!found) {
                        toast(t('badTle'));
                        return;
                    }
                    Object.assign(s, SAT.fromTleLines(found.line1, found.line2));
                    s.catalog ||= found.catalog;
                    edit();
                    draw();
                }))),
        ];
    }

    draw();
}

/* ---- themes: the radio's colours ---- */

// The theme being edited ({builtin: id} or {user: id}) and the screen of the preview
let themePick = {builtin: 0};
let themeScreen = 'vfo';
const screenCache = new Map(); // 'vfo/dark' -> the frame buffer's bytes

async function screenBytes(name, kind) {
    const key = `${name}/${kind}`;
    if (!screenCache.has(key)) {
        const packed = Uint8Array.from(atob(SCREENS[name][kind]), (c) => c.charCodeAt(0));
        const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        screenCache.set(key, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return screenCache.get(key);
}

// A screen of the radio in these colours: the frame buffer's palette indexes coloured (the capture under a theme as
// dark as this one: its text edges took such colours)
async function drawScreen(canvas, colours, dark) {
    const bytes = await screenBytes(themeScreen, dark ? 'dark' : 'light');
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    const rgb = colours.map((c) => [(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF]);
    for (let i = 0; i < bytes.length; i++) {
        for (const [k, idx] of [[0, bytes[i] >> 4], [1, bytes[i] & 0x0F]]) {
            const o = ((2 * i) + k) * 4;
            img.data.set(rgb[idx], o);
            img.data[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

const hexColour = (c) => '#' + c.toString(16).padStart(6, '0').toUpperCase();

function viewThemes(main) {
    const zh = language() === 'zh';
    const th = codeplug.themes;
    const changed = () => {
        codeplug.themesDirty = true;
    };
    const themeName = (pick) => (pick.user !== undefined ?
        (th.user.find((u) => u.id === pick.user)?.name || '—') : TH.BUILTIN[pick.builtin].name[zh ? 1 : 0]);
    const current = () => {
        if (themePick.user !== undefined) {
            const u = th.user.find((x) => x.id === themePick.user);
            if (u) {
                return {pick: themePick, colours: u.colours, dark: u.dark, user: u};
            }
            themePick = {builtin: 0};
        }
        const b = th.builtin[themePick.builtin];
        return {pick: themePick, colours: TH.builtinColours(th, themePick.builtin), dark: b.dark, builtin: b};
    };
    const list = el('div', {class: 'items'});
    const editor = el('div', {class: 'card drawer theme-editor'});
    const canvas = el('canvas', {class: 'theme-screen', width: SCREEN_WIDTH, height: SCREEN_HEIGHT});
    const screens = el('div', {class: 'theme-screens'});
    const SCREEN_NAMES = {vfo: 'VFO', channel: t('channels'), menu: t('themeMenu'), options: t('themeOptions'),
        quick: t('themeQuick'), fm: t('themeFm')};

    function swatches(colours) {
        return el('span', {class: 'swatches'}, [0, 6, 7, 8, 9, 13].map((i) =>
            el('i', {style: `background:${hexColour(colours[i])}`})));
    }

    function addUser(from) {
        const id = TH.freeUserId(th);
        if (id === null) {
            toast(t('themesFull'));
            return;
        }
        const base = from ?? current();
        th.user.push({id, name: TH.fitName(`${themeName(base.pick)} 2`), dark: base.dark, colours: [...base.colours]});
        themePick = {user: id};
        changed();
        draw();
    }

    function drawList() {
        const row = (pick, name, colours, opts) => el('div', {
            class: 'item theme-item' + (((pick.user ?? -1) === (themePick.user ?? -1) &&
                (pick.builtin ?? -1) === (themePick.builtin ?? -1)) ? ' selected' : '') + (opts.hidden ? ' hidden-theme' : ''),
            onclick: () => {
                themePick = pick;
                draw();
            },
        }, swatches(colours), el('span', {class: 'theme-name'}, name),
        opts.tag ? el('span', {class: 'tag'}, opts.tag) : null);
        list.replaceChildren(
            el('div', {class: 'group-title'}, t('themesBuiltin')),
            ...TH.BUILTIN.map((b, id) => row({builtin: id}, b.name[zh ? 1 : 0], TH.builtinColours(th, id), {
                hidden: th.builtin[id].hidden,
                tag: th.builtin[id].hidden ? t('themeHiddenTag') : (th.builtin[id].colours ? t('themeChangedTag') : null),
            })),
            el('div', {class: 'group-title'}, `${t('themesMine')} (${th.user.length} / ${TH.USER_THEMES_MAX})`),
            ...th.user.map((u) => row({user: u.id}, u.name || '—', u.colours, {})),
            ...(th.user.length ? [] : [el('div', {class: 'muted small', style: 'padding:6px 10px'}, t('themesNoneYet'))]));
    }

    function drawEditor() {
        const c = current();
        const edit = (fn) => {
            const first = c.builtin && !c.builtin.colours;
            if (first) { // a built-in theme's first change: its own colours copied
                c.builtin.colours = [...TH.BUILTIN[themePick.builtin].colours];
            }
            fn(c.builtin ? c.builtin.colours : c.user.colours);
            changed();
            if (first) { // its "back to its own colours" button now
                draw();
                return;
            }
            drawList();
            drawWarnings();
            drawScreen(canvas, current().colours, current().dark);
        };
        const warnings = el('div', {class: 'theme-warnings'});
        function drawWarnings() {
            const low = TH.lowContrast(current().colours);
            warnings.replaceChildren(...(low.length ? [el('div', {class: 'muted small'}, t('themeLowContrast')),
                ...low.map((w) => el('div', {class: 'warn-text small'},
                    `${TH.ROLES[w.a].name[zh ? 0 : 1]} / ${TH.ROLES[w.b].name[zh ? 0 : 1]}: ${w.ratio.toFixed(1)} : 1` +
                    ` (${t('themeAtLeast')} ${w.min})`))] : [el('div', {class: 'muted small'}, t('themeContrastOk'))]));
        }
        const rows = TH.ROLES.map((role, i) => {
            const picker = el('input', {type: 'color', value: hexColour(c.colours[i]).toLowerCase()});
            const hex = el('input', {class: 'mono hex', value: hexColour(c.colours[i]), spellcheck: false, maxLength: 7});
            const set = (v) => edit((colours) => {
                colours[i] = v;
                picker.value = hexColour(v).toLowerCase();
                hex.value = hexColour(v);
            });
            picker.addEventListener('input', () => set(parseInt(picker.value.slice(1), 16)));
            hex.addEventListener('change', () => {
                const m = /^#?([0-9a-f]{6})$/i.exec(hex.value.trim());
                if (!m) {
                    hex.classList.add('invalid');
                    toast(t('badValue'));
                    return;
                }
                hex.classList.remove('invalid');
                set(parseInt(m[1], 16));
            });
            return el('div', {class: 'theme-role'}, picker, hex,
                el('div', {class: 'theme-role-text'}, el('div', {}, role.name[zh ? 0 : 1]),
                    el('div', {class: 'muted small'}, role.use[zh ? 0 : 1])));
        });
        const head = c.user ? [
            field(t('name'), (() => {
                const input = el('input', {value: c.user.name, maxLength: 16, spellcheck: false});
                input.addEventListener('change', () => {
                    c.user.name = TH.fitName(input.value.trim());
                    input.value = c.user.name;
                    changed();
                    drawList();
                });
                return input;
            })(), {wide: true}),
        ] : [];
        editor.replaceChildren(
            el('div', {class: 'drawer-head'}, el('h3', {}, themeName(themePick)),
                c.user ? iconButton('trash', t('delete'), () => {
                    if (confirm(t('themeDeleteAsk'))) {
                        th.user = th.user.filter((u) => u !== c.user);
                        themePick = {builtin: 0};
                        changed();
                        draw();
                    }
                }, 'danger') : null),
            el('div', {class: 'section'},
                el('div', {class: 'fields'}, ...head,
                    field(t('themeKind'), select([[1, t('themeDark')], [0, t('themeLight')]], c.dark ? 1 : 0, (v) => {
                        if (c.builtin && !c.builtin.colours) {
                            c.builtin.colours = [...TH.BUILTIN[themePick.builtin].colours];
                        }
                        (c.builtin ?? c.user).dark = v === '1';
                        changed();
                        draw();
                    }))),
                c.builtin ? check(t('themeHide'), c.builtin.hidden, (v) => {
                    const shown = TH.BUILTIN.filter((b, id) => !th.builtin[id].hidden).length;
                    if (v && shown <= 1 && !th.user.length) {
                        toast(t('themeLastShown'));
                        draw();
                        return;
                    }
                    c.builtin.hidden = v;
                    changed();
                    drawList();
                }) : null,
                el('div', {class: 'theme-actions'},
                    button(t('themeCopy'), 'copy', () => addUser(current()), 'ghost'),
                    (c.builtin && c.builtin.colours) ? button(t('themeRestore'), null, () => {
                        c.builtin.colours = null;
                        c.builtin.dark = TH.BUILTIN[themePick.builtin].dark;
                        changed();
                        draw();
                    }, 'ghost') : null)),
            el('div', {class: 'section'}, el('h4', {}, t('themeColours')), warnings, ...rows));
        drawWarnings();
    }

    // A theme to share (#117): a JSON file of its name, kind and colours
    function exportTheme(c) {
        const name = themeName(c.pick);
        const blob = new Blob([TH.themeToJson(name, c.dark, c.colours)], {type: 'application/json'});
        const a = el('a', {href: URL.createObjectURL(blob),
            download: (name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'theme') + '.opendmr-theme.json'});
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // Shared themes' files: each one of my themes (while there is room)
    async function importThemes(files) {
        const added = [];
        const bad = [];
        for (const f of files) {
            try {
                const theme = TH.themeFromJson(await f.text());
                const id = TH.freeUserId(th);
                if (id === null) {
                    bad.push(`${f.name}: ${t('themesFull')}`);
                    continue;
                }
                const name = theme.name || TH.fitName(f.name.replace(/(\.opendmr-theme)?\.json$/i, ''));
                th.user.push({id, name, dark: theme.dark, colours: theme.colours});
                added.push(id);
            } catch (e) {
                bad.push(`${f.name}: ${e.message}`);
            }
        }
        if (added.length) {
            themePick = {user: added[added.length - 1]};
            changed();
            draw();
        }
        toast([t('themesImported').replace('{n}', added.length), ...bad].join('\n'), bad.length ? 10000 : 4000);
    }

    function drawScreens() {
        screens.replaceChildren(...Object.keys(SCREENS).map((name) => el('button', {
            class: 'chip' + (name === themeScreen ? ' active' : ''),
            onclick: () => {
                themeScreen = name;
                drawScreens();
                drawScreen(canvas, current().colours, current().dark);
            },
        }, SCREEN_NAMES[name] ?? name)));
    }

    function draw() {
        drawList();
        drawEditor();
        drawScreens();
        drawScreen(canvas, current().colours, current().dark);
    }

    main.append(
        pageHead(t('themes'), el('span', {class: 'spacer'}),
            button(t('themesFactory'), null, () => {
                if (TH.isDefault(th) || !confirm(t('themesFactoryAsk'))) {
                    return;
                }
                codeplug.themes = TH.emptyThemes();
                themePick = {builtin: 0};
                changed();
                render();
            }, 'ghost'),
            button(t('themesImport'), 'open', () => {
                const input = el('input', {type: 'file', accept: '.json,application/json', multiple: true});
                input.addEventListener('change', () => {
                    if (input.files.length) {
                        importThemes([...input.files]);
                    }
                });
                input.click();
            }, 'ghost'),
            button(t('themeExport'), 'save', () => exportTheme(current()), 'ghost'),
            button(t('themeNew'), 'plus', () => addUser(null), 'primary')),
        el('p', {class: 'muted', style: 'margin:0 0 10px'}, t('themesIntro')),
        el('div', {class: 'work'},
            el('div', {class: 'card', style: 'width:250px;flex:none'}, list),
            editor,
            el('div', {class: 'card theme-preview'}, screens, canvas,
                el('div', {class: 'muted small'}, t('themePreviewNote')))));
    draw();
}

/* ---- the radio ---- */

// Firmware commits of the OpenDMR releases (github.com/va3bpf/OpenDMR/releases): the radio reports only its commit
const RELEASES = {df876250: '0.2.0', '0e23d9f5': '0.1.0'};

function firmwareRelease(git) {
    const hit = Object.keys(RELEASES).find((c) => git.startsWith(c) || c.startsWith(git));
    return hit ? 'v' + RELEASES[hit] : '';
}

function buildTime(build) { // "yyyymmddhhmmss"
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(build);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : build;
}

function showRadio() {
    const box = $('radioInfo');
    box.replaceChildren();
    if (!radio) {
        return;
    }
    const release = firmwareRelease(radio.git);
    box.append(el('span', {class: 'chip'},
        el('b', {}, 'DM-32'),
        el('span', {}, `${t('firmware')} ${release || radio.git}`),
        el('span', {class: 'dim'}, buildTime(radio.build))));
}

// The radio answering over the connected port (OpenDMR running): what the codeplug, DMR ID, language and debug
// transfers need. The port can be connected without it (a stock radio, a radio off for the flasher's bootloader).
function online() {
    return !!(link?.connected && !link.suspended && radio);
}

function setConnected(on) {
    const b = $('btnConnect');
    b.querySelector('span').dataset.i18n = on ? 'disconnect' : 'connect';
    b.querySelector('span').textContent = t(on ? 'disconnect' : 'connect');
    $('btnRead').disabled = !online();
    $('btnWrite').disabled = !online();
    $('linkDot').classList.toggle('on', on);
    if (!on) {
        radio = null;
        rxLog = null;
        radioLangs = null;
        showRadio();
        status(t('notConnected'));
    }
    if (tab === 'dmrIds' || tab === 'debug' || tab === 'languages' || tab === 'flasher') { // their buttons and "not connected" follow the link (debug: its status)
        render();
    }
}

async function connect() {
    if (link?.connected) {
        await link.close();
        link = null;
        setConnected(false);
        return;
    }
    if (!RadioLink.supported()) {
        toast(t(window.isSecureContext ? 'noSerial' : 'serialNeedsLocal'), 8000);
        return;
    }
    link = new RadioLink();
    try {
        await link.open();
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        link = null;
        setConnected(false);
        return;
    }
    await refreshRadio();
}

// A port connected without an answering radio is asked again every 2.5 s, so the page follows it by itself: a radio
// switched on, one back from the flasher's bootloader, one that got OpenDMR. Not while the flasher has the port.
let probing = false;
setInterval(async () => {
    if (!link?.connected || link.suspended || radio || probing) {
        return;
    }
    probing = true;
    try {
        const info = await link.radioInfo();
        if (link?.connected && !link.suspended) {
            radio = info;
            showRadio();
            setConnected(true);
            status(t('connected'));
        }
    } catch (e) {
        // still nothing answering
    } finally {
        probing = false;
    }
}, 2500);

// What answers on the connected port: OpenDMR (its info shown), or nothing (the port stays connected: a stock radio,
// one switched off, the flasher's bootloader steps)
async function refreshRadio() {
    try {
        const info = await link.radioInfo();
        if (info.radioType !== 11) {
            toast(t('notOpenDmr'), 6000);
        }
        radio = info;
        showRadio();
        setConnected(true);
        status(t('connected'));
    } catch (e) {
        radio = null;
        showRadio();
        setConnected(true);
        status(t('portNoRadio'));
    }
}

// The cable's speed (toolbar): auto (the checkbox), the fastest the cable keeps for the long writes (DMR IDs,
// languages, receive log); or the baud rate typed in the box, used for every transfer (codeplug read and write too).
// Kept in the browser: SPEED_SETTING_KEY is 'auto' or the rate, SPEED_SETTING_KEY-fixed the rate typed last.
function speedSelect() {
    const auto = $('chkSpeedAuto');
    const box = $('inpSpeed');
    const load = (key) => {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null; // Storage can be unavailable for a local HTML file
        }
    };
    const now = load(SPEED_SETTING_KEY) || 'auto';
    auto.checked = (now === 'auto') || (radioBaud(now) === null);
    box.value = String(radioBaud(auto.checked ? load(`${SPEED_SETTING_KEY}-fixed`) : now) ?? SPEED_MIN);
    box.min = String(SPEED_MIN);
    box.max = String(SPEED_MAX);
    let fixed = box.value; // the last good speed typed
    const apply = (save) => {
        fixed = box.value;
        box.disabled = auto.checked;
        RadioLink.speed = auto.checked ? 'auto' : Number(box.value);
        if (!save) {
            return;
        }
        try {
            localStorage.setItem(SPEED_SETTING_KEY, String(RadioLink.speed));
            localStorage.setItem(`${SPEED_SETTING_KEY}-fixed`, box.value);
        } catch (e) {
            toast(t('speedNotSaved'), 6000);
        }
    };
    auto.addEventListener('change', () => apply(true));
    box.addEventListener('change', () => {
        const baud = radioBaud(box.value);
        if (baud === null) {
            toast(t('speedBad').replaceAll('{min}', SPEED_MIN).replaceAll('{max}', SPEED_MAX), 6000);
            box.value = fixed;
            return;
        }
        box.value = String(baud); // the radio's nearest speed (84 MHz / 16 / divisor)
        apply(true);
    });
    apply(false);
    speedTitle();
}

function speedTitle() {
    $('speedBox').title = t('speedHelp');
}

// A speed chosen by the user: the link at it for a codeplug read or write (auto: those stay at 115200)
async function fixedSpeedUp() {
    const fixed = link.fixedSpeed();
    if (fixed !== null && fixed !== link.baud) {
        await link.speedUp(0);
    }
}

async function readImage() {
    const img = new Uint8Array(L.IMAGE_SIZE).fill(0xFF);
    const total = L.REGIONS.reduce((n, r) => n + (r.end - r.start), 0);
    let done = 0;
    for (const r of L.REGIONS) {
        await link.readRegion(img, r.start, r.end, progress, done, total);
        done += r.end - r.start;
    }
    return img;
}

// What the radio has now: the sectors whose CRC ('D' 'K', firmware 0.4.0) is still that of the image last read are
// taken from it, only the others read; the whole image without that
async function radioNow() {
    if (!radioImage || (await link.sectorCrc(0)) === null) {
        return readImage();
    }
    const img = Uint8Array.from(radioImage);
    const sectors = L.REGIONS.flatMap((r) => Array.from({length: (r.end - r.start) / L.SECTOR},
        (_, i) => r.start + (i * L.SECTOR)));
    for (let i = 0; i < sectors.length; i++) {
        const a = sectors[i];
        if ((await link.sectorCrc(a)) !== ODDB.crc32(radioImage.subarray(a, a + L.SECTOR))) {
            await link.readRegion(img, a, a + L.SECTOR);
        }
        progress(i + 1, sectors.length);
    }
    return img;
}

async function readRadio() {
    status(t('reading'));
    try {
        await link.saveSettings();
        await fixedSpeedUp();
        const img = await readImage(); // packed: about a second, no speed change needed
        await link.speedDown();
        await link.closeScreen();
        radioImage = Uint8Array.from(img);
        codeplug = new Codeplug(img);
        selectedChannel = null;
        status(t('readDone'));
        // the radio cannot fetch orbits: tell when the ones in it are getting old
        const oldest = Math.max(-1, ...codeplug.satellites.map((s) => satAgeDays(s) ?? -1));
        if (oldest > 14) {
            toast(t('radioOrbitsOld').replace('{n}', oldest), 12000);
        }
        render();
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        status(t('error'));
    } finally {
        progress(0, 0);
        await speedBack();
    }
}

// The radio back at 115200 after a transfer (it would keep a confirmed speed until 5 s without a request)
async function speedBack() {
    try {
        if (online()) {
            await link.speedDown();
        }
    } catch (e) {
        // the port went away
    }
}

// The radio's regions as they are, our ranges replaced, the sectors that differ written; then the radio restarts
async function writeRadio() {
    try {
        const noTle = () => codeplug.satellites.filter((s) => !s.tle1.trim() || !s.tle2.trim());
        if (codeplug.satellites.length) { // the orbits as new as they get
            if (!tleCatalog || tleCatalog.error) {
                tleCatalog = null;
                await loadTleCatalog();
            }
            refreshOrbits(tleCatalog.map);
        }
        if (codeplug.satellitesDirty && noTle().length) {
            status(t('updateTle') + ' …');
            await fetchTles(noTle());
            if (noTle().length && !window.confirm(t('noTleWrite') + noTle().map((s) => s.name).join(', '))) {
                status('');
                return;
            }
        }
        if (!storeCodeplug()) {
            status('');
            return;
        }
        status(t('reading'));
        await link.saveSettings(); // the settings in the flash as the radio has them; nothing left to save at restart
        await fixedSpeedUp();
        const onRadio = await radioNow();
        const target = Uint8Array.from(onRadio);
        const ranges = L.ownedRanges(codeplug.channelsPerZone);
        if (codeplug.settings.dirty && codeplug.settings.valid) { // the radio's settings only when changed here
            ranges.push([SETTINGS, SETTINGS + SETTINGS_SIZE]);
        }
        if (codeplug.settings.dtmfDirty) { // the DTMF timing: else as the radio has it
            ranges.push([L.DTMF_DURATIONS, L.DTMF_DURATIONS + DTMF_DURATIONS_SIZE]);
        }
        ranges.push(...codeplug.customRanges); // the satellites, when changed
        for (const [a, b] of ranges) {
            target.set(codeplug.img.subarray(a, b), a);
        }
        // the text messages deleted: only where the radio still has the one read (it may have taken new ones over
        // the oldest since)
        for (const m of codeplug.smsDeletes) {
            if (SMS.sameRecord(onRadio, m)) {
                target[m.at] = 0;
            }
        }
        const sectors = [];
        for (const r of L.REGIONS) {
            for (let s = r.start / L.SECTOR; s < r.end / L.SECTOR; s++) {
                const a = s * L.SECTOR;
                if (target.subarray(a, a + L.SECTOR).some((v, i) => v !== onRadio[a + i])) {
                    sectors.push(s);
                }
            }
        }
        radioImage = onRadio;
        if (sectors.length === 0) {
            await link.speedDown();
            await link.closeScreen();
            status(t('nothingToWrite'));
            return;
        }
        status(t('writing'));
        for (let i = 0; i < sectors.length; i++) {
            const a = sectors[i] * L.SECTOR;
            await link.writeSector(sectors[i], target.subarray(a, a + L.SECTOR));
            progress(i + 1, sectors.length);
        }
        radioImage = target; // what the radio has now
        codeplug.smsDeletes = [];
        await link.speedDown();
        await link.restart();
        status(t('writeDone') + ` (${sectors.length} × 4 KB)`);
        toast(t('writeDone'));
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        status(t('error'));
        await speedBack();
    } finally {
        progress(0, 0);
    }
}

// The records into the image. Only when a change needs a new custom data block and that area is broken (#124: data
// where a free place should be) the user is asked to clear the broken part; once written, the radio's area is sound
// and nobody is asked again. false: they said no (nothing done)
function storeCodeplug() {
    try {
        codeplug.store();
        return true;
    } catch (e) {
        if (!(e instanceof CustomDataDamaged)) {
            throw e;
        }
        if (!window.confirm(t('customDamagedAsk').replace('{at}', '0x' + (e.at - L.CUSTOM_DATA).toString(16).toUpperCase()))) {
            toast(t('customDamagedNo'), 8000);
            return false;
        }
        codeplug.repairCustomData(e.at);
        codeplug.store();
        return true;
    }
}

/* ---- files ---- */

function saveFile() {
    if (!storeCodeplug()) {
        return;
    }
    const head = new TextEncoder().encode(FILE_MAGIC);
    const blob = new Blob([head, codeplug.img], {type: 'application/octet-stream'});
    const a = el('a', {href: URL.createObjectURL(blob), download: (codeplug.general.callsign || 'codeplug') + '.opendmr'});
    a.click();
    URL.revokeObjectURL(a.href);
}

async function openFile(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    const head = new TextEncoder().encode(FILE_MAGIC);
    if ((data.length !== head.length + L.IMAGE_SIZE) || !head.every((v, i) => data[i] === v)) {
        toast(t('badFile'));
        return;
    }
    codeplug = new Codeplug(data.slice(head.length));
    selectedChannel = null;
    render();
}

/* ---- CSV (the OpenGD77 CPS's files) ---- */

function exportCsv() {
    if (!storeCodeplug()) {
        return;
    }
    const enc = new TextEncoder();
    const blob = makeZip(CSV.exportCsv(codeplug).map((f) => ({name: f.name, data: enc.encode(f.text)})));
    const a = el('a', {href: URL.createObjectURL(blob), download: (codeplug.general.callsign || 'codeplug') + '-csv.zip'});
    a.click();
    URL.revokeObjectURL(a.href);
}

// A dialog: its body, then buttons [label, value, cls]; resolves with the value of the button pressed (null: closed)
function dialog(title, body, buttons) {
    return new Promise((resolve) => {
        const d = el('dialog', {class: 'dialog'}, el('h3', {}, title), body,
            el('div', {class: 'dialog-actions'}, buttons.map(([label, value, cls]) =>
                el('button', {class: cls ?? '', onclick: () => {
                    d.close();
                    resolve(value);
                }}, label))));
        d.addEventListener('cancel', () => resolve(null));
        d.addEventListener('close', () => d.remove());
        document.body.append(d);
        d.showModal();
    });
}

async function importCsv(fileList) {
    const files = [];
    try {
        for (const f of fileList) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            if (isZip(bytes)) {
                for (const z of await readZip(bytes)) {
                    if (/\.csv$/i.test(z.name)) {
                        files.push({name: z.name.split('/').pop(), text: CSV.decodeCsvBytes(z.data)});
                    }
                }
            } else {
                files.push({name: f.name, text: CSV.decodeCsvBytes(bytes)});
            }
        }
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        return;
    }
    const names = files.map((f) => f.name).join(', ') || '—';
    const mode = await dialog(t('csvImport'), el('div', {},
        el('p', {}, t('csvFiles') + names),
        el('p', {class: 'muted'}, t('csvReplaceHelp')),
        el('p', {class: 'muted'}, t('csvAppendHelp'))),
    [[t('cancel'), null, 'ghost'], [t('csvAppend'), 'append'], [t('csvReplace'), 'replace', 'primary']]);
    if (!mode) {
        return;
    }
    const report = CSV.importCsv(codeplug, files, {replace: mode === 'replace', newChannel: (n) => {
        const ch = Codeplug.newChannel(n);
        ch.power = 0; // the CSV's Power ("Master": the radio's)
        return ch;
    }});
    selectedChannel = null;
    render();
    const counts = Object.entries(report.counts).map(([k, n]) => `${CSV.FILES[k]}: ${n}`).join(' · ');
    const lines = [...report.errors, ...report.warnings];
    if (!lines.length) {
        toast(t('csvImported') + ' ' + counts, 6000);
        return;
    }
    await dialog(report.errors.length ? t('csvFailed') : t('csvImported'), el('div', {},
        report.errors.length ? null : el('p', {}, counts),
        el('textarea', {rows: Math.min(16, lines.length + 1), readOnly: true, value: lines.join('\n')})),
    [[t('close'), null, 'primary']]);
}

/* ---- the flasher ---- */

// The port back from a flasher step: the link reopened, then what answers read again (the radio may be on OpenDMR
// now, or on the stock firmware, or still in the bootloader)
async function flasherGiveBack() {
    if (!link?.connected) {
        return;
    }
    try {
        await link.resume();
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        link = null;
        setConnected(false);
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500)); // a radio restarting after an update answers in ~1 s
    await refreshRadio();
}

const flasherView = createFlasher({
    el, pageHead, toast, status, progress, getLink: () => link, getRadio: () => radio, giveBack: flasherGiveBack,
    rerender: () => render(),
});

/* ---- start ---- */

function init() {
    document.querySelector('.side-foot').textContent = 'OpenDMR CPS · v' + VERSION;
    applyIcons();
    applyTexts();
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
        tab = b.dataset.tab;
        render();
    }));
    $('btnConnect').addEventListener('click', connect);
    RadioLink.text = t;
    speedSelect();
    $('btnRead').addEventListener('click', readRadio);
    $('btnWrite').addEventListener('click', writeRadio);
    $('btnSave').addEventListener('click', saveFile);
    $('btnCsvExport').addEventListener('click', exportCsv);
    $('btnCsvImport').addEventListener('click', () => $('csvInput').click());
    $('csvInput').addEventListener('change', (e) => {
        if (e.target.files.length) {
            importCsv([...e.target.files]);
        }
        e.target.value = '';
    });
    $('btnOpen').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => {
        if (e.target.files[0]) {
            openFile(e.target.files[0]);
        }
        e.target.value = '';
    });
    $('btnNew').addEventListener('click', () => {
        codeplug = new Codeplug();
        selectedChannel = null;
        render();
    });
    const languageSelect = $('languageSelect');
    languageSelect.addEventListener('change', () => {
        setLanguage(languageSelect.value);
        applyTexts();
        speedTitle();
        render();
    });
    render();
}

init();
