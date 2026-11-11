'use strict';

/**
 * admin.js — admin panel (Telegram buttons + commands). Texts are in Uzbek.
 *
 * Only Telegram IDs listed in ADMIN_IDS (.env) can use it; everybody else is ignored silently.
 *
 *   /admin       panel with buttons
 *   /stats       statistics
 *   /user <id|@username>      user card (+ block button)
 *   /block <id|@username>     /unblock <id|@username>
 *   /broadcast   send a message to everybody
 *   /setlimit N  /setinterval N  /setchannel @channel|off  /setfooter text|off|auto  /maintenance on|off
 */

const db = require('./db');
const log = require('./logger');
const { escapeHtml, sleep } = require('./util');

const BROADCAST_DELAY_MS = 45; // ~22 messages / second (Telegram allows ~30)

function createAdmin({ bot, isAdmin, getMe, templates, tplLabel, languages, startedAt }) {
  /** adminId -> { mode: 'bc_wait' } | { mode: 'bc_confirm', src: { chatId, messageId } } */
  const adminState = new Map();
  const broadcast = { running: false, stop: false };

  // ───────────────────────── helpers ─────────────────────────

  const fmtDate = (ms) => (ms ? new Date(ms + 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) : '—');

  function fmtUptime() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${d ? d + ' kun ' : ''}${h} soat ${m} daq`;
  }

  const userLine = (u) =>
    `• <code>${u.id}</code> ${u.username ? '@' + escapeHtml(u.username) : '—'} ${escapeHtml(u.firstName || '')}` +
    ` (${u.lang || '?'})${u.blocked ? ' 🚫' : ''}${u.botBlocked ? ' 💤' : ''}`;

  async function edit(query, text, kb) {
    try {
      await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: kb,
        disable_web_page_preview: true,
      });
    } catch (err) {
      if (!/not modified/i.test(err.message)) log.warn('admin edit failed:', err.message);
    }
  }

  const backRow = [{ text: '⬅️ Panel', callback_data: 'adm:home' }];

  // ───────────────────────── screens ─────────────────────────

  function homeScreen() {
    const s = db.getStats();
    const maint = db.settings().maintenance;
    return {
      text:
        `🛠 <b>Admin panel</b>\n\n` +
        `👥 Foydalanuvchilar: <b>${s.totalUsers}</b> (bugun +${s.newToday})\n` +
        `🖼 Bugungi kartochkalar: <b>${s.cardsToday}</b>\n` +
        `Holat: ${maint ? '🔴 texnik ishlar' : '🟢 ishlayapti'}`,
      kb: {
        inline_keyboard: [
          [{ text: '📊 Statistika', callback_data: 'adm:stats' }, { text: '👥 Foydalanuvchilar', callback_data: 'adm:users' }],
          [{ text: '📣 Xabar yuborish', callback_data: 'adm:bc' }, { text: '🎨 Dizaynlar', callback_data: 'adm:tpl' }],
          [{ text: '⚙️ Sozlamalar', callback_data: 'adm:set' }, { text: '🐞 Xatolar', callback_data: 'adm:err' }],
          [{ text: maint ? '🟢 Texnik ishlarni oʻchirish' : '🛠 Texnik ishlarni yoqish', callback_data: 'adm:maint' }],
        ],
      },
    };
  }

  function statsText() {
    const s = db.getStats();
    const totalCards = s.cardsTotal || 0;
    const pct = (n) => (totalCards ? Math.round((n / totalCards) * 100) : 0);

    const tplLines = Object.keys(templates).map((id) => {
      const n = s.byTemplate[id] || 0;
      return ` • ${escapeHtml(tplLabel(id))}: ${n} (${pct(n)}%)`;
    });
    const langLines = languages().map((l) => ` • ${l.flag} ${escapeHtml(l.name)}: ${s.byLang[l.code] || 0}`);

    return (
      `📊 <b>Statistika</b>\n\n` +
      `👥 <b>Foydalanuvchilar: ${s.totalUsers}</b>\n` +
      ` • Bugun yangi: ${s.newToday} · 7 kunda: ${s.new7}\n` +
      ` • Bugun faol: ${s.activeToday}\n` +
      ` • Botni bloklaganlar: ${s.botBlocked} · Admin bloklagan: ${s.adminBlocked}\n\n` +
      `🖼 <b>Kartochkalar: ${totalCards}</b>\n` +
      ` • Bugun: ${s.cardsToday} · 7 kunda: ${s.cards7}\n\n` +
      `🎨 <b>Dizaynlar</b>\n${tplLines.join('\n')}\n\n` +
      `🌐 <b>Tillar (kartochkalar)</b>\n${langLines.join('\n')}\n\n` +
      `⚠️ Xatolar (jami): ${s.errors}\n` +
      `⏱ Ishlash vaqti: ${fmtUptime()}`
    );
  }

  function usersScreen() {
    const s = db.getStats();
    const list = db.recentUsers(10).map(userLine).join('\n') || '—';
    return {
      text:
        `👥 <b>Foydalanuvchilar</b>: ${s.totalUsers}\n\n` +
        `<b>Oxirgi qoʻshilganlar:</b>\n${list}\n\n` +
        `🚫 — admin bloklagan, 💤 — botni bloklagan\n\n` +
        `Qidirish: <code>/user 123456789</code> yoki <code>/user @username</code>\n` +
        `Bloklash: <code>/block ID</code> · Ochish: <code>/unblock ID</code>`,
      kb: { inline_keyboard: [backRow] },
    };
  }

  function userScreen(u) {
    return {
      text:
        `👤 <b>Foydalanuvchi</b>\n\n` +
        `ID: <code>${u.id}</code>\n` +
        `Ism: ${escapeHtml(u.firstName || '—')}\n` +
        `Username: ${u.username ? '@' + escapeHtml(u.username) : '—'}\n` +
        `Til: ${u.lang || '—'}\n` +
        `Qoʻshilgan: ${fmtDate(u.joinedAt)}\n` +
        `Oxirgi faollik: ${fmtDate(u.lastSeen)}\n` +
        `Kartochkalar: ${u.cards} (bugun: ${u.today.date === db.dayOf() ? u.today.count : 0})\n` +
        `Admin bloklagan: ${u.blocked ? '🚫 ha' : 'yoʻq'}\n` +
        `Botni bloklagan: ${u.botBlocked ? '💤 ha' : 'yoʻq'}`,
      kb: {
        inline_keyboard: [
          [{ text: u.blocked ? '✅ Blokdan chiqarish' : '🚫 Bloklash', callback_data: `adm:ub:${u.id}` }],
          backRow,
        ],
      },
    };
  }

  function templatesScreen() {
    const disabled = db.settings().disabledTemplates;
    const rows = Object.keys(templates).map((id) => [
      { text: `${disabled.includes(id) ? '❌' : '✅'} ${tplLabel(id)}`, callback_data: `adm:tt:${id}` },
    ]);
    rows.push(backRow);
    return {
      text: '🎨 <b>Dizaynlar</b>\n\nTugmani bosib dizaynni yoqing yoki oʻchiring (✅ — foydalanuvchilarga koʻrinadi, ❌ — yashirilgan).',
      kb: { inline_keyboard: rows },
    };
  }

  function settingsScreen() {
    const s = db.settings();
    const footer = s.footer === null ? `avtomatik (@${getMe().username})` : s.footer === '' ? 'oʻchirilgan' : escapeHtml(s.footer);
    return {
      text:
        `⚙️ <b>Sozlamalar</b>\n\n` +
        `⏱ Kartochkalar orasidagi interval: <b>${s.minIntervalSec}</b> s\n<code>/setinterval 5</code> (0 — oʻchirish)\n\n` +
        `📅 Kunlik limit: <b>${s.dailyLimit || 'cheksiz'}</b>\n<code>/setlimit 20</code> (0 — cheksiz)\n\n` +
        `📢 Majburiy kanal: <b>${s.requiredChannel ? escapeHtml(s.requiredChannel) : 'oʻchirilgan'}</b>\n<code>/setchannel @kanal</code> yoki <code>/setchannel off</code>\n\n` +
        `🏷 Kartochka tagidagi yozuv: <b>${footer}</b>\n<code>/setfooter matn</code> · <code>/setfooter off</code> · <code>/setfooter auto</code>\n\n` +
        `🛠 Texnik ishlar: <b>${s.maintenance ? 'yoqilgan' : 'oʻchirilgan'}</b>\n<code>/maintenance on</code> / <code>/maintenance off</code>`,
      kb: { inline_keyboard: [backRow] },
    };
  }

  function errorsScreen() {
    const list = db.lastErrors(10);
    const body = list.length
      ? list.map((e) => `<b>${fmtDate(e.t)}</b> [${escapeHtml(e.ctx)}]\n<code>${escapeHtml(e.msg)}</code>`).join('\n\n')
      : 'Xatolar yoʻq 🎉';
    return { text: `🐞 <b>Oxirgi xatolar</b>\n\n${body}`, kb: { inline_keyboard: [backRow] } };
  }

  // ───────────────────────── broadcast ─────────────────────────

  async function runBroadcast(adminChatId, statusMessageId, src) {
    const recipients = db.broadcastRecipients();
    const total = recipients.length;
    let sent = 0;
    let blocked = 0;
    let failed = 0;
    let lastEdit = 0;

    broadcast.running = true;
    broadcast.stop = false;

    const progress = async (final) => {
      const done = sent + blocked + failed;
      const text = final
        ? `${broadcast.stop ? '⏹ <b>Toʻxtatildi</b>' : '✅ <b>Yuborish tugadi</b>'}\n\n` +
          `Yuborildi: <b>${sent}</b>\nBotni bloklaganlar: ${blocked}\nXato: ${failed}\nJami: ${total}`
        : `📣 <b>Yuborilmoqda...</b> ${done}/${total}\n\nYuborildi: ${sent} · Bloklagan: ${blocked} · Xato: ${failed}`;
      const kb = final
        ? { inline_keyboard: [backRow] }
        : { inline_keyboard: [[{ text: '⏹ Toʻxtatish', callback_data: 'adm:bcstop' }]] };
      await bot
        .editMessageText(text, { chat_id: adminChatId, message_id: statusMessageId, parse_mode: 'HTML', reply_markup: kb })
        .catch(() => {});
    };

    try {
      for (let i = 0; i < recipients.length; i++) {
        if (broadcast.stop) break;
        const id = recipients[i];

        let attempts = 0;
        for (;;) {
          try {
            await bot.copyMessage(id, src.chatId, src.messageId);
            sent++;
            break;
          } catch (err) {
            const body = (err && err.response && err.response.body) || {};
            const code = body.error_code;
            if (code === 429 && attempts < 3) {
              attempts++;
              await sleep(((body.parameters && body.parameters.retry_after) || 5) * 1000 + 500);
              continue;
            }
            if (code === 403 || (code === 400 && /chat not found|user is deactivated/i.test(body.description || ''))) {
              db.markBotBlocked(id, true);
              blocked++;
            } else {
              failed++;
              log.warn(`broadcast to ${id} failed:`, body.description || err.message);
            }
            break;
          }
        }

        await sleep(BROADCAST_DELAY_MS);
        if (Date.now() - lastEdit > 3000) {
          lastEdit = Date.now();
          await progress(false);
        }
      }
    } finally {
      broadcast.running = false;
      await progress(true);
      log.info(`Broadcast finished: sent=${sent} blocked=${blocked} failed=${failed} total=${total}`);
    }
  }

  // ───────────────────────── callbacks ─────────────────────────

  async function handleCallback(query) {
    const answer = (opts) => bot.answerCallbackQuery(query.id, opts).catch(() => {});
    if (!isAdmin(query.from.id)) return answer();

    const data = query.data || '';
    const adminId = query.from.id;
    const show = async (screen) => edit(query, screen.text, screen.kb);

    try {
      if (data === 'adm:home') {
        adminState.delete(adminId);
        await answer();
        return await show(homeScreen());
      }
      if (data === 'adm:stats') {
        await answer();
        return await show({ text: statsText(), kb: { inline_keyboard: [backRow] } });
      }
      if (data === 'adm:users') {
        await answer();
        return await show(usersScreen());
      }
      if (data === 'adm:tpl') {
        await answer();
        return await show(templatesScreen());
      }
      if (data.startsWith('adm:tt:')) {
        const id = data.slice('adm:tt:'.length);
        if (!Object.prototype.hasOwnProperty.call(templates, id)) return await answer();
        const disabled = new Set(db.settings().disabledTemplates);
        if (disabled.has(id)) disabled.delete(id);
        else disabled.add(id);
        db.updateSettings({ disabledTemplates: [...disabled] });
        await answer({ text: disabled.has(id) ? 'Yashirildi' : 'Yoqildi' });
        return await show(templatesScreen());
      }
      if (data === 'adm:set') {
        await answer();
        return await show(settingsScreen());
      }
      if (data === 'adm:err') {
        await answer();
        return await show(errorsScreen());
      }
      if (data === 'adm:maint') {
        const now = !db.settings().maintenance;
        db.updateSettings({ maintenance: now });
        await answer({ text: now ? 'Texnik ishlar rejimi YOQILDI' : 'Texnik ishlar rejimi oʻchirildi' });
        return await show(homeScreen());
      }
      if (data.startsWith('adm:ub:')) {
        const u = db.getUser(data.slice('adm:ub:'.length));
        if (!u) return await answer({ text: 'Foydalanuvchi topilmadi', show_alert: true });
        if (isAdmin(u.id)) return await answer({ text: 'Adminni bloklab boʻlmaydi', show_alert: true });
        db.setBlocked(u.id, !u.blocked);
        await answer({ text: u.blocked ? 'Bloklandi' : 'Blokdan chiqarildi' });
        return await show(userScreen(u));
      }

      // ── broadcast flow ──
      if (data === 'adm:bc') {
        if (broadcast.running) return await answer({ text: 'Hozir boshqa xabar yuborilmoqda.', show_alert: true });
        adminState.set(adminId, { mode: 'bc_wait' });
        await answer();
        return await show({
          text:
            '📣 <b>Xabar yuborish</b>\n\nYuboriladigan xabarni shu yerga yuboring (matn, rasm, video, hujjat...). ' +
            'U hamma foydalanuvchilarga aynan shu koʻrinishda boradi.\n\nBekor qilish: /cancel',
          kb: { inline_keyboard: [backRow] },
        });
      }
      if (data === 'adm:bcgo') {
        const st = adminState.get(adminId);
        if (!st || st.mode !== 'bc_confirm') return await answer({ text: 'Muddati oʻtgan. Qaytadan boshlang.', show_alert: true });
        if (broadcast.running) return await answer({ text: 'Hozir boshqa xabar yuborilmoqda.', show_alert: true });
        adminState.delete(adminId);
        await answer({ text: 'Yuborish boshlandi' });
        // do not await: runs in the background while the bot keeps answering users
        runBroadcast(query.message.chat.id, query.message.message_id, st.src).catch((err) => log.error('broadcast crashed:', err));
        return;
      }
      if (data === 'adm:bcno') {
        adminState.delete(adminId);
        await answer({ text: 'Bekor qilindi' });
        return await show(homeScreen());
      }
      if (data === 'adm:bcstop') {
        broadcast.stop = true;
        return await answer({ text: 'Toʻxtatilmoqda...' });
      }

      await answer();
    } catch (err) {
      log.error('admin callback error:', err);
      await answer();
    }
  }

  /**
   * Called for every non-command message BEFORE the normal user flow.
   * Returns true if the message was consumed (an admin is composing a broadcast).
   */
  async function handleMessage(msg) {
    if (!msg.from || !isAdmin(msg.from.id)) return false;
    const st = adminState.get(msg.from.id);
    if (!st || st.mode !== 'bc_wait') return false;

    const chatId = msg.chat.id;
    try {
      const src = { chatId, messageId: msg.message_id };
      const count = db.broadcastRecipients().length;
      await bot.sendMessage(chatId, '👆 Shunday koʻrinishda yuboriladi.', { reply_to_message_id: msg.message_id });
      await bot.sendMessage(chatId, `<b>${count}</b> ta foydalanuvchiga yuboriladi. Tasdiqlaysizmi?`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: `✅ Yuborish (${count})`, callback_data: 'adm:bcgo' },
            { text: '❌ Bekor', callback_data: 'adm:bcno' },
          ]],
        },
      });
      adminState.set(msg.from.id, { mode: 'bc_confirm', src });
    } catch (err) {
      log.error('admin broadcast prepare failed:', err);
      adminState.delete(msg.from.id);
      await bot.sendMessage(chatId, '❌ Xabarni tayyorlashda xato: ' + escapeHtml(err.message), { parse_mode: 'HTML' }).catch(() => {});
    }
    return true;
  }

  // ───────────────────────── commands ─────────────────────────

  function cmd(name, handler) {
    const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`);
    bot.onText(re, async (msg, match) => {
      if (msg.chat.type !== 'private' || !msg.from || !isAdmin(msg.from.id)) return; // silent for everyone else
      try {
        await handler(msg, (match[1] || '').trim());
      } catch (err) {
        log.error(`admin /${name} failed:`, err);
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + escapeHtml(err.message), { parse_mode: 'HTML' }).catch(() => {});
      }
    });
  }

  const reply = (msg, text, extra = {}) => bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', ...extra });

  cmd('admin', async (msg) => {
    adminState.delete(msg.from.id);
    const s = homeScreen();
    await reply(msg, s.text, { reply_markup: s.kb });
  });

  cmd('stats', async (msg) => reply(msg, statsText()));

  cmd('broadcast', async (msg) => {
    if (broadcast.running) return reply(msg, 'Hozir boshqa xabar yuborilmoqda.');
    adminState.set(msg.from.id, { mode: 'bc_wait' });
    await reply(msg, '📣 Yuboriladigan xabarni shu yerga yuboring (matn, rasm, video...). Bekor qilish: /cancel');
  });

  cmd('user', async (msg, arg) => {
    if (!arg) return reply(msg, 'Foydalanish: <code>/user 123456789</code> yoki <code>/user @username</code>');
    const u = db.findUser(arg);
    if (!u) return reply(msg, 'Foydalanuvchi topilmadi.');
    const s = userScreen(u);
    await reply(msg, s.text, { reply_markup: s.kb });
  });

  const blockCmd = (flag) => async (msg, arg) => {
    if (!arg) return reply(msg, `Foydalanish: <code>/${flag ? 'block' : 'unblock'} ID</code> yoki <code>@username</code>`);
    const u = db.findUser(arg);
    if (!u) return reply(msg, 'Foydalanuvchi topilmadi.');
    if (flag && isAdmin(u.id)) return reply(msg, 'Adminni bloklab boʻlmaydi.');
    db.setBlocked(u.id, flag);
    await reply(msg, flag ? `🚫 <code>${u.id}</code> bloklandi.` : `✅ <code>${u.id}</code> blokdan chiqarildi.`);
  };
  cmd('block', blockCmd(true));
  cmd('unblock', blockCmd(false));

  cmd('setlimit', async (msg, arg) => {
    if (!/^\d{1,5}$/.test(arg)) return reply(msg, 'Foydalanish: <code>/setlimit 20</code> (0 — cheksiz)');
    db.updateSettings({ dailyLimit: Number(arg) });
    await reply(msg, `📅 Kunlik limit: <b>${Number(arg) || 'cheksiz'}</b>`);
  });

  cmd('setinterval', async (msg, arg) => {
    if (!/^\d{1,4}$/.test(arg)) return reply(msg, 'Foydalanish: <code>/setinterval 5</code> (soniya, 0 — oʻchirish)');
    db.updateSettings({ minIntervalSec: Number(arg) });
    await reply(msg, `⏱ Interval: <b>${Number(arg)}</b> s`);
  });

  cmd('maintenance', async (msg, arg) => {
    if (!/^(on|off)$/i.test(arg)) return reply(msg, 'Foydalanish: <code>/maintenance on</code> yoki <code>/maintenance off</code>');
    const on = arg.toLowerCase() === 'on';
    db.updateSettings({ maintenance: on });
    await reply(msg, on ? '🛠 Texnik ishlar rejimi <b>yoqildi</b>. Oddiy foydalanuvchilar bot bilan ishlay olmaydi.' : '🟢 Texnik ishlar rejimi <b>oʻchirildi</b>.');
  });

  cmd('setfooter', async (msg, arg) => {
    if (!arg) return reply(msg, 'Foydalanish: <code>/setfooter @kanalim</code> · <code>/setfooter off</code> · <code>/setfooter auto</code>');
    const low = arg.toLowerCase();
    if (low === 'off') {
      db.updateSettings({ footer: '' });
      return reply(msg, '🏷 Kartochka tagidagi yozuv <b>oʻchirildi</b>.');
    }
    if (low === 'auto') {
      db.updateSettings({ footer: null });
      return reply(msg, `🏷 Yozuv avtomatik: <b>@${escapeHtml(getMe().username)}</b>`);
    }
    // eslint-disable-next-line no-control-regex
    const text = arg.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 40) return reply(msg, 'Yozuv 40 belgidan oshmasligi kerak.');
    db.updateSettings({ footer: text });
    await reply(msg, `🏷 Kartochka tagidagi yozuv: <b>${escapeHtml(text)}</b>`);
  });

  cmd('setchannel', async (msg, arg) => {
    if (!arg) return reply(msg, 'Foydalanish: <code>/setchannel @kanal</code> yoki <code>/setchannel off</code>');
    if (arg.toLowerCase() === 'off') {
      db.updateSettings({ requiredChannel: '' });
      return reply(msg, '📢 Majburiy obuna <b>oʻchirildi</b>.');
    }
    if (!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(arg)) {
      return reply(msg, 'Kanal nomi <code>@kanal_nomi</code> koʻrinishida boʻlishi kerak (ochiq kanal).');
    }
    let member;
    try {
      member = await bot.getChatMember(arg, getMe().id);
    } catch (err) {
      return reply(msg, `❌ ${escapeHtml(arg)} kanaliga kira olmadim. Avval botni kanalga <b>admin</b> qilib qoʻshing.\n<code>${escapeHtml(err.message)}</code>`);
    }
    db.updateSettings({ requiredChannel: arg });
    const isChannelAdmin = member.status === 'administrator' || member.status === 'creator';
    await reply(
      msg,
      `📢 Majburiy kanal: <b>${escapeHtml(arg)}</b>` +
        (isChannelAdmin ? '' : '\n⚠️ Bot kanalda admin emas — obunani tekshira olmaydi. Botni kanalga admin qiling.')
    );
  });

  return {
    handleCallback,
    handleMessage,
    clearState: (id) => adminState.delete(id),
  };
}

module.exports = { createAdmin };
