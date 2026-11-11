'use strict';

/**
 * Tiny logger: prints to the console AND appends to logs/bot.log
 * (the file is rotated to bot.log.1 when it grows over 2 MB).
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const MAX_BYTES = 2 * 1024 * 1024;

function format(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch (_) {
    return String(arg);
  }
}

function write(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map(format).join(' ')}\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch (_) {
      /* file does not exist yet */
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    /* logging must never crash the bot */
  }
}

module.exports = {
  info: (...a) => { console.log(...a); write('INFO', a); },
  warn: (...a) => { console.warn(...a); write('WARN', a); },
  error: (...a) => { console.error(...a); write('ERROR', a); },
};
