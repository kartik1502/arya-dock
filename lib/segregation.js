'use strict';

/**
 * Workspace Tile Segregation Engine (Path A: Non-Destructive View Projection)
 * Pure classification and virtual page chunking module.
 */

const MAX_BUTTONS_PER_PAGE = 15;

const ALLOWED_CATEGORIES = ['terminal', 'application', 'url', 'media'];

const KNOWN_DESKTOP_BINARIES = [
  'google-chrome', 'chrome', 'firefox', 'brave', 'chromium',
  'code', 'cursor', 'subl', 'gedit',
  'slack', 'discord', 'telegram-desktop', 'spotify',
  'gimp', 'inkscape', 'vlc', 'obs', 'steam'
];

/**
 * Checks if a command matches common GUI desktop application binaries.
 * @param {string} command
 * @returns {boolean}
 */
function isKnownDesktopCommand(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim().toLowerCase();
  return KNOWN_DESKTOP_BINARIES.some(b => cmd === b || cmd.startsWith(b + ' '));
}

/**
 * Resolves the functional category for a button.
 * Pure deterministic rule-based evaluation.
 * @param {Object} button
 * @returns {'terminal' | 'application' | 'url' | 'media'}
 */
function classifyButton(button) {
  if (!button || typeof button !== 'object') {
    return 'terminal';
  }

  // 1. Explicit user override takes precedence (normalized)
  if (typeof button.categoryOverride === 'string') {
    const override = button.categoryOverride.trim().toLowerCase();
    if (ALLOWED_CATEGORIES.includes(override)) {
      return override;
    }
  }

  // 2. Dedicated media action
  if (button.actionType === 'media') {
    return 'media';
  }

  // 3. Web URL action
  if (button.actionType === 'url') {
    return 'url';
  }

  // 4. Shell / command actions
  if (button.actionType === 'shell') {
    // Interactive shells targeting tab, window, or existing session are Terminal
    if (['tab', 'window', 'existing'].includes(button.terminalMode)) {
      return 'terminal';
    }
    // Background execution:
    // If flagged as desktop application origin, categorize as Application
    if (button.isApplication === true) {
      return 'application';
    }
    // Heuristic: check if command matches common GUI desktop binaries
    if (isKnownDesktopCommand(button.command)) {
      return 'application';
    }
    return 'terminal';
  }

  // Default fallback
  return 'terminal';
}

/**
 * Formats a category slug into a display title.
 * @param {string} category
 * @returns {string}
 */
function formatCategoryName(category) {
  switch (category) {
    case 'terminal': return 'Terminal';
    case 'application': return 'Application';
    case 'url': return 'URL';
    case 'media': return 'Media';
    default:
      if (!category || typeof category !== 'string') return 'Category';
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

/**
 * Projects a workspace into virtual pages for a target category lens.
 * Ephemeral, non-destructive projection that never mutates workspace.pages.
 * @param {Object} workspace
 * @param {'all' | 'terminal' | 'application' | 'url' | 'media'} lens
 * @returns {Array<{ pageNumber: number, name: string, category: string|null, buttons: Array }>}
 */
function getCategoryProjection(workspace, lens = 'all') {
  if (!workspace || !Array.isArray(workspace.pages)) {
    return [];
  }

  const normalizedLens = (typeof lens === 'string' ? lens.trim().toLowerCase() : 'all');

  // When 'all' is selected, return canonical workspace pages directly
  if (normalizedLens === 'all') {
    return workspace.pages;
  }

  // Gather all buttons across all canonical pages in the workspace
  const allButtons = [];
  for (const page of workspace.pages) {
    if (Array.isArray(page?.buttons)) {
      allButtons.push(...page.buttons);
    }
  }

  // Filter buttons matching the active category lens
  const matchingButtons = allButtons.filter(b => classifyButton(b) === normalizedLens);

  // If no buttons match, return a single empty placeholder page
  if (matchingButtons.length === 0) {
    return [{
      pageNumber: 1,
      name: `${formatCategoryName(normalizedLens)} 1`,
      category: normalizedLens,
      buttons: []
    }];
  }

  // Chunk matching buttons into virtual pages of at most MAX_BUTTONS_PER_PAGE (15)
  const virtualPages = [];
  for (let i = 0; i < matchingButtons.length; i += MAX_BUTTONS_PER_PAGE) {
    const chunk = matchingButtons.slice(i, i + MAX_BUTTONS_PER_PAGE);
    const subPageIndex = Math.floor(i / MAX_BUTTONS_PER_PAGE) + 1;
    virtualPages.push({
      pageNumber: subPageIndex,
      name: `${formatCategoryName(normalizedLens)} ${subPageIndex}`,
      category: normalizedLens,
      buttons: chunk
    });
  }

  return virtualPages;
}

module.exports = {
  MAX_BUTTONS_PER_PAGE,
  ALLOWED_CATEGORIES,
  classifyButton,
  isKnownDesktopCommand,
  formatCategoryName,
  getCategoryProjection
};
