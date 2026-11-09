'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.resolve(__dirname, '..', 'public', 'style.css');

test('Scrollbars: public/style.css exists and has balanced curly braces', () => {
  assert.ok(fs.existsSync(cssPath), 'public/style.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify balanced braces (ignoring comments and strings)
  let depth = 0;
  let inComment = false;
  for (let i = 0; i < css.length; i++) {
    if (!inComment && css[i] === '/' && css[i + 1] === '*') {
      inComment = true;
      i++;
    } else if (inComment && css[i] === '*' && css[i + 1] === '/') {
      inComment = false;
      i++;
    } else if (!inComment) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      assert.ok(depth >= 0, `Unmatched closing brace at char ${i}`);
    }
  }
  assert.equal(depth, 0, 'CSS has unclosed curly braces');
});

test('Scrollbars: Cockpit design system scrollbar tokens are defined in :root', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  const requiredTokens = [
    '--m-scrollbar-width',
    '--m-scrollbar-height',
    '--m-scrollbar-track',
    '--m-scrollbar-thumb',
    '--m-scrollbar-thumb-hover',
    '--m-scrollbar-thumb-active'
  ];

  for (const token of requiredTokens) {
    assert.ok(
      css.includes(token),
      `Token ${token} should be defined in public/style.css`
    );
  }
});

test('Scrollbars: Global scrollbars support standard Firefox and WebKit pseudo-elements', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Firefox CSS Scrollbars Level 1
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-color:\s*var\(--m-scrollbar-thumb\)\s+var\(--m-scrollbar-track\)/);

  // WebKit / Chromium pseudo-elements
  assert.match(css, /::-webkit-scrollbar\b/);
  assert.match(css, /::-webkit-scrollbar-track\b/);
  assert.match(css, /::-webkit-scrollbar-thumb\b/);
  assert.match(css, /::-webkit-scrollbar-thumb:hover\b/);
  assert.match(css, /::-webkit-scrollbar-thumb:active\b/);
  assert.match(css, /::-webkit-scrollbar-corner\b/);
});

test('Scrollbars: Key scrollable containers are instrumented with sleek cockpit scrollbars', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  const requiredComponents = [
    '.m-mode-selector',
    '.m-drawer-body',
    '.m-category-tabs',
    '.m-apps-list',
    '.m-modal-card',
    '.m-modal-body',
    '.m-popup-card',
    '.m-ws-list',
    '.m-wizard-card',
    '.m-detect-grid',
    'pre',
    'code'
  ];

  for (const comp of requiredComponents) {
    assert.ok(
      css.includes(comp),
      `Component selector ${comp} should be present in public/style.css`
    );
  }

  // Check specific scrollbar selectors for modals, drawers, workspace list, detect grid
  assert.ok(css.includes('.m-mode-selector::-webkit-scrollbar'));
  assert.ok(css.includes('.m-drawer-body::-webkit-scrollbar'));
  assert.ok(css.includes('.m-apps-list::-webkit-scrollbar'));
  assert.ok(css.includes('.m-modal-card::-webkit-scrollbar'));
  assert.ok(css.includes('.m-ws-list::-webkit-scrollbar'));
  assert.ok(css.includes('.m-wizard-card::-webkit-scrollbar'));
  assert.ok(css.includes('.m-detect-grid::-webkit-scrollbar'));
});

test('Scrollbars: Chromium 121+ protection and stepper button suppression', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Chromium 121+ feature query protection: standard scrollbar-color must be guarded
  // by @supports not selector(::-webkit-scrollbar) so Blink does not deactivate WebKit styling
  assert.match(
    css,
    /@supports\s+not\s+selector\(::-webkit-scrollbar\)/,
    'Must guard standard scrollbar-color with @supports not selector(::-webkit-scrollbar) for Chromium 121+'
  );

  // Ugly stepper buttons must be suppressed for minimal cyber cockpit aesthetic
  assert.match(
    css,
    /::-webkit-scrollbar-button[\s\S]*?display:\s*none/m,
    'Must suppress ::-webkit-scrollbar-button with display: none'
  );

  // Resizer corner
  assert.match(
    css,
    /::-webkit-resizer[\s\S]*?background:\s*transparent/m,
    'Must style ::-webkit-resizer with transparent background'
  );
});

test('Scrollbars: Modal flex-scroll architecture avoids double scrollbars and sticky controls', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // .m-modal-card must have overflow: hidden to avoid outer duplicate scrollbar
  assert.match(
    css,
    /\.m-modal-card\s*\{[^}]*overflow:\s*hidden;/m,
    '.m-modal-card must clip outer overflow to prevent double scrollbars'
  );

  // .m-modal-body must be the scroll container
  assert.match(
    css,
    /\.m-modal-body\s*\{[^}]*overflow-y:\s*auto;/m,
    '.m-modal-body must handle overflow-y: auto'
  );

  // .m-modal-header and .m-modal-footer must have flex-shrink: 0 to stay pinned
  assert.match(
    css,
    /\.m-modal-header\s*\{[^}]*flex-shrink:\s*0;/m,
    '.m-modal-header must have flex-shrink: 0'
  );
  assert.match(
    css,
    /\.m-modal-footer\s*\{[^}]*flex-shrink:\s*0;/m,
    '.m-modal-footer must have flex-shrink: 0'
  );

  // .m-lens-strip must preserve intentional scrollbar hiding
  assert.match(
    css,
    /\.m-lens-strip\s*\{[^}]*scrollbar-width:\s*none;/m,
    '.m-lens-strip must preserve scrollbar-width: none'
  );
  assert.match(
    css,
    /\.m-lens-strip::-webkit-scrollbar\s*\{[^}]*display:\s*none;/m,
    '.m-lens-strip must preserve display: none on scrollbar'
  );
});
