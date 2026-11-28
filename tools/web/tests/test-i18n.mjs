import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RU_TEXTS} from '../../../js/i18n-ru.js';

globalThis.navigator ??= {language: 'en'};
const {setLanguage, t} = await import('../../../js/i18n.js');
const source = fs.readFileSync(new URL('../../../js/i18n.js', import.meta.url), 'utf8');
const keys = [...source.matchAll(/^    ([A-Za-z][A-Za-z0-9_]*): \[/gm)].map((match) => match[1]);
const placeholders = (text) => [...text.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)]
    .map((match) => match[0]).sort();

assert.deepEqual(Object.keys(RU_TEXTS).sort(), [...keys].sort(), 'Russian strings must cover every interface key');
assert.throws(() => setLanguage('unsupported'), RangeError);
setLanguage('en');
const englishTexts = Object.fromEntries(keys.map((key) => [key, t(key)]));
setLanguage('ru');
assert.equal(t('connect'), 'Подключить');
for (const key of keys) {
    assert.deepEqual(placeholders(RU_TEXTS[key]), placeholders(englishTexts[key]), `${key} placeholders`);
}

console.log(`Russian UI strings and placeholders: ${keys.length} passed`);
