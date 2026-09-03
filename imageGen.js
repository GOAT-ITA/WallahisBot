const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

registerFont(path.join(__dirname, 'assets', 'Baloo2-ExtraBold-static.ttf'), {
  family: 'Baloo2ExtraBold',
});

const TEMPLATE_PATH = path.join(__dirname, 'assets', 'wallahi_template.jpg');
const CENTER_X = 627;
const CENTER_Y = 267;
const MAX_TEXT_WIDTH = 760; // margine di sicurezza prima che il numero tocchi i bordi
const BASE_FONT_SIZE = 190;

let cachedTemplate = null;
async function getTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = await loadImage(TEMPLATE_PATH);
  }
  return cachedTemplate;
}

/**
 * Generates a PNG buffer of the black & white "WALLAHIS LEFT:" template
 * with the given number drawn on top, matching the style of the
 * gold (100) and red (0) reference images.
 */
async function generateWallahiImage(number) {
  const template = await getTemplate();
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0);

  const text = String(number);

  // Riduce leggermente il font se il numero ha molte cifre, per non uscire dai bordi
  let fontSize = BASE_FONT_SIZE;
  ctx.font = `${fontSize}px "Baloo2ExtraBold"`;
  while (ctx.measureText(text).width > MAX_TEXT_WIDTH && fontSize > 60) {
    fontSize -= 5;
    ctx.font = `${fontSize}px "Baloo2ExtraBold"`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(10, fontSize * 0.095);
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#ffffff';

  ctx.strokeText(text, CENTER_X, CENTER_Y);
  ctx.fillText(text, CENTER_X, CENTER_Y);

  return canvas.toBuffer('image/jpeg', { quality: 0.88 });
}

module.exports = { generateWallahiImage };
