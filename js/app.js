// OpenDMR CPS: the page

import {t, applyTexts, toggleLanguage} from './i18n.js';
import {icon, applyIcons} from './icons.js';
import {Codeplug, MODES, P25_NAC_ANY, CALL_TYPES, POWER_LEVELS, STEPS_HZ, toneChoices, frequencyValid} from './codeplug/codeplug.js';
import * as L from './codeplug/layout.js';
import {RadioLink} from './radio/link.js';
import {GROUPS, SETTINGS, SETTINGS_SIZE} from './codeplug/settings.js';
import {language} from './i18n.js';
import {VERSION} from './version.js';
import * as SAT from './codeplug/satellites.js';
import * as gb from './gb2312.js';

const FILE_MAGIC = 'OPENDMR-CPS 1\n'; // our codeplug file: this line, then the window image (layout.js IMAGE_SIZE)

let codeplug = new Codeplug();
let link = null;
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

function field(label, control, opts = {}) {
    return el('div', {class: 'field' + (opts.wide ? ' wide' : '')}, el('label', {}, label), control);
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

function check(label, value, onChange) {
    const c = el('input', {type: 'checkbox', checked: value});
    c.addEventListener('change', () => onChange(c.checked));
    return el('label', {class: 'check'}, c, label);
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
    $('countSatellites').textContent = codeplug.satellites.length || '';
}

function render() {
    counts();
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const main = $('content');
    main.replaceChildren();
    ({channels: viewChannels, zones: viewZones, contacts: viewContacts, rxGroups: viewRxGroups, vfo: viewVfo,
        general: viewGeneral, radioSettings: viewRadioSettings, satellites: viewSatellites})[tab](main);
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
        const analog = ch.mode !== 'DMR' && !p25;
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
            )) : el('div', {class: 'section'}, el('h4', {}, t(p25 ? 'secP25' : 'secDmr')), el('div', {class: 'fields'},
                p25 ? field(t('nac'), valueInput(ch.nac, set('nac'), (s) => {
                    const hex = s.trim().split(/\s/)[0];
                    const v = /^[0-9a-fA-F]{1,3}$/.test(hex) ? parseInt(hex, 16) : NaN;
                    return Number.isNaN(v) ? null : v;
                }, (v) => v.toString(16).toUpperCase().padStart(3, '0') + (v === P25_NAC_ANY ? ' (' + t('nacAny') + ')' : '')))
                    : field(t('colourCode'), select([...Array(16).keys()].map((i) => [i, i]), ch.colourCode, (v) => set('colourCode')(+v))),
                p25 ? null : field(t('timeslot'), select([[1, 'TS1'], [2, 'TS2']], ch.timeslot, (v) => set('timeslot')(+v))),
                field(t('contact'), select([[0, t('none')], ...codeplug.contacts.map((c) => [c.index, `${c.name} · ${c.id}`])],
                    ch.contact, (v) => set('contact')(+v)), {wide: true}),
                field(t('rxGroup'), select([[0, t('none')], ...codeplug.rxGroups.map((g) => [g.number, g.name])],
                    ch.rxGroup, (v) => set('rxGroup')(+v)), {wide: true}),
                field(t('channelDmrId'), valueInput(ch.dmrId || '', (v) => set('dmrId')(v || 0),
                    (s) => (s === '' ? 0 : intRange(1, 16777215)(s)), (v) => v || ''), {wide: true}),
                check(t('forceDmo'), ch.forceDmo, set('forceDmo')),
            )),
            el('div', {class: 'section'}, el('h4', {}, t('secOther')), el('div', {class: 'fields'},
                field(t('step'), select(STEPS_HZ.map((s) => [s, (s / 1000) + ' kHz']), ch.step, (v) => set('step')(+v))),
                el('div'),
                check(t('beep'), ch.beep, set('beep')),
                check(t('eco'), ch.eco, set('eco')),
                opts.vfo ? null : check(t('zoneSkip'), ch.zoneSkip, set('zoneSkip')),
                opts.vfo ? null : check(t('allSkip'), ch.allSkip, set('allSkip')),
                check(t('vox'), ch.vox, set('vox')),
            )),
        ];
        box.replaceChildren(...sections);
    }

    draw();
    return box;
}

/* ---- channels ---- */

function viewChannels(main) {
    let filter = '';
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
        return [ch.rxTone, ch.txTone].some((x) => x) ? `${ch.rxTone || '—'} / ${ch.txTone || '—'}` : '';
    }

    function row(ch) {
        const tr = el('tr', {class: ch === selectedChannel ? 'selected' : '', onclick: () => {
            selectedChannel = ch;
            body.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
            tr.classList.add('selected');
            openDrawer();
        }},
        el('td', {class: 'num'}, ch.number),
        el('td', {class: 'name'}, ch.name),
        el('td', {}, el('span', {class: 'pill ' + ch.mode}, ch.mode)),
        el('td', {class: 'mono'}, mhz(ch.rx)),
        el('td', {class: 'mono dim'}, ch.tx === ch.rx ? '' : mhz(ch.tx)),
        el('td', {class: 'dim'}, summaryTone(ch)),
        el('td', {class: 'dim'}, (ch.mode === 'DMR' || ch.mode === 'P25') ? (contactName(ch.contact) || rxGroupName(ch.rxGroup)) : ''),
        el('td', {class: 'dim'}, ch.power ? POWER_LEVELS[ch.power - 1] : ''),
        el('td', {},
            ch.rxOnly ? el('span', {class: 'tag'}, t('rxOnly')) : null,
            (ch.mode === 'FM' && ch.wide) ? el('span', {class: 'tag'}, '25k') : null));
        ch.row = tr;
        return tr;
    }

    function fill() {
        const list = codeplug.channels.filter((c) => !filter || c.name.toLowerCase().includes(filter) ||
            mhz(c.rx).includes(filter));
        body.replaceChildren(...list.map(row));
        if (!list.length) {
            body.append(el('tr', {}, el('td', {colspan: 9, class: 'empty'}, '—')));
        }
    }

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
                    codeplug.channels = codeplug.channels.filter((c) => c !== ch);
                    for (const z of codeplug.zones) {
                        z.channels = z.channels.filter((n) => n !== ch.number);
                    }
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
                        el('thead', {}, el('tr', {}, ['number', 'name', 'mode', 'rxFreq', 'txFreq', 'tone', 'contactOrList',
                            'power', 'flags'].map((k) => el('th', {}, t(k))))),
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
        el('td', {class: 'num'}, c.index),
        el('td', {class: 'name'}, c.name),
        el('td', {class: 'mono'}, c.id),
        el('td', {class: 'dim'}, t(c.callType)),
        el('td', {class: 'dim'}, c.timeslot ? 'TS' + c.timeslot : ''));
        c.row = tr;
        return tr;
    }

    function fill() {
        const list = codeplug.contacts.filter((c) => !filter || c.name.toLowerCase().includes(filter) ||
            String(c.id).includes(filter));
        body.replaceChildren(...list.map(row));
    }

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
                    codeplug.contacts = codeplug.contacts.filter((x) => x !== c);
                    for (const g of codeplug.rxGroups) {
                        g.contacts = g.contacts.filter((i) => i !== c.index);
                    }
                    for (const ch of codeplug.channels) {
                        if (ch.contact === c.index) {
                            ch.contact = 0;
                        }
                    }
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
        pageHead(t('contacts'), el('span', {class: 'spacer'}), search,
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
                        el('thead', {}, el('tr', {}, ['number', 'name', 'id', 'callType', 'tsOverride']
                            .map((k) => el('th', {}, t(k))))),
                        body))),
            drawer));
    fill();
    openDrawer();
}

/* ---- general ---- */

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
                    field(t('dmrId'), valueInput(g.dmrId, (v) => (g.dmrId = v), intRange(0, 16777215))))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, t('radioInfo')),
                info ? el('dl', {class: 'info'}, info.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))
                    : el('p', {class: 'muted'}, t('notConnected'))),
            el('div', {class: 'card form-card'},
                el('h3', {class: 'card-title'}, 'OpenDMR CPS'),
                el('dl', {class: 'info'}, el('dt', {}, t('version')), el('dd', {}, 'v' + VERSION)))));
}

/* ---- the radio's own settings (its menus) ---- */

function viewRadioSettings(main) {
    const s = codeplug.settings;
    const zh = language() === 'zh';
    const label = (x) => (Array.isArray(x) ? x[zh ? 1 : 0] : x);
    main.append(pageHead(t('radioSettings')));
    if (!s.valid) {
        main.append(el('div', {class: 'card empty'}, t('settingsInvalid')));
        return;
    }
    const grid = el('div', {class: 'settings-grid'});
    const controls = [];

    function control(item) {
        const value = s.get(item.id);
        if (item.c) {
            return select(item.c.map(([v, en, cn]) => [v, zh ? cn : en]), value, (v) => change(item, +v));
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

    for (const g of GROUPS) {
        const rows = el('div', {class: 'set-rows'});
        for (const item of g.items) {
            const box = el('div', {class: 'set-control'});
            const row = el('div', {class: 'set-row'}, el('label', {}, zh ? item.zh : item.en), box);
            controls.push({item, row, box});
            rows.append(row);
        }
        grid.append(el('div', {class: 'card set-card'}, el('div', {class: 'card-head'}, el('h3', {}, zh ? g.zh : g.en)), rows));
    }
    main.append(el('div', {class: 'settings-scroll'}, grid));
    refresh();
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

// Tick the satellites to have in the radio: the common ones first (frequencies known), the others of the orbit file
// below. Orbits come by themselves (here, and again before writing); a name opens its editor
function viewSatellites(main) {
    let selected = null;
    let preview = null; // an unticked satellite clicked: its details, read only
    let filter = '';
    const presetOf = new Map(SAT.PRESETS.map((p) => [p.catalog, p]));
    const mhzOrEmpty = (hz) => (hz ? mhz(hz) : '');
    // catalog numbers are not stored in the radio: the presets give them by name
    for (const s of codeplug.satellites) {
        s.catalog ||= SAT.PRESETS.find((p) => p.name === s.name)?.catalog ?? '';
    }
    const changed = () => {
        codeplug.satellitesDirty = true;
        $('countSatellites').textContent = codeplug.satellites.length || '';
    };
    const inRadio = (catalog) => codeplug.satellites.find((s) => s.catalog === catalog);
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
        el('td', {class: 'mono dim'}, entry.catalog));
    }

    function draw() {
        const catalog = tleCatalog?.map ?? new Map();
        const f = filter.trim().toLowerCase();
        const match = (x) => !f || x.short.toLowerCase().includes(f) || (x.name ?? '').toLowerCase().includes(f) ||
            String(x.catalog).includes(f);
        const common = SAT.PRESETS.map((p) => ({catalog: p.catalog, short: p.name, name: catalog.get(p.catalog)?.name ?? ''}));
        // a satellite keeps its place when ticked: "mine" are only those the orbit file does not have
        const mine = codeplug.satellites.filter((s) => !presetOf.has(s.catalog) && !catalog.has(s.catalog))
            .map((s) => ({catalog: s.catalog || s.name, short: s.name, name: ''}));
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
                    listTools(),
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

    // Select all the common satellites (or none), and the list and orbits fetched again
    function listTools() {
        const commonIn = SAT.PRESETS.filter((p) => inRadio(p.catalog));
        const all = el('input', {type: 'checkbox', checked: commonIn.length === SAT.PRESETS.length});
        all.indeterminate = commonIn.length > 0 && commonIn.length < SAT.PRESETS.length;
        all.addEventListener('change', () => {
            if (all.checked) {
                for (const p of SAT.PRESETS) {
                    if (inRadio(p.catalog)) {
                        continue;
                    }
                    if (codeplug.satellites.length >= SAT.SATELLITES_MAX) {
                        toast(t('satFull'));
                        break;
                    }
                    const s = SAT.newSatellite(p);
                    const x = tleCatalog?.map.get(p.catalog);
                    if (x) {
                        Object.assign(s, SAT.fromTleLines(x.line1, x.line2));
                    }
                    codeplug.satellites.push(s);
                }
            } else {
                codeplug.satellites = codeplug.satellites.filter((s) => !presetOf.has(s.catalog));
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
        return el('div', {class: 'sat-tools'},
            el('label', {class: 'sat-all'}, all, t('selectAllCommon')),
            el('label', {class: 'search'}, icon('search'), search),
            el('span', {style: 'flex:1'}),
            tleCatalog && !tleCatalog.error ? el('span', {class: 'muted small'},
                `${t('listOf')} ${tleCatalog.time.toLocaleTimeString().slice(0, 5)}`) : null,
            refresh);
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
        return [
            el('div', {class: 'drawer-head'}, el('h3', {}, s.name),
                draft ? button(t('addToRadio'), 'plus', () => {
                    if (putIn(draft)) {
                        selected = s;
                        preview = null;
                        draw();
                    }
                }, 'primary') : el('span', {class: 'tag'}, t('inRadio'))),
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

function setConnected(on) {
    const b = $('btnConnect');
    b.querySelector('span').dataset.i18n = on ? 'disconnect' : 'connect';
    b.querySelector('span').textContent = t(on ? 'disconnect' : 'connect');
    $('btnRead').disabled = !on;
    $('btnWrite').disabled = !on;
    $('linkDot').classList.toggle('on', on);
    if (!on) {
        radio = null;
        showRadio();
        status(t('notConnected'));
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
        const info = await link.radioInfo();
        if (info.radioType !== 11) {
            toast(t('notOpenDmr'), 6000);
        }
        radio = info;
        showRadio();
        setConnected(true);
        status(t('connected'));
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        await link?.close();
        link = null;
        setConnected(false);
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

async function readRadio() {
    status(t('reading'));
    try {
        await link.saveSettings();
        codeplug = new Codeplug(await readImage());
        selectedChannel = null;
        await link.closeScreen();
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
        codeplug.store();
        status(t('reading'));
        await link.saveSettings(); // the settings in the flash as the radio has them; nothing left to save at restart
        const onRadio = await readImage();
        const target = Uint8Array.from(onRadio);
        const ranges = L.ownedRanges(codeplug.channelsPerZone);
        if (codeplug.settings.dirty && codeplug.settings.valid) { // the radio's settings only when changed here
            ranges.push([SETTINGS, SETTINGS + SETTINGS_SIZE]);
        }
        ranges.push(...codeplug.customRanges); // the satellites, when changed
        for (const [a, b] of ranges) {
            target.set(codeplug.img.subarray(a, b), a);
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
        if (sectors.length === 0) {
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
        await link.restart();
        status(t('writeDone') + ` (${sectors.length} × 4 KB)`);
        toast(t('writeDone'));
    } catch (e) {
        toast(t('error') + ': ' + e.message, 6000);
        status(t('error'));
    } finally {
        progress(0, 0);
    }
}

/* ---- files ---- */

function saveFile() {
    codeplug.store();
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
    $('btnRead').addEventListener('click', readRadio);
    $('btnWrite').addEventListener('click', writeRadio);
    $('btnSave').addEventListener('click', saveFile);
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
    $('btnLang').addEventListener('click', () => {
        toggleLanguage();
        applyTexts();
        render();
    });
    render();
}

init();
