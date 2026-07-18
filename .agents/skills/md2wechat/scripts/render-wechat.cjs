#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const cheerio = require('cheerio');

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: render-wechat.cjs <input.md> <output.html>');
  process.exit(2);
}

const source = fs.readFileSync(inputPath, 'utf8');
const markdown = source
  .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
  .replace(/\n?<!-- more -->\n?/g, '\n');

const fragment = marked.parse(markdown, { gfm: true });
const $ = cheerio.load(`<section id="wechat-article">${fragment}</section>`, null, false);
const root = $('#wechat-article');

root.attr('style', 'max-width:677px;margin:0 auto;padding:8px 16px;color:#2b2f33;font-size:17px;line-height:1.82;letter-spacing:0.02em;text-align:left;word-break:break-word;');

const disclosure = process.env.WECHAT_AI_DISCLOSURE;
if (disclosure && !root.text().includes(disclosure)) {
  root.prepend(`<p data-ai-disclosure="true" style="margin:0 0 24px;padding:12px 14px;border-left:4px solid #6b7c8f;background:#f5f7f9;color:#5f6b76;font-size:14px;line-height:1.7;">${escapeHtml(disclosure)}</p>`);
}

root.find('p').not('[data-ai-disclosure]').attr('style', 'margin:0 0 18px;color:#2b2f33;font-size:17px;line-height:1.82;text-align:left;');
root.find('h2').attr('style', 'margin:38px 0 18px;padding:8px 12px;border-left:4px solid #167c80;background:#f2f7f7;color:#17324d;font-size:22px;font-weight:700;line-height:1.45;text-align:left;');
root.find('h3').attr('style', 'margin:28px 0 14px;color:#17324d;font-size:19px;font-weight:700;line-height:1.5;text-align:left;');
root.find('blockquote').attr('style', 'margin:20px 0;padding:14px 16px;border-left:4px solid #7b8fa3;background:#f6f8fa;color:#43505c;');
root.find('blockquote p').attr('style', 'margin:0;color:#43505c;font-size:16px;line-height:1.75;');
root.find('pre').attr('style', 'margin:20px 0;padding:16px 18px;border-radius:8px;background:#26394b;color:#f5f7fa;font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;');
root.find('pre code').attr('style', 'padding:0;background:transparent;color:inherit;font-size:14px;white-space:pre-wrap;');
root.find('code').not('pre code').attr('style', 'margin:0 2px;padding:2px 5px;border-radius:4px;background:#f0f2f4;color:#b4233b;font-size:0.9em;word-break:break-word;');
root.find('ul,ol').attr('style', 'margin:8px 0 20px;padding-left:1.5em;color:#2b2f33;');
root.find('li').attr('style', 'margin:7px 0;color:#2b2f33;font-size:17px;line-height:1.75;');
root.find('a').attr('style', 'color:#167c80;text-decoration:none;border-bottom:1px solid #9cc9c7;');
root.find('strong').attr('style', 'color:#17324d;font-weight:700;');
root.find('hr').attr('style', 'margin:30px 0;border:0;border-top:1px solid #dce3e8;');
root.find('img').each((_, element) => {
  const image = $(element);
  const src = image.attr('src');
  if (src && !/^(?:https?:|data:|file:|\/)/.test(src)) {
    const inputDir = path.dirname(path.resolve(inputPath));
    const direct = path.join(inputDir, src);
    const assetDir = path.join(inputDir, path.basename(inputPath, path.extname(inputPath)), src);
    const resolved = fs.existsSync(direct) ? direct : fs.existsSync(assetDir) ? assetDir : direct;
    image.attr('src', resolved);
  }
  image.attr('style', 'display:block;width:100%;height:auto;margin:22px auto;border-radius:8px;');
});
root.find('table').attr('style', 'width:100%;margin:20px 0;border-collapse:collapse;font-size:15px;line-height:1.6;');
root.find('th').attr('style', 'padding:8px;border:1px solid #cfd8df;background:#f2f7f7;color:#17324d;font-weight:700;');
root.find('td').attr('style', 'padding:8px;border:1px solid #cfd8df;color:#2b2f33;');

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, $.html(root), 'utf8');
console.log(JSON.stringify({ output: path.resolve(outputPath), bytes: fs.statSync(outputPath).size }));

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
