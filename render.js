'use strict';

/**
 * render.js — template geometry + image rendering (no Telegram code here).
 * Used by index.js (the bot) and test-render.js (offline preview).
 *
 * Template images are per language:  assets/<base>_<lang>.jpg
 * e.g. assets/template1_uz.jpg, assets/template1_en.jpg
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const ASSETS_DIR = path.join(__dirname, 'assets');
const FONTS_DIR = path.join(ASSETS_DIR, 'fonts');
const FALLBACK_LANG = 'en';

/**
 * Template geometry (coordinates are RELATIVE to the image size, 0..1).
 *   x        : horizontal anchor (0.5 = exact center)
 *   y        : vertical middle of the name (0 = top, 1 = bottom)
 *   fontSize : starting font size as a fraction of image HEIGHT
 *   maxWidth : max name width as a fraction of image WIDTH (font shrinks to fit)
 *   footer   : small text at the bottom (e.g. "@botname"): x, y, size (fraction of height), color
 * Labels and captions are translated, see locales/<lang>.json -> "templates".
 *
 * Fonts in assets/fonts/ support Latin + Cyrillic (needed for Uzbek/Russian names).
 */
const TEMPLATES = {
  cert1: {
    base: 'template1',
    font: { file: 'NameFont-Elegant.ttf', family: 'NYElegant' },
    x: 0.5, y: 0.516, fontSize: 0.1, maxWidth: 0.54,
    color: '#7a1f1f',
    footer: { x: 0.5, y: 0.983, size: 0.02, color: 'rgba(122, 31, 31, 0.65)' },
  },
  greet1: {
    base: 'template2',
    font: { file: 'NameFont-Elegant.ttf', family: 'NYElegant' },
    x: 0.5, y: 0.4875, fontSize: 0.075, maxWidth: 0.72,
    color: '#ffffff',
    footer: { x: 0.5, y: 0.978, size: 0.017, color: 'rgba(40, 60, 110, 0.75)' },
  },
  greet2: {
    base: 'template3',
    font: { file: 'NameFont-Bold.ttf', family: 'NYBold' },
    x: 0.5, y: 0.543, fontSize: 0.075, maxWidth: 0.7,
    color: '#12347a',
    footer: { x: 0.5, y: 0.978, size: 0.019, color: 'rgba(40, 80, 130, 0.75)' },
  },
  greet3: {
    base: 'template4',
    font: { file: 'NameFont-Classic.ttf', family: 'NYClassic' },
    x: 0.5, y: 0.509, fontSize: 0.09, maxWidth: 0.66,
    color: '#ffe08a',
    footer: { x: 0.5, y: 0.972, size: 0.024, color: 'rgba(255, 224, 138, 0.8)' },
  },
};

function imagePath(tpl, lang) {
  return path.join(ASSETS_DIR, `${tpl.base}_${lang}.jpg`);
}

/** Verify assets exist for every language and register fonts once. Throws a readable error. */
function initAssets(langs) {
  const registered = new Set();
  const problems = [];

  for (const [id, tpl] of Object.entries(TEMPLATES)) {
    for (const lang of langs) {
      const p = imagePath(tpl, lang);
      if (!fs.existsSync(p)) problems.push(`Template image missing: ${p} (for "${id}", language "${lang}")`);
    }
    const fontPath = path.join(FONTS_DIR, tpl.font.file);
    if (!fs.existsSync(fontPath)) {
      problems.push(`Font missing: ${fontPath} (for "${id}")`);
    } else if (!registered.has(tpl.font.family)) {
      registerFont(fontPath, { family: tpl.font.family });
      registered.add(tpl.font.family);
    }
  }
  if (problems.length) {
    throw new Error('Asset problems:\n - ' + problems.join('\n - ') +
      '\n\nTip: run `npm run make-templates` to (re)create template images for all languages.');
  }
  return { templates: Object.keys(TEMPLATES).length, languages: langs.length, fonts: registered.size };
}

const imageCache = new Map();
async function getImage(file) {
  if (!imageCache.has(file)) imageCache.set(file, await loadImage(file));
  return imageCache.get(file);
}

/**
 * Draw `name` on the template (in the given language); returns an image Buffer.
 * Text is centered on (x, y) and shrinks automatically if too wide.
 *
 * opts.footer : optional small text drawn at the bottom of the card (e.g. "@mybot")
 * opts.format : 'jpeg' (default, small) or 'png' (lossless, for "download in full quality")
 */
async function generateImage(templateId, name, lang = FALLBACK_LANG, opts = {}) {
  const tpl = TEMPLATES[templateId];
  if (!tpl) throw new Error(`Unknown template: ${templateId}`);

  let file = imagePath(tpl, lang);
  if (!fs.existsSync(file)) file = imagePath(tpl, FALLBACK_LANG);
  const image = await getImage(file);

  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, image.width, image.height);

  const posX = image.width * tpl.x;
  const posY = image.height * tpl.y;
  const maxTextWidth = image.width * tpl.maxWidth;

  // Shrink the font until the name fits. The loop always leaves ctx.font set to the size
  // that was actually measured last (the old version could draw with a stale size).
  let fontSize = Math.round(image.height * tpl.fontSize);
  const minFontSize = Math.max(12, Math.round(fontSize * 0.35));
  let textWidth;
  for (;;) {
    ctx.font = `${fontSize}px "${tpl.font.family}"`;
    textWidth = ctx.measureText(name).width;
    if (textWidth <= maxTextWidth || fontSize <= minFontSize) break;
    fontSize = Math.max(minFontSize, fontSize - 2);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tpl.color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;

  if (textWidth > maxTextWidth) {
    // Still too wide at the minimum size (very long / very wide names):
    // squeeze horizontally so the text never leaves its frame or the card.
    ctx.save();
    ctx.translate(posX, posY);
    ctx.scale(maxTextWidth / textWidth, 1);
    ctx.fillText(name, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(name, posX, posY);
  }

  // Optional footer (no shadow, small, centered)
  if (opts.footer && tpl.footer) {
    const f = tpl.footer;
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.font = `${Math.round(image.height * f.size)}px "${tpl.font.family}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = f.color;
    ctx.fillText(String(opts.footer), image.width * f.x, image.height * f.y, image.width * 0.6);
    ctx.restore();
  }

  if (opts.format === 'png') return canvas.toBuffer('image/png');
  return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { TEMPLATES, initAssets, generateImage };
