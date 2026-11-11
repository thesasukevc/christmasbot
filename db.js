'use strict';

/**
 * db.js — small JSON-file store (no native modules, nothing to install).
 *
 *   data/db.json   users, statistics, settings, last errors
 *
 * Writes are debounced and atomic (tmp file + rename), and flushed on shutdown.
 * Fine for thousands of users. If the bot grows to 50k+ users, move this module
 * to SQLite/Supabase: every other file only talks to the functions exported below.
 *
 * Old data/users.json (chatId -> language) is imported automatically on the first run.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const OLD_USERS_FILE = path.join(DATA_DIR, 'users.json');

// Statistics "days" start at midnight of this UTC offset (Uzbekistan = +5).
const TZ_HOURS = process.env.TZ_OFFSET_HOURS !== undefined && process.env.TZ_OFFSET_HOURS !== '' && Number.isFinite(Number(process.env.TZ_OFFSET_HOURS))
  ? Number(process.env.TZ_OFFSET_HOURS)
  : 5;

const dayOf = (ms = Date.now()) => new Date(ms + TZ_HOURS * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n) => dayOf(Date.now() - n * 24 * 3600 * 1000);

function defaults() {
  return {
    version: 1,
    users: {},
    stats: { cards: 0, errors: 0, byTemplate: {}, byLang: {}, byDay: {} },
    settings: {
      maintenance: false,
      dailyLimit: 20,        // cards per user per day (0 = unlimited)
      minIntervalSec: 5,     // seconds between two cards of one user (0 = off)
      disabledTemplates: [],
      footer: null,          // null = "@botusername", '' = no footer, otherwise custom text
      requiredChannel: '',   // '@channel' => users must subscribe first, '' = off
    },
    errorLog: [],
  };
}

function newUser(id, lang, now) {
  return {
    id,
    lang: lang || null,
    username: null,
    firstName: null,
    joinedAt: now,
    joinedDay: dayOf(now),
    lastSeen: now,
    cards: 0,
    lastCardAt: 0,
    today: { date: '', count: 0 },
    blocked: false,    // blocked by an admin
    botBlocked: false, // the user blocked the bot in Telegram
  };
}

let data = defaults();
let saveTimer = null;

function load() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const bad = `${FILE}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(FILE, bad);
        log.error(`data/db.json could not be read (${err.message}); moved to ${bad}, starting fresh`);
      } catch (_) { /* ignore */ }
    }
  }

  if (raw) {
    const d = defaults();
    data = {
      ...d,
      ...raw,
      stats: { ...d.stats, ...raw.stats },
      settings: { ...d.settings, ...raw.settings },
      users: raw.users || {},
      errorLog: raw.errorLog || [],
    };
    return;
  }

  // First run: import users from the old data/users.json if it exists
  try {
    const old = JSON.parse(fs.readFileSync(OLD_USERS_FILE, 'utf8'));
    const now = Date.now();
    let n = 0;
    for (const [id, lang] of Object.entries(old)) {
      if (!Number.isFinite(Number(id))) continue;
      data.users[id] = newUser(Number(id), typeof lang === 'string' ? lang : null, now);
      n++;
    }
    log.info(`Imported ${n} users from data/users.json`);
  } catch (_) { /* nothing to import */ }
}

function writeNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    log.error('Cannot save data/db.json:', err.message);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 500);
}

function flush() {
  clearTimeout(saveTimer);
  writeNow();
}

load();

// ───────────────────────── users ─────────────────────────

function getUser(chatId) {
  return data.users[String(chatId)] || null;
}

function bumpDay(field, n = 1) {
  const d = dayOf();
  const entry = (data.stats.byDay[d] ||= { new: 0, cards: 0 });
  entry[field] = (entry[field] || 0) + n;
  const keys = Object.keys(data.stats.byDay).sort();
  while (keys.length > 90) delete data.stats.byDay[keys.shift()];
}

/** Create the user on first contact and refresh name / username / last seen. */
function touchUser(from, chatId) {
  const key = String(chatId);
  const now = Date.now();
  let u = data.users[key];
  if (!u) {
    u = newUser(Number(chatId), null, now);
    data.users[key] = u;
    bumpDay('new');
  }
  u.lastSeen = now;
  if (from) {
    u.username = from.username || null;
    u.firstName = from.first_name || null;
  }
  if (u.botBlocked) u.botBlocked = false;
  scheduleSave();
  return u;
}

function setLang(chatId, code) {
  const u = getUser(chatId);
  if (!u) return;
  u.lang = code;
  scheduleSave();
}

function setBlocked(chatId, flag) {
  const u = getUser(chatId);
  if (!u) return false;
  u.blocked = !!flag;
  scheduleSave();
  return true;
}

function markBotBlocked(chatId, flag) {
  const u = getUser(chatId);
  if (!u) return;
  u.botBlocked = !!flag;
  scheduleSave();
}

/** Find by numeric id, "@username" or "username". */
function findUser(query) {
  const q = String(query || '').trim().replace(/^@/, '');
  if (!q) return null;
  if (/^\d+$/.test(q)) return getUser(q);
  const low = q.toLowerCase();
  return Object.values(data.users).find((u) => u.username && u.username.toLowerCase() === low) || null;
}

function recentUsers(n = 10) {
  return Object.values(data.users).sort((a, b) => b.joinedAt - a.joinedAt).slice(0, n);
}

/** Everybody who can still receive a broadcast. */
function broadcastRecipients() {
  return Object.values(data.users).filter((u) => !u.botBlocked && !u.blocked).map((u) => u.id);
}

// ───────────────────────── limits & cards ─────────────────────────

/** { ok: true } or { ok: false, reason: 'wait', sec } / { ok: false, reason: 'daily', limit } */
function checkLimits(chatId, exempt = false) {
  if (exempt) return { ok: true };
  const u = getUser(chatId);
  if (!u) return { ok: true };
  const s = data.settings;
  const now = Date.now();

  if (s.minIntervalSec > 0) {
    const wait = Math.ceil((u.lastCardAt + s.minIntervalSec * 1000 - now) / 1000);
    if (wait > 0) return { ok: false, reason: 'wait', sec: wait };
  }
  if (s.dailyLimit > 0) {
    const used = u.today.date === dayOf() ? u.today.count : 0;
    if (used >= s.dailyLimit) return { ok: false, reason: 'daily', limit: s.dailyLimit };
  }
  return { ok: true };
}

function recordCard(chatId, templateId, lang) {
  const u = getUser(chatId);
  const day = dayOf();
  if (u) {
    u.cards++;
    u.lastCardAt = Date.now();
    if (u.today.date !== day) u.today = { date: day, count: 0 };
    u.today.count++;
  }
  data.stats.cards++;
  data.stats.byTemplate[templateId] = (data.stats.byTemplate[templateId] || 0) + 1;
  data.stats.byLang[lang] = (data.stats.byLang[lang] || 0) + 1;
  bumpDay('cards');
  scheduleSave();
}

// ───────────────────────── settings & errors ─────────────────────────

function settings() {
  return data.settings;
}

function updateSettings(patch) {
  Object.assign(data.settings, patch);
  scheduleSave();
  return data.settings;
}

function pushError(context, message) {
  data.errorLog.push({ t: Date.now(), ctx: String(context), msg: String(message).slice(0, 300) });
  while (data.errorLog.length > 50) data.errorLog.shift();
  data.stats.errors++;
  scheduleSave();
}

function lastErrors(n = 10) {
  return data.errorLog.slice(-n).reverse();
}

// ───────────────────────── statistics ─────────────────────────

function getStats() {
  const users = Object.values(data.users);
  const today = dayOf();
  const weekStart = daysAgo(6);
  const byDay = data.stats.byDay;

  let cards7 = 0;
  for (const [d, e] of Object.entries(byDay)) if (d >= weekStart) cards7 += e.cards || 0;

  return {
    totalUsers: users.length,
    newToday: users.filter((u) => u.joinedDay === today).length,
    new7: users.filter((u) => u.joinedDay >= weekStart).length,
    activeToday: users.filter((u) => dayOf(u.lastSeen) === today).length,
    botBlocked: users.filter((u) => u.botBlocked).length,
    adminBlocked: users.filter((u) => u.blocked).length,
    cardsTotal: data.stats.cards,
    cardsToday: (byDay[today] && byDay[today].cards) || 0,
    cards7,
    byTemplate: { ...data.stats.byTemplate },
    byLang: { ...data.stats.byLang },
    errors: data.stats.errors,
  };
}

module.exports = {
  dayOf, flush,
  getUser, touchUser, setLang, setBlocked, markBotBlocked, findUser, recentUsers, broadcastRecipients,
  checkLimits, recordCard,
  settings, updateSettings, pushError, lastErrors, getStats,
};
