'use strict';

/** Escape text for Telegram HTML parse mode. */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "123, 456;789" -> Set { 123, 456, 789 } (only positive integers). */
function parseIds(str) {
  return new Set(
    String(str || '')
      .split(/[\s,;]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

module.exports = { escapeHtml, sleep, parseIds };
