'use strict';
// Offline unit tests (no Telegram, no canvas needed):   npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// db.js must write into a temporary folder, not into ./data
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyb-unit-'));
process.env.DATA_DIR = tmp;
process.env.LOG_DIR = tmp;

const { latinToCyrillic, cyrillicToLatin, detectScript, convertName } = require('../translit');
const db = require('../db');
const { parseIds } = require('../util');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name + '\n      ' + err.message);
    process.exitCode = 1;
  }
}

// ── translit ──
test('Latin -> Cyrillic (Uzbek names)', () => {
  assert.strictEqual(latinToCyrillic('Oʻktam Gʻaniyev'), 'Ўктам Ғаниев');
  assert.strictEqual(latinToCyrillic('Abdullayeva Jasmina'), 'Абдуллаева Жасмина');
  assert.strictEqual(latinToCyrillic('Elmira'), 'Элмира');
  assert.strictEqual(latinToCyrillic("Ma'mur"), 'Маъмур');
  assert.strictEqual(latinToCyrillic('Diyor Rahimov'), 'Диёр Раҳимов');
  assert.strictEqual(latinToCyrillic('SHERZOD'), 'ШЕРЗОД');
});
test('Cyrillic -> Latin', () => {
  assert.strictEqual(cyrillicToLatin('Ўктам Ғаниев'), 'Oʻktam Gʻaniyev');
  assert.strictEqual(cyrillicToLatin('Жасмина Абдуллаева'), 'Jasmina Abdullayeva');
  assert.strictEqual(cyrillicToLatin('Елена'), 'Yelena');
  assert.strictEqual(cyrillicToLatin('ШЕРЗОД'), 'SHERZOD');
});
test('round trip keeps the name', () => {
  for (const n of ['Oʻktam Gʻaniyev', 'Diyor Rahimov', 'Jasmina Abdullayeva']) {
    assert.strictEqual(cyrillicToLatin(latinToCyrillic(n)), n);
  }
});
test('script detection and convertName', () => {
  assert.strictEqual(detectScript('Ali'), 'lat');
  assert.strictEqual(detectScript('Али'), 'cyr');
  assert.strictEqual(detectScript('123'), 'none');
  assert.strictEqual(convertName('Али'), 'Ali');
  assert.strictEqual(convertName('Ali'), 'Али');
});

// ── util ──
test('parseIds', () => {
  assert.deepStrictEqual([...parseIds('123, 456;789 abc -5 0')], [123, 456, 789]);
  assert.strictEqual(parseIds('').size, 0);
  assert.strictEqual(parseIds(undefined).size, 0);
});

// ── db ──
test('users, limits and statistics', () => {
  const u = db.touchUser({ id: 1, first_name: 'Ali', username: 'ali' }, 1);
  assert.strictEqual(u.username, 'ali');
  assert.strictEqual(db.findUser('@ALI').id, 1);

  db.updateSettings({ minIntervalSec: 5, dailyLimit: 2 });
  assert.strictEqual(db.checkLimits(1).ok, true);
  db.recordCard(1, 'cert1', 'uz');
  let lim = db.checkLimits(1);
  assert.strictEqual(lim.ok, false);
  assert.strictEqual(lim.reason, 'wait');
  assert.strictEqual(db.checkLimits(1, true).ok, true, 'admins are exempt');

  db.updateSettings({ minIntervalSec: 0 });
  assert.strictEqual(db.checkLimits(1).ok, true);
  db.recordCard(1, 'greet1', 'en');
  lim = db.checkLimits(1);
  assert.strictEqual(lim.reason, 'daily');
  assert.strictEqual(lim.limit, 2);

  const s = db.getStats();
  assert.strictEqual(s.totalUsers, 1);
  assert.strictEqual(s.cardsTotal, 2);
  assert.strictEqual(s.cardsToday, 2);
  assert.strictEqual(s.byTemplate.cert1, 1);
  assert.strictEqual(s.byLang.en, 1);
});
test('block flags and broadcast recipients', () => {
  db.touchUser({ id: 2, first_name: 'Vali' }, 2);
  db.touchUser({ id: 3, first_name: 'Sami' }, 3);
  assert.strictEqual(db.broadcastRecipients().length, 3);
  db.setBlocked(2, true);
  db.markBotBlocked(3, true);
  assert.deepStrictEqual(db.broadcastRecipients(), [1]);
  db.touchUser({ id: 3, first_name: 'Sami' }, 3); // writing to the bot again clears botBlocked
  assert.deepStrictEqual(db.broadcastRecipients().sort(), [1, 3]);
});
test('db survives a flush + reload and imports old users.json', () => {
  db.pushError('ctx', 'something failed');
  db.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'));
  assert.strictEqual(Object.keys(saved.users).length, 3);
  assert.strictEqual(saved.errorLog[0].msg, 'something failed');
  assert.ok(!fs.existsSync(path.join(tmp, 'db.json.tmp')), 'no leftover tmp file');

  // fresh folder with an old-style users.json -> imported on first run
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nyb-unit2-'));
  fs.writeFileSync(path.join(tmp2, 'users.json'), JSON.stringify({ 111: 'uz', 222: 'en' }));
  const { execFileSync } = require('child_process');
  const out = execFileSync(
    process.execPath,
    ['-e', "const db=require('./db');console.log(JSON.stringify([db.getUser(111).lang,db.getUser(222).lang,db.getStats().totalUsers]))"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: tmp2, LOG_DIR: tmp2 } }
  ).toString().trim().split('\n').pop();
  assert.strictEqual(out, '["uz","en",2]');
});

console.log(`\n${passed} tests passed` + (process.exitCode ? ' — SOME FAILED' : ''));
setTimeout(() => process.exit(process.exitCode || 0), 50);
