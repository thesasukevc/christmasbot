'use strict';

/**
 * i18n.js — loads every locales/<code>.json automatically.
 *
 * To add a language: copy locales/en.json to locales/<code>.json, translate it,
 * run `npm run make-templates`, restart the bot. No code changes needed.
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'locales');
const DEFAULT_LANG = 'en';

const locales = {};
for (const file of fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const code = path.basename(file, '.json');
  try {
    locales[code] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
  } catch (err) {
    console.error(`❌ Cannot read locales/${file}: ${err.message}`);
    process.exit(1);
  }
}

if (!locales[DEFAULT_LANG]) {
  console.error(`❌ locales/${DEFAULT_LANG}.json is required (it is the fallback language).`);
  process.exit(1);
}

// Warn about missing translations (the bot falls back to English for those keys)
for (const [code, loc] of Object.entries(locales)) {
  if (code === DEFAULT_LANG) continue;
  const missingBot = Object.keys(locales[DEFAULT_LANG].bot).filter((k) => !(loc.bot && k in loc.bot));
  const missingTpl = Object.keys(locales[DEFAULT_LANG].templates).filter((k) => !(loc.templates && k in loc.templates));
  if (missingBot.length || missingTpl.length) {
    console.warn(`⚠️  locales/${code}.json is missing: ${[...missingBot, ...missingTpl].join(', ')} (English will be used)`);
  }
}

/** Supported languages, sorted by meta.order: [{ code, name, flag, chooseLang }] */
function languages() {
  return Object.entries(locales)
    .map(([code, loc]) => ({ ...loc.meta, code })) // file name wins over meta.code
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

function hasLang(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(locales, code);
}

/** Translate a bot string, replacing {placeholders}. Falls back to English. */
function t(lang, key, vars = {}) {
  const str = locales[lang]?.bot?.[key] ?? locales[DEFAULT_LANG].bot[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Template label + caption for a language: { label, caption } */
function tpl(lang, templateId) {
  return locales[lang]?.templates?.[templateId] ?? locales[DEFAULT_LANG].templates[templateId];
}

/** Command descriptions for setMyCommands */
function commands(lang) {
  const c = locales[lang]?.meta?.commands ?? locales[DEFAULT_LANG].meta.commands;
  return [
    { command: 'start', description: c.start },
    { command: 'language', description: c.language },
    { command: 'cancel', description: c.cancel },
  ];
}

/** Bot profile texts for BotFather-style setMyDescription / setMyShortDescription */
function descriptions(lang) {
  const m = locales[lang]?.meta || {};
  const d = locales[DEFAULT_LANG].meta;
  return {
    description: m.description || d.description || '',
    shortDescription: m.shortDescription || d.shortDescription || '',
  };
}

module.exports = { DEFAULT_LANG, languages, hasLang, t, tpl, commands, descriptions };
