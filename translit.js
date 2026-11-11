'use strict';

/**
 * translit.js — Uzbek Latin <-> Cyrillic conversion for personal names.
 * Used for the "🔤 Кирилл / Lotin" button under the finished card.
 *
 *   Oʻktam Gʻaniyev  <->  Ўктам Ғаниев
 */

const APOSTROPHE = /[ʻʼ‘’'`´]/;
const isLetter = (ch) => !!ch && /\p{L}/u.test(ch);
const isUpper = (ch) => ch !== ch.toLowerCase();

/** Copy the capitalisation of the Latin source (src) onto the Cyrillic result. */
function caseLikeLatin(src, out) {
  if (!out) return out;
  if (src.length > 1 && src === src.toUpperCase()) return out.toUpperCase(); // "SH" -> "Ш"
  if (isUpper(src[0])) return out.charAt(0).toUpperCase() + out.slice(1);     // "Sh" -> "Ш"
  return out;
}

const L2C = {
  a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з',
};
const L2C_PAIRS = { sh: 'ш', ch: 'ч', yo: 'ё', yu: 'ю', ya: 'я', ye: 'е' };

function latinToCyrillic(text) {
  const chars = Array.from(String(text));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const low = ch.toLowerCase();
    const next = chars[i + 1];
    const prev = chars[i - 1];

    // o‘ / g‘  ->  ў / ғ
    if ((low === 'o' || low === 'g') && next && APOSTROPHE.test(next)) {
      out += caseLikeLatin(ch, low === 'o' ? 'ў' : 'ғ');
      i++;
      continue;
    }
    // apostrophe between letters (Ma'mur, Sa'diy) -> ъ
    if (APOSTROPHE.test(ch)) {
      out += isLetter(prev) && isLetter(next) ? 'ъ' : ch;
      continue;
    }
    // digraphs: sh ch yo yu ya ye
    if (next && L2C_PAIRS[low + next.toLowerCase()]) {
      out += caseLikeLatin(ch + next, L2C_PAIRS[low + next.toLowerCase()]);
      i++;
      continue;
    }
    // "e" at the start of a word is "э" (Elmira -> Элмира)
    if (low === 'e' && !isLetter(prev) && !(prev && APOSTROPHE.test(prev))) {
      out += caseLikeLatin(ch, 'э');
      continue;
    }
    out += L2C[low] ? caseLikeLatin(ch, L2C[low]) : ch;
  }
  return out;
}

const C2L = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ъ: 'ʼ', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'oʻ', қ: 'q', ғ: 'gʻ', ҳ: 'h',
};
const CYR_VOWELS = 'аеёиоуэюяыў';

function caseLikeCyrillic(src, out, prev, next) {
  if (!out || !isUpper(src)) return out;
  const neighbourUpper = (isLetter(next) && isUpper(next)) || (isLetter(prev) && isUpper(prev));
  if (out.length > 1 && neighbourUpper) return out.toUpperCase(); // ШЕР -> SHER
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function cyrillicToLatin(text) {
  const chars = Array.from(String(text));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const low = ch.toLowerCase();
    const prev = chars[i - 1];
    const next = chars[i + 1];
    let mapped = C2L[low];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    // "е" at the start of a word or after a vowel is "ye" (Елена -> Yelena, Алиев -> Aliyev)
    if (low === 'е' && (!isLetter(prev) || CYR_VOWELS.includes(prev.toLowerCase()))) mapped = 'ye';
    out += caseLikeCyrillic(ch, mapped, prev, next);
  }
  return out;
}

/** 'cyr' | 'lat' | 'none' — which alphabet most letters of the text belong to. */
function detectScript(text) {
  const s = String(text);
  const cyr = (s.match(/\p{Script=Cyrillic}/gu) || []).length;
  const lat = (s.match(/\p{Script=Latin}/gu) || []).length;
  if (!cyr && !lat) return 'none';
  return cyr > lat ? 'cyr' : 'lat';
}

/** Convert a name to the other alphabet (Latin -> Cyrillic or Cyrillic -> Latin). */
function convertName(text) {
  const script = detectScript(text);
  if (script === 'cyr') return cyrillicToLatin(text);
  if (script === 'lat') return latinToCyrillic(text);
  return text;
}

module.exports = { latinToCyrillic, cyrillicToLatin, detectScript, convertName };
