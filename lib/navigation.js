'use strict';

/**
 * Arya Dock — Navigation State Management & Reducer
 *
 * Implements pure state transitions for workspace navigation, paging,
 * active application context switching, and workspace pinning (Epic E3-2).
 */

/**
 * Navigation state representation:
 * @typedef {Object} NavigationState
 * @property {'manual' | 'auto'} mode - Current navigation mode ('manual' or 'auto')
 * @property {string} workspaceId - Currently active workspace identifier
 * @property {number} pageIndex - Currently active page index (0-based)
 * @property {boolean} pinned - Whether active workspace is pinned against auto-switching
 */

/**
 * Create initial navigation state.
 *
 * @param {Object} [options]
 * @param {Array<Object>} [options.workspaces]
 * @param {string} [options.initialWorkspaceId]
 * @param {'manual' | 'auto'} [options.mode]
 * @param {number} [options.pageIndex]
 * @param {boolean} [options.pinned]
 * @returns {NavigationState}
 */
function createInitialNavigationState(options = {}) {
  const workspaces = Array.isArray(options.workspaces) ? options.workspaces : [];
  const defaultWsId = (workspaces.length > 0 && workspaces[0].id) ? workspaces[0].id : 'developer';
  const workspaceId = options.initialWorkspaceId || defaultWsId;
  const mode = (options.mode === 'manual' || options.mode === 'auto') ? options.mode : 'auto';
  const pageIndex = (typeof options.pageIndex === 'number' && Number.isInteger(options.pageIndex) && options.pageIndex >= 0)
    ? options.pageIndex
    : 0;
  const pinned = Boolean(options.pinned);
  const folderStack = Array.isArray(options.folderStack)
    ? options.folderStack.filter(id => typeof id === 'string' && id)
    : [];

  return {
    mode,
    workspaceId,
    pageIndex,
    pinned,
    folderStack
  };
}

/**
 * Normalize an application identifier for consistent workspace matching.
 * Strips .desktop extension, package edition suffixes, and lowercases.
 *
 * @param {string} appId - Raw application identifier (e.g. 'org.gnome.Ptyxis.desktop')
 * @returns {string} Normalized application identifier
 */
function normalizeAppId(appId) {
  if (!appId || typeof appId !== 'string') return '';
  let id = appId.trim().toLowerCase();
  // Strip directory paths if full path is passed (e.g. /path/to/code.desktop -> code.desktop)
  if (id.includes('/')) {
    id = id.split('/').pop();
  }
  if (id.endsWith('.desktop')) {
    id = id.slice(0, -8);
  }
  // Strip JetBrains and package edition suffixes
  id = id.replace(/-(ce|ultimate|eap|community|professional)$/, '');
  return id;
}

/**
 * Find the matching workspace for a given application identifier based on match rules.
 *
 * @param {Array<Object>} workspaces - List of workspace objects with optional match rules
 * @param {string} appId - Application identifier (raw or normalized)
 * @returns {string|null} Matching workspaceId, or null if no match found
 */
function findWorkspaceForApp(workspaces, appId) {
  if (!Array.isArray(workspaces) || !appId || typeof appId !== 'string') return null;
  const normalized = normalizeAppId(appId);
  if (!normalized) return null;

  for (const ws of workspaces) {
    if (!ws || typeof ws !== 'object' || !ws.id) continue;
    if (!ws.match || typeof ws.match !== 'object') continue;

    // Support match.apps array
    const apps = Array.isArray(ws.match.apps)
      ? ws.match.apps
      : (Array.isArray(ws.match.app) ? ws.match.app : []);

    for (const appRule of apps) {
      if (typeof appRule !== 'string') continue;
      const normalizedRule = normalizeAppId(appRule);
      if (!normalizedRule) continue;

      // Exact match
      if (normalized === normalizedRule) {
        return ws.id;
      }

      // App id contains rule as a dot/hyphen token segment (e.g. com.visualstudio.code contains code)
      const appSegments = normalized.split(/[.-]/);
      if (appSegments.includes(normalizedRule)) {
        return ws.id;
      }

      // If rule is multi-segment (e.g. org.gnome.ptyxis or jetbrains-idea),
      // allow app matching individual segment (e.g. ptyxis or idea)
      const ruleSegments = normalizedRule.split(/[.-]/);
      if (ruleSegments.includes(normalized)) {
        return ws.id;
      }
    }
  }

  return null;
}

/**
 * Pure navigation reducer.
 *
 * Handles navigation events:
 * - USER_SELECT: User manually selects a workspace and/or page.
 * - CONTEXT_CHANGED: Active application focused on host workstation.
 * - PIN: User locks companion deck to current workspace.
 * - UNPIN: User restores automatic context tracking.
 * - WORKSPACE_DELETED: Active or inactive workspace was deleted.
 * - PAGE_PREV: Navigate to previous page in current workspace.
 * - PAGE_NEXT: Navigate to next page in current workspace.
 *
 * @param {NavigationState} state - Current navigation state
 * @param {Object} event - Action event object
 * @param {Object} [context] - Contextual data (workspaces list, totalPages, findWorkspaceForApp helper)
 * @returns {NavigationState} Next navigation state (pure transition)
 */
function navigationReducer(state, event, context = {}) {
  // If state is not provided, initialize with safe defaults
  const current = state || createInitialNavigationState();
  if (!event || typeof event !== 'object' || !event.type) {
    return current;
  }

  switch (event.type) {
    case 'USER_SELECT': {
      const targetWorkspaceId = (typeof event.workspaceId === 'string' && event.workspaceId.trim())
        ? event.workspaceId.trim()
        : current.workspaceId;

      // If context.workspaces is provided and non-empty, ensure target workspace exists
      if (Array.isArray(context.workspaces) && context.workspaces.length > 0) {
        const exists = context.workspaces.some(w => w.id === targetWorkspaceId);
        if (!exists) {
          return current;
        }
      }

      const workspaceChanged = targetWorkspaceId !== current.workspaceId;
      let targetPageIndex = 0;

      if (typeof event.pageIndex === 'number' && Number.isInteger(event.pageIndex)) {
        targetPageIndex = Math.max(0, event.pageIndex);
      } else if (!workspaceChanged) {
        targetPageIndex = current.pageIndex;
      }

      // Context bounds checking if totalPages or workspaces provided
      if (typeof context.totalPages === 'number' && context.totalPages > 0) {
        targetPageIndex = Math.min(targetPageIndex, context.totalPages - 1);
      } else if (Array.isArray(context.workspaces)) {
        const targetWs = context.workspaces.find(w => w.id === targetWorkspaceId);
        if (targetWs && Array.isArray(targetWs.pages) && targetWs.pages.length > 0) {
          targetPageIndex = Math.min(targetPageIndex, targetWs.pages.length - 1);
        }
      }

      const targetPinned = typeof event.pinned === 'boolean' ? event.pinned : current.pinned;
      const targetFolderStack = workspaceChanged
        ? []
        : (Array.isArray(event.folderStack) ? event.folderStack : (current.folderStack || []));

      if (
        current.mode === 'manual' &&
        current.workspaceId === targetWorkspaceId &&
        current.pageIndex === targetPageIndex &&
        current.pinned === targetPinned &&
        JSON.stringify(current.folderStack || []) === JSON.stringify(targetFolderStack)
      ) {
        return current;
      }

      return {
        ...current,
        mode: 'manual',
        workspaceId: targetWorkspaceId,
        pageIndex: targetPageIndex,
        pinned: targetPinned,
        folderStack: targetFolderStack
      };
    }

    case 'ENTER_FOLDER': {
      const rawFolderId = typeof event.folderId === 'string' ? event.folderId.trim() : '';
      if (!rawFolderId) {
        return current;
      }
      const MAX_FOLDER_DEPTH = 5;
      const stack = Array.isArray(current.folderStack) ? current.folderStack : [];
      if (stack.length >= MAX_FOLDER_DEPTH) {
        return current;
      }
      // Anti-cycle guard
      if (stack.includes(rawFolderId)) {
        return current;
      }
      return {
        ...current,
        mode: 'manual',
        folderStack: [...stack, rawFolderId]
      };
    }

    case 'LEAVE_FOLDER': {
      const stack = Array.isArray(current.folderStack) ? current.folderStack : [];
      if (stack.length === 0) {
        return current;
      }
      return {
        ...current,
        folderStack: stack.slice(0, -1)
      };
    }

    case 'CONTEXT_CHANGED': {
      // If pinned, auto-switching is strictly blocked!
      if (current.pinned) {
        return current;
      }

      let matchedWorkspaceId = event.matchedWorkspaceId || event.workspaceId || null;
      if (!matchedWorkspaceId && event.appId) {
        const finder = context.findWorkspaceForApp || findWorkspaceForApp;
        const workspaces = context.workspaces || [];
        matchedWorkspaceId = finder.length === 1 ? finder(event.appId) : finder(workspaces, event.appId);
      }

      // If no workspace matches the active context, retain current workspace
      if (!matchedWorkspaceId) {
        return current;
      }

      // Check if target workspace exists in known workspaces
      if (Array.isArray(context.workspaces) && context.workspaces.length > 0) {
        const exists = context.workspaces.some(w => w.id === matchedWorkspaceId);
        if (!exists) {
          return current;
        }
      }

      // If already on this workspace in auto mode, no-op
      if (current.workspaceId === matchedWorkspaceId && current.mode === 'auto') {
        return current;
      }

      // Switch to auto mode. If workspace changed, reset to page 0; if remaining in same workspace, preserve pageIndex.
      const targetPageIndex = (current.workspaceId === matchedWorkspaceId) ? current.pageIndex : 0;

      return {
        ...current,
        mode: 'auto',
        workspaceId: matchedWorkspaceId,
        pageIndex: targetPageIndex,
        folderStack: []
      };
    }

    case 'PIN': {
      if (current.pinned && current.mode === 'manual') {
        return current;
      }
      return {
        ...current,
        pinned: true,
        mode: 'manual'
      };
    }

    case 'UNPIN': {
      if (!current.pinned && current.mode === 'auto') {
        return current;
      }
      return {
        ...current,
        pinned: false,
        mode: 'auto'
      };
    }

    case 'WORKSPACE_DELETED': {
      const deletedId = event.workspaceId;
      if (!deletedId || current.workspaceId !== deletedId) {
        return current;
      }

      // The currently active workspace was deleted; determine fallback
      let fallbackWorkspaceId = 'developer';
      if (event.fallbackWorkspaceId && typeof event.fallbackWorkspaceId === 'string') {
        fallbackWorkspaceId = event.fallbackWorkspaceId;
      } else if (Array.isArray(context.workspaces)) {
        const remaining = context.workspaces.find(w => w.id !== deletedId);
        if (remaining && remaining.id) {
          fallbackWorkspaceId = remaining.id;
        }
      }

      return {
        ...current,
        workspaceId: fallbackWorkspaceId,
        pageIndex: 0,
        mode: 'auto',
        pinned: false,
        folderStack: []
      };
    }

    case 'PAGE_PREV': {
      if (Array.isArray(current.folderStack) && current.folderStack.length > 0) {
        return current;
      }
      let totalPages = 1;
      if (typeof event.totalPages === 'number' && event.totalPages > 0) {
        totalPages = event.totalPages;
      } else if (typeof context.totalPages === 'number' && context.totalPages > 0) {
        totalPages = context.totalPages;
      } else if (Array.isArray(context.workspaces)) {
        const ws = context.workspaces.find(w => w.id === current.workspaceId);
        if (ws && Array.isArray(ws.pages) && ws.pages.length > 0) {
          totalPages = ws.pages.length;
        }
      }

      if (totalPages <= 1) {
        return current.pageIndex === 0 ? current : { ...current, pageIndex: 0 };
      }

      const nextPageIndex = ((current.pageIndex - 1) % totalPages + totalPages) % totalPages;
      if (nextPageIndex === current.pageIndex) {
        return current;
      }

      return {
        ...current,
        pageIndex: nextPageIndex
      };
    }

    case 'PAGE_NEXT': {
      if (Array.isArray(current.folderStack) && current.folderStack.length > 0) {
        return current;
      }
      let totalPages = 1;
      if (typeof event.totalPages === 'number' && event.totalPages > 0) {
        totalPages = event.totalPages;
      } else if (typeof context.totalPages === 'number' && context.totalPages > 0) {
        totalPages = context.totalPages;
      } else if (Array.isArray(context.workspaces)) {
        const ws = context.workspaces.find(w => w.id === current.workspaceId);
        if (ws && Array.isArray(ws.pages) && ws.pages.length > 0) {
          totalPages = ws.pages.length;
        }
      }

      if (totalPages <= 1) {
        return current.pageIndex === 0 ? current : { ...current, pageIndex: 0 };
      }

      const nextPageIndex = ((current.pageIndex + 1) % totalPages + totalPages) % totalPages;
      if (nextPageIndex === current.pageIndex) {
        return current;
      }

      return {
        ...current,
        pageIndex: nextPageIndex
      };
    }

    default:
      return current;
  }
}

module.exports = {
  createInitialNavigationState,
  normalizeAppId,
  findWorkspaceForApp,
  navigationReducer
};
