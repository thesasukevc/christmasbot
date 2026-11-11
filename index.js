'use strict';

/**
 * New Year Certificate & Greeting Card Generator Bot (multi-language)
 * Stack: node-telegram-bot-api + canvas
 *
 * User flow:
 *   /start -> (first time) choose language -> choose design -> type full name
 *   -> bot draws the name on the template -> sends photo (+ buttons: full-quality file,
 *      share, Latin/Cyrillic) -> state cleared
 *
 * Admin flow: /admin  (see admin.js)   — only for Telegram IDs in ADMIN_IDS
 *
 * Files:
 *   index.js    bot logic        admin.js   admin panel      db.js       users/stats/settings
 *   render.js   drawing          i18n.js    locales          translit.js Latin <-> Cyrillic
 */

require('dotenv').config();

const log = require('./logger');
const db = require('./db');
const { escapeHtml, sleep, parseIds } = require('./util');
const { convertName, detectScript } = require('./translit');

// Load the Telegram library defensively: different versions / Node.js releases
// expose the class in different ways (module itself, .default, .TelegramBot).
function loadTelegramBot() {
  const mod = require('node-telegram-bot-api');
  const candidates = [
    mod,
    mod && mod.default,
    mod && mod.TelegramBot,
    mod && mod.default && mod.default.default,
    mod && mod.default && mod.default.TelegramBot,
  ];
  const found = candidates.find((c) => typeof c === 'function');
  if (!found) {
    log.error('❌ Cannot load node-telegram-bot-api. Export type: ' + typeof mod + ' | keys: ' + (mod ? Object.keys(mod) : mod));
    log.error('   Fix: npm install node-telegram-bot-api@0.66.0 --save-exact');
    process.exit(1);
  }
  return found;
}
const TelegramBot = loadTelegramBot();

const { TEMPLATES, initAssets, generateImage } = require('./render');
const { DEFAULT_LANG, languages, hasLang, t, tpl, commands, descriptions } = require('./i18n');
const { createAdmin } = require('./admin');

// ─────────────────────────────────────────────────────────────
// 1. CONFIGURATION
// ─────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN || BOT_TOKEN.includes('PASTE_YOUR_TOKEN')) {
  log.error('❌ BOT_TOKEN is missing (or still the placeholder from .env.example). Put the real token from @BotFather in .env: BOT_TOKEN=123456:ABC...');
  process.exit(1);
}

const ADMIN_IDS = parseIds(process.env.ADMIN_IDS);
if (ADMIN_IDS.size === 0) log.warn('⚠️  ADMIN_IDS is empty — the admin panel is disabled. Add your Telegram ID to .env: ADMIN_IDS=123456789');

// Webhook mode (optional). Leave WEBHOOK_URL empty to use long polling.
const WEBHOOK_URL = (process.env.WEBHOOK_URL || '').replace(/\/+$/, '');
const PORT = Number(process.env.PORT) || 3000;

// How long (ms) a user may stay in the "waiting for name" state before it expires.
const STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes
// How long the "download full quality / other alphabet" buttons keep working.
const LAST_CARD_TTL_MS = 60 * 60 * 1000; // 1 hour

// Name validation limits
const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 50;

// Fail fast if a template image or font is missing
try {
  const info = initAssets(languages().map((l) => l.code));
  log.info(`✅ Assets OK (${info.templates} templates × ${info.languages} languages, ${info.fonts} fonts)`);
} catch (err) {
  log.error('❌ ' + err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// 2. STATE
// ─────────────────────────────────────────────────────────────

const startedAt = Date.now();

const bot = WEBHOOK_URL
  ? new TelegramBot(BOT_TOKEN, { webHook: { port: PORT } })
  : new TelegramBot(BOT_TOKEN, { polling: { autoStart: false } }); // started in main(), after deleteWebHook

/** Filled in main() by getMe(). */
let me = { id: 0, username: '' };

/** chatId -> { templateId, createdAt }  (temporary, in memory) */
const userState = new Map();

/** chatId -> { templateId, name, lang, at } — last finished card (for the buttons under it) */
const lastCards = new Map();

/** Chats currently being rendered (prevents double-processing on spam) */
const busy = new Set();

// Periodically drop expired states so memory never grows unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [chatId, state] of userState) if (now - state.createdAt > STATE_TTL_MS) userState.delete(chatId);
  for (const [chatId, card] of lastCards) if (now - card.at > LAST_CARD_TTL_MS) lastCards.delete(chatId);
}, 5 * 60 * 1000).unref();

const isAdmin = (id) => ADMIN_IDS.has(Number(id));

const admin = createAdmin({
  bot,
  isAdmin,
  getMe: () => me,
  templates: TEMPLATES,
  tplLabel: (id) => tpl('uz', id).label,
  languages,
  startedAt,
});

/** Saved language of a chat, or null if the user has not chosen one yet. */
function getLang(chatId) {
  const u = db.getUser(chatId);
  return u && hasLang(u.lang) ? u.lang : null;
}

// ─────────────────────────────────────────────────────────────
// 3. HELPERS
// ─────────────────────────────────────────────────────────────

let lastAlertAt = 0;
let suppressedAlerts = 0;

function notifyAdmins(text) {
  for (const id of ADMIN_IDS) bot.sendMessage(id, text, { parse_mode: 'HTML' }).catch(() => {});
}

/** Log an error, remember it for the admin panel and (rate-limited) alert the admins. */
function reportError(context, err) {
  const msg = err && err.message ? err.message : String(err);
  log.error(`[${context}]`, err);
  db.pushError(context, msg);

  const now = Date.now();
  if (now - lastAlertAt > 30 * 1000) {
    notifyAdmins(
      `⚠️ <b>Xato</b> [${escapeHtml(context)}]\n<code>${escapeHtml(msg.slice(0, 300))}</code>` +
        (suppressedAlerts ? `\n(+${suppressedAlerts} ta oldingi xato)` : '')
    );
    lastAlertAt = now;
    suppressedAlerts = 0;
  } else {
    suppressedAlerts++;
  }
}

/**
 * Register / refresh the user and apply "blocked" and "maintenance".
 * Returns true if the update may continue.
 */
async function guard(from, chatId, opts = {}) {
  if (!from) return false;
  const user = db.touchUser(from, chatId);
  if (isAdmin(from.id)) return true;

  if (user.blocked) {
    if (opts.callbackId) await bot.answerCallbackQuery(opts.callbackId).catch(() => {});
    return false;
  }
  if (db.settings().maintenance) {
    const lang = hasLang(user.lang) ? user.lang : DEFAULT_LANG;
    if (opts.callbackId) await bot.answerCallbackQuery(opts.callbackId, { text: t(lang, 'maintenance'), show_alert: true }).catch(() => {});
    else await bot.sendMessage(chatId, t(lang, 'maintenance')).catch(() => {});
    return false;
  }
  return true;
}

const isTemplateEnabled = (id) =>
  Object.prototype.hasOwnProperty.call(TEMPLATES, id) && !db.settings().disabledTemplates.includes(id);

/** Text drawn at the bottom of every card ('' = none). */
function footerText() {
  const f = db.settings().footer;
  if (f === null || f === undefined) return me.username ? '@' + me.username : '';
  return f;
}

/** Is the user subscribed to the required channel? (true when the feature is off or cannot be checked) */
async function checkSubscription(userId) {
  const channel = db.settings().requiredChannel;
  if (!channel || isAdmin(userId)) return true;
  try {
    const m = await bot.getChatMember(channel, userId);
    return ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member === true);
  } catch (err) {
    // Bot is not an admin of the channel, channel renamed, ... -> do not lock users out, tell the admins.
    reportError('subscription check (' + channel + ')', err);
    return true;
  }
}

/** Design buttons (two per row, translated) + a "change language" button. */
function buildTemplateKeyboard(lang) {
  const buttons = Object.keys(TEMPLATES)
    .filter(isTemplateEnabled)
    .map((id) => ({ text: tpl(lang, id).label, callback_data: `tpl:${id}` }));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: t(lang, 'changeLang'), callback_data: 'lang:menu' }]);
  return { inline_keyboard: rows };
}

/** Language buttons, built from the locales folder (two per row). */
function buildLanguageKeyboard() {
  const buttons = languages().map((l) => ({ text: `${l.flag} ${l.name}`, callback_data: `lang:set:${l.code}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { inline_keyboard: rows };
}

function sendLanguageMenu(chatId) {
  const text = '🌐 ' + languages().map((l) => l.chooseLang).join(' / ');
  return bot.sendMessage(chatId, text, { reply_markup: buildLanguageKeyboard() });
}

function sendTemplateMenu(chatId, lang, text) {
  return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: buildTemplateKeyboard(lang) });
}

function sendWelcome(chatId, lang, firstName) {
  return sendTemplateMenu(chatId, lang, t(lang, 'welcome', { name: escapeHtml(firstName || '🎄') }));
}

function sendSubscribePrompt(chatId, lang) {
  const channel = db.settings().requiredChannel;
  return bot.sendMessage(chatId, t(lang, 'subscribe'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(lang, 'btnJoin'), url: `https://t.me/${channel.replace(/^@/, '')}` }],
        [{ text: t(lang, 'btnCheck'), callback_data: 'sub:check' }],
      ],
    },
  });
}

function limitText(lang, lim) {
  return lim.reason === 'wait' ? t(lang, 'rateWait', { sec: lim.sec }) : t(lang, 'dailyLimit', { limit: lim.limit });
}

/** Buttons under a finished card: full-quality file, share, (Uzbek only) other alphabet. */
function cardKeyboard(lang, name) {
  const rows = [[{ text: t(lang, 'btnDocument'), callback_data: 'doc' }]];
  if (me.username) {
    const link = `https://t.me/${me.username}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t(lang, 'shareText'))}`;
    rows.push([{ text: t(lang, 'btnShare'), url }]);
  }
  if (lang === 'uz') {
    const script = detectScript(name);
    if (script === 'cyr') rows.push([{ text: t(lang, 'btnToLat'), callback_data: 'script' }]);
    else if (script === 'lat') rows.push([{ text: t(lang, 'btnToCyr'), callback_data: 'script' }]);
  }
  return { inline_keyboard: rows };
}

/** Draw the card, send it as a photo with buttons and record it in the statistics. */
async function deliverCard(chatId, lang, templateId, name) {
  await bot.sendChatAction(chatId, 'upload_photo').catch(() => {});
  const buffer = await generateImage(templateId, name, lang, { footer: footerText() });

  await bot.sendPhoto(
    chatId,
    buffer,
    { caption: tpl(lang, templateId).caption, reply_markup: cardKeyboard(lang, name) },
    { filename: 'newyear.jpg', contentType: 'image/jpeg' }
  );

  lastCards.set(chatId, { templateId, name, lang, at: Date.now() });
  if (lastCards.size > 1000) lastCards.delete(lastCards.keys().next().value);
  db.recordCard(chatId, templateId, lang);
}

/**
 * Normalize and validate a user-supplied name.
 * Returns { ok: true, name } or { ok: false, errorKey, vars }.
 */
function validateName(raw) {
  const name = raw.replace(/\s+/g, ' ').trim();

  if (name.length < NAME_MIN_LEN) return { ok: false, errorKey: 'nameTooShort', vars: { min: NAME_MIN_LEN } };
  if (name.length > NAME_MAX_LEN) return { ok: false, errorKey: 'nameTooLong', vars: { max: NAME_MAX_LEN } };
  // Letters (any alphabet), combining marks, spaces, apostrophes (incl. Uzbek ʻ ʼ ‘ ’), dots, hyphens
  if (!/^[\p{L}\p{M}\s'’‘ʻʼ`.\-]+$/u.test(name)) return { ok: false, errorKey: 'nameInvalid', vars: {} };
  return { ok: true, name };
}

// ─────────────────────────────────────────────────────────────
// 4. HANDLERS
// ─────────────────────────────────────────────────────────────

// /start — first time: choose language; afterwards: welcome + design picker
bot.onText(/^\/start(?:@\w+)?(?:\s.*)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    if (msg.chat.type !== 'private') {
      return await bot.sendMessage(chatId, t(DEFAULT_LANG, 'groupsHint', { link: `https://t.me/${me.username}` }));
    }
    if (!(await guard(msg.from, chatId))) return;

    userState.delete(chatId); // always begin from a clean state
    admin.clearState(chatId);

    const lang = getLang(chatId);
    if (!lang) return await sendLanguageMenu(chatId);
    await sendWelcome(chatId, lang, msg.from?.first_name);
  } catch (err) {
    reportError('/start', err);
  }
});

// /language — change language at any time
bot.onText(/^\/language(?:@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    if (msg.chat.type !== 'private' || !(await guard(msg.from, chatId))) return;
    userState.delete(chatId);
    await sendLanguageMenu(chatId);
  } catch (err) {
    reportError('/language', err);
  }
});

// /cancel — abort the current flow
bot.onText(/^\/cancel(?:@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    if (msg.chat.type !== 'private' || !(await guard(msg.from, chatId))) return;
    const lang = getLang(chatId) || DEFAULT_LANG;
    const hadState = userState.delete(chatId);
    const hadAdminState = admin.clearState(chatId);
    await bot.sendMessage(chatId, t(lang, hadState || hadAdminState ? 'cancelled' : 'nothingToCancel'));
  } catch (err) {
    reportError('/cancel', err);
  }
});

// Inline buttons
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  const data = query.data || '';
  const answer = (opts) => bot.answerCallbackQuery(query.id, opts);

  try {
    if (!chatId || query.message.chat.type !== 'private') return await answer();

    // Admin panel buttons (admin.js checks the ID itself)
    if (data.startsWith('adm:')) return await admin.handleCallback(query);

    if (!(await guard(query.from, chatId, { callbackId: query.id }))) return;

    // "🌐 Language" button -> show the language list again
    if (data === 'lang:menu') {
      userState.delete(chatId);
      await answer();
      return await sendLanguageMenu(chatId);
    }

    // A language was chosen
    if (data.startsWith('lang:set:')) {
      const code = data.slice('lang:set:'.length);
      if (!hasLang(code)) return await answer();

      db.setLang(chatId, code);
      userState.delete(chatId);
      await answer();
      // Remove the language buttons from the old message to keep the chat tidy
      await bot
        .editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id })
        .catch(() => {});
      return await sendWelcome(chatId, code, query.from?.first_name);
    }

    // "Check subscription" button
    if (data === 'sub:check') {
      const lang = getLang(chatId) || DEFAULT_LANG;
      if (!(await checkSubscription(query.from.id))) {
        return await answer({ text: t(lang, 'notSubscribed'), show_alert: true });
      }
      await answer();
      await bot
        .editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id })
        .catch(() => {});
      return await sendTemplateMenu(chatId, lang, t(lang, 'subscribedOk'));
    }

    // A design was chosen
    if (data.startsWith('tpl:')) {
      const lang = getLang(chatId) || DEFAULT_LANG;
      const templateId = data.slice(4);

      if (!isTemplateEnabled(templateId)) {
        return await answer({ text: t(lang, 'designUnavailable'), show_alert: true });
      }

      // Forced channel subscription
      if (!(await checkSubscription(query.from.id))) {
        await answer();
        return await sendSubscribePrompt(chatId, lang);
      }

      const label = tpl(lang, templateId).label;
      userState.set(chatId, { templateId, createdAt: Date.now() }); // save selection

      await answer({ text: t(lang, 'selectedToast', { label }) });
      return await bot.sendMessage(chatId, t(lang, 'selected', { label: escapeHtml(label) }), { parse_mode: 'HTML' });
    }

    // Buttons under a finished card: full-quality file / other alphabet
    if (data === 'doc' || data === 'script') {
      const lang = getLang(chatId) || DEFAULT_LANG;
      const card = lastCards.get(chatId);
      if (!card) return await answer({ text: t(lang, 'cardExpired'), show_alert: true });
      if (busy.has(chatId)) return await answer();

      if (data === 'script') {
        const lim = db.checkLimits(chatId, isAdmin(query.from.id));
        if (!lim.ok) return await answer({ text: limitText(lang, lim), show_alert: true });
      }

      busy.add(chatId);
      try {
        await answer();
        if (data === 'doc') {
          await bot.sendChatAction(chatId, 'upload_document').catch(() => {});
          const png = await generateImage(card.templateId, card.name, card.lang, { footer: footerText(), format: 'png' });
          await bot.sendDocument(
            chatId,
            png,
            { caption: t(lang, 'docCaption') },
            { filename: 'newyear.png', contentType: 'image/png' }
          );
        } else {
          await deliverCard(chatId, card.lang, card.templateId, convertName(card.name));
        }
      } finally {
        busy.delete(chatId);
      }
      return;
    }

    await answer();
  } catch (err) {
    reportError('callback_query', err);
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
});

// Any normal message — expected to be the user's name
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg.chat.type !== 'private') return; // the bot works in private chats only
  if (msg.text && msg.text.startsWith('/')) return; // commands are handled above

  let ownsBusy = false; // true only while THIS handler holds the lock

  try {
    if (!(await guard(msg.from, chatId))) return;

    // An admin may be composing a broadcast
    if (await admin.handleMessage(msg)) return;

    const lang = getLang(chatId);

    // User has not chosen a language yet
    if (!lang) return await sendLanguageMenu(chatId);

    // Non-text content (photo, sticker, voice, ...)
    if (!msg.text) return await bot.sendMessage(chatId, t(lang, 'sendText'));

    const state = userState.get(chatId);

    // ERROR CASE: name typed before choosing a design (or the state expired / design was disabled)
    if (!state || Date.now() - state.createdAt > STATE_TTL_MS || !isTemplateEnabled(state.templateId)) {
      userState.delete(chatId);
      return await sendTemplateMenu(chatId, lang, t(lang, 'chooseFirst'));
    }

    const result = validateName(msg.text);
    if (!result.ok) {
      return await bot.sendMessage(chatId, `⚠️ ${t(lang, result.errorKey, result.vars)}\n\n${t(lang, 'retryHint')}`);
    }

    // Anti-spam: interval between cards + daily limit
    const lim = db.checkLimits(chatId, isAdmin(msg.from.id));
    if (!lim.ok) return await bot.sendMessage(chatId, limitText(lang, lim));

    // Prevent double processing if the user sends several messages quickly
    if (busy.has(chatId)) return;
    busy.add(chatId);
    ownsBusy = true;

    try {
      await deliverCard(chatId, lang, state.templateId, result.name);

      // Clear state so the user can generate another one
      userState.delete(chatId);

      await sendTemplateMenu(chatId, lang, t(lang, 'another'));
    } finally {
      busy.delete(chatId);
    }
  } catch (err) {
    reportError('message', err);
    if (ownsBusy) busy.delete(chatId);
    userState.delete(chatId);
    const lang = getLang(chatId) || DEFAULT_LANG;
    bot.sendMessage(chatId, t(lang, 'error')).catch(() => {});
  }
});

// The user blocked / unblocked the bot -> keep broadcast statistics accurate
bot.on('my_chat_member', (update) => {
  try {
    if (!update.chat || update.chat.type !== 'private') return;
    const status = update.new_chat_member && update.new_chat_member.status;
    if (status === 'kicked') db.markBotBlocked(update.chat.id, true);
    else if (status === 'member') db.markBotBlocked(update.chat.id, false);
  } catch (err) {
    log.warn('my_chat_member:', err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// 5. STARTUP, SHUTDOWN, GLOBAL ERROR HANDLING
// ─────────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  const code = err && err.response && err.response.body && err.response.body.error_code;
  if (code === 409) {
    // Another copy of the bot (or a webhook) is using this token
    reportError('polling 409', new Error('Conflict: another bot instance is running with the same token'));
  } else {
    log.warn('Polling error:', err.code, err.message);
  }
});
bot.on('webhook_error', (err) => log.warn('Webhook error:', err.code, err.message));
bot.on('error', (err) => log.warn('Bot error:', err.message));

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (!WEBHOOK_URL) await Promise.race([bot.stopPolling(), sleep(2000)]);
  } catch (_) { /* ignore */ }
  db.flush();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (reason) => reportError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason))));
process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err);
  db.flush();
  notifyAdmins(`🔴 <b>Bot yiqildi</b>\n<code>${escapeHtml(String(err.message).slice(0, 300))}</code>\nQayta ishga tushirilmoqda...`);
  setTimeout(() => process.exit(1), 1500); // pm2 / Docker restart the process
});

(async function main() {
  try {
    me = await bot.getMe();
  } catch (err) {
    log.error('❌ Cannot connect to Telegram. Check BOT_TOKEN and the internet connection:', err.message);
    process.exit(1);
  }

  try {
    if (WEBHOOK_URL) {
      await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
      log.info(`🌐 Webhook mode: ${WEBHOOK_URL}/bot<token> (port ${PORT})`);
    } else {
      await bot.deleteWebHook(); // a leftover webhook would block polling (409)
      await bot.startPolling();
    }
  } catch (err) {
    log.error('❌ Cannot start receiving updates:', err.message);
    process.exit(1);
  }

  // "/" command menu in each user's own Telegram language (+ extra commands for admins)
  try {
    await bot.setMyCommands(commands(DEFAULT_LANG));
    for (const l of languages()) await bot.setMyCommands(commands(l.code), { language_code: l.code });
    for (const id of ADMIN_IDS) {
      await bot
        .setMyCommands(
          [
            ...commands('uz'),
            { command: 'admin', description: 'Admin panel' },
            { command: 'stats', description: 'Statistika' },
            { command: 'broadcast', description: 'Hammaga xabar yuborish' },
          ],
          { scope: { type: 'chat', chat_id: id } }
        )
        .catch(() => {});
    }
  } catch (err) {
    log.warn('Could not set bot commands:', err.message);
  }

  // Bot profile texts (shown on the empty chat screen); needs a recent node-telegram-bot-api
  try {
    if (typeof bot.setMyDescription === 'function') {
      const base = descriptions(DEFAULT_LANG);
      await bot.setMyDescription({ description: base.description });
      await bot.setMyShortDescription({ short_description: base.shortDescription });
      for (const l of languages()) {
        const d = descriptions(l.code);
        await bot.setMyDescription({ description: d.description, language_code: l.code });
        await bot.setMyShortDescription({ short_description: d.shortDescription, language_code: l.code });
      }
    }
  } catch (err) {
    log.warn('Could not set bot description:', err.message);
  }

  log.info(`🤖 @${me.username} is running... Languages: ${languages().map((l) => l.code).join(', ')} | admins: ${ADMIN_IDS.size}`);
  notifyAdmins(`🟢 <b>Bot ishga tushdi</b> (@${escapeHtml(me.username)})`);
})();
