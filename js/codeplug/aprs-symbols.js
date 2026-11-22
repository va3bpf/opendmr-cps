// The 94 printable APRS symbol characters of the primary (/) and alternate (\) tables.
// Codes are kept exactly as the radio stores them; no third-party descriptions are used.
export function aprsSymbols(table) {
    const prefix = table === 1 ? '\\' : '/';
    return Array.from({length: 94}, (_, value) => {
        const character = String.fromCharCode(value + 33);
        const code = prefix + character;
        return {value, character, code};
    });
}
