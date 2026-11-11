'use strict';
// Offline check (no Telegram):  npm run test-render  ->  writes samples to ./test-output
const fs = require('fs');
const path = require('path');
const { TEMPLATES, initAssets, generateImage } = require('./render');
const { languages } = require('./i18n');

(async () => {
  const langs = languages().map((l) => l.code);
  console.log('Assets:', initAssets(langs));

  const outDir = path.join(__dirname, 'test-output');
  fs.mkdirSync(outDir, { recursive: true });

  const samples = ['Oʻktam Gʻaniyev', 'Жасмина Абдуллаева', 'Muhammad Abdurahmonov-Karimov Jr.'];
  for (const lang of langs) {
    for (const id of Object.keys(TEMPLATES)) {
      for (const [i, name] of samples.entries()) {
        const file = path.join(outDir, `${id}-${lang}-${i + 1}.jpg`);
        fs.writeFileSync(file, await generateImage(id, name, lang, { footer: '@yourbot' }));
        console.log('wrote', file);
      }
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
