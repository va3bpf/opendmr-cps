// Line icons (24 x 24, stroked), drawn for this page

const PATHS = {
    new: 'M6 3h8l4 4v14H6z M14 3v4h4 M12 11v6 M9 14h6',
    open: 'M3 7h6l2 2h10v10H3z M3 7V5h6',
    save: 'M5 3h11l3 3v15H5z M8 3v5h7V3 M8 21v-7h8v7',
    plug: 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4',
    download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
    upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
    channels: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M14 10v4 M10 16v4',
    zones: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
    contact: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M4 21c1-4 4-6 8-6s7 2 8 6',
    group: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7 M2 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 15c2 .6 3.4 2.2 4 5',
    vfo: 'M4 8h16v12H4z M7 4l10 4 M8 14h3 M15 14a1.5 1.5 0 1 0 0 .1',
    settings: 'M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M12 2v3 M12 19v3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1L7 17 M17 7l2.1-2.1',
    sliders: 'M4 6h10 M18 6h2 M16 4v4 M4 12h4 M12 12h8 M10 10v4 M4 18h12 M20 18h0 M18 16v4',
    satellite: 'M9 9l6 6 M7 11l-4 4 3 3 4-4 M13 7l4-4 3 3-4 4 M16 21a5 5 0 0 0 5-5 M16 18a2 2 0 0 0 2-2',
    plus: 'M12 5v14 M5 12h14',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
    search: 'M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14 M16 16l5 5',
    x: 'M6 6l12 12 M18 6L6 18',
    up: 'M12 19V5 M6 11l6-6 6 6',
    down: 'M12 5v14 M6 13l6 6 6-6',
    copy: 'M8 8h12v12H8z M4 16V4h12',
};

export function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', PATHS[name] ?? '');
    svg.append(path);
    return svg;
}

// The buttons with data-icon get theirs in front of their text
export function applyIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((b) => {
        if (!b.querySelector('svg.icon')) {
            b.prepend(icon(b.dataset.icon));
        }
    });
}
