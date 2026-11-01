'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

test('SEO: public/index.html contains complete meta, Open Graph, Twitter, and Schema.org tags', () => {
  const htmlPath = path.join(rootDir, 'public', 'index.html');
  assert.ok(fs.existsSync(htmlPath), 'index.html must exist');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Title & description
  assert.match(html, /<title>Arya Dock .*?<\/title>/i);
  assert.match(html, /<meta\s+name=["']description["']\s+content=["'][^"']+["']/i);
  assert.match(html, /<meta\s+name=["']keywords["']\s+content=["'][^"']+["']/i);
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["']index,\s*follow["']/i);
  assert.match(html, /<link\s+rel=["']canonical["']\s+href=["']https:\/\/github\.com\/kartik1502\/arya-dock["']/i);

  // Open Graph
  assert.match(html, /<meta\s+property=["']og:type["']\s+content=["']website["']/i);
  assert.match(html, /<meta\s+property=["']og:url["']\s+content=["']https:\/\/github\.com\/kartik1502\/arya-dock["']/i);
  assert.match(html, /<meta\s+property=["']og:site_name["']\s+content=["']Arya Dock["']/i);
  assert.match(html, /<meta\s+property=["']og:locale["']\s+content=["']en_US["']/i);
  assert.match(html, /<meta\s+property=["']og:title["']\s+content=["'][^"']+["']/i);
  assert.match(html, /<meta\s+property=["']og:description["']\s+content=["'][^"']+["']/i);

  // Open Graph Image MUST be a raster image (PNG), NEVER SVG (scrapers reject SVG)
  const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  assert.ok(ogImageMatch, 'og:image must be present');
  assert.ok(ogImageMatch[1].endsWith('.png'), `og:image must be a PNG image, got: ${ogImageMatch[1]}`);
  assert.match(html, /<meta\s+property=["']og:image:type["']\s+content=["']image\/png["']/i);
  assert.match(html, /<meta\s+property=["']og:image:width["']\s+content=["']1200["']/i);
  assert.match(html, /<meta\s+property=["']og:image:height["']\s+content=["']630["']/i);
  assert.match(html, /<meta\s+property=["']og:image:alt["']\s+content=["'][^"']+["']/i);

  // Twitter Cards - SVG is strictly not supported by Twitter Cards
  assert.match(html, /<meta\s+name=["']twitter:card["']\s+content=["']summary_large_image["']/i);
  assert.match(html, /<meta\s+name=["']twitter:title["']\s+content=["'][^"']+["']/i);
  assert.match(html, /<meta\s+name=["']twitter:description["']\s+content=["'][^"']+["']/i);
  const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  assert.ok(twitterImageMatch, 'twitter:image must be present');
  assert.ok(twitterImageMatch[1].endsWith('.png'), `twitter:image must be a PNG image, got: ${twitterImageMatch[1]}`);
  assert.match(html, /<meta\s+name=["']twitter:image:alt["']\s+content=["'][^"']+["']/i);

  // Apple touch icon and favicons
  assert.match(html, /<link\s+rel=["']apple-touch-icon["'][^>]*href=["']apple-touch-icon\.png["']/i);
  assert.match(html, /<link\s+rel=["']icon["'][^>]*href=["']icon\.svg["']/i);
  assert.match(html, /<link\s+rel=["']icon["'][^>]*href=["']icon-192\.png["']/i);

  // Schema.org JSON-LD
  const jsonLdMatch = html.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
  assert.ok(jsonLdMatch, 'JSON-LD script block must be present');
  const jsonLd = JSON.parse(jsonLdMatch[1]);
  assert.equal(jsonLd['@context'], 'https://schema.org');
  assert.equal(jsonLd['@type'], 'WebApplication');
  assert.equal(jsonLd.name, 'Arya Dock');
  assert.equal(jsonLd.operatingSystem, 'Linux');
  assert.equal(jsonLd.applicationCategory, 'DeveloperApplication');
  assert.ok(Array.isArray(jsonLd.featureList) && jsonLd.featureList.length >= 5);
  assert.ok(jsonLd.author && jsonLd.author.name);
  assert.ok(jsonLd.offers && jsonLd.offers.price === '0');
  assert.ok(jsonLd.image && jsonLd.image.endsWith('.png'));
  assert.ok(jsonLd.codeRepository && jsonLd.codeRepository.includes('kartik1502/arya-dock'));
});

test('SEO: public/manifest.json conforms to PWA installability requirements', () => {
  const manifestPath = path.join(rootDir, 'public', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.name && manifest.name.length > 5);
  assert.ok(manifest.short_name && manifest.short_name.length > 0);
  assert.ok(manifest.description && manifest.description.length > 20);
  assert.ok(Array.isArray(manifest.categories) && manifest.categories.length >= 2);
  assert.ok(manifest.categories.includes('developer tools'));

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  const has192 = manifest.icons.some(i => i.sizes === '192x192' && i.type === 'image/png');
  const has512 = manifest.icons.some(i => i.sizes === '512x512' && i.type === 'image/png');
  assert.ok(has192, 'Manifest must include 192x192 PNG icon');
  assert.ok(has512, 'Manifest must include 512x512 PNG icon');
});

test('SEO: package.json has rich description and search keywords', () => {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.ok(pkg.description && pkg.description.length > 20);
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length >= 10);
  const requiredKeywords = [
    'stream-deck-alternative',
    'virtual-stream-deck',
    'macro-pad',
    'companion-deck',
    'linux-desktop',
    'developer-tools',
    'pwa'
  ];
  for (const kw of requiredKeywords) {
    assert.ok(pkg.keywords.includes(kw), `package.json keywords should include '${kw}'`);
  }
});

test('SEO: README.md has verified Table of Contents and descriptive alt text', () => {
  const readmePath = path.join(rootDir, 'README.md');
  const content = fs.readFileSync(readmePath, 'utf8');

  // Verify H1
  assert.match(content, /^# 🏁 Arya Dock — Virtual Macro Keypad & Stream Deck Alternative for Linux/m);

  // Verify TOC links
  const tocMatch = content.match(/## 📑 Table of Contents([\s\S]*?)---/);
  assert.ok(tocMatch, 'TOC must be present in README.md');
  const links = [...tocMatch[1].matchAll(/\[(.*?)\]\((#.*?)\)/g)].map(m => m[2].slice(1));
  assert.ok(links.length >= 15, 'TOC should have at least 15 links');

  const headings = [...content.matchAll(/^(#{2,6})\s+(.*)$/gm)].map(m => {
    return m[2].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  });
  const explicitAnchors = [...content.matchAll(/<a id=\"(.*?)\"><\/a>/g)].map(m => m[1]);
  const allTargets = new Set([...headings, ...explicitAnchors]);

  for (const link of links) {
    assert.ok(allTargets.has(link), `README.md TOC link #${link} must resolve to a valid heading or anchor`);
  }

  // Verify banner and badges have alt text
  const images = [...content.matchAll(/!\[(.*?)\]\((.*?)\)|<img [^>]*alt=["'](.*?)["']/g)];
  assert.ok(images.length >= 5, 'README should have badges and banner images');
  for (const img of images) {
    const alt = img[1] || img[3];
    assert.ok(alt && alt.trim().length > 3, `Image should have descriptive alt text: ${img[0]}`);
  }
});

test('SEO: Zero restricted trademarked brand names in codebase', () => {
  const files = ['README.md', 'package.json', 'public/index.html', 'public/manifest.json'];
  const restrictedTrademarks = [/logitech/i, /\bbmw\b/i];

  for (const file of files) {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
    for (const regex of restrictedTrademarks) {
      assert.ok(!regex.test(content), `File ${file} must not contain restricted trademark: ${regex}`);
    }
  }
});

test('SEO: Generated image assets exist on disk with valid PNG headers', () => {
  const expectedPngs = [
    'public/icon-192.png',
    'public/icon-512.png',
    'public/apple-touch-icon.png',
    'public/og-image.png'
  ];

  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  for (const relPath of expectedPngs) {
    const fullPath = path.join(rootDir, relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} must exist on disk`);
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    assert.deepEqual(buf, pngMagic, `${relPath} must have valid PNG magic bytes`);
  }
});
