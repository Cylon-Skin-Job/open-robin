// Config Manager for open-robin-server
// Handles persistence of settings, chat history, and project state

const fs = require('fs');
const path = require('path');
const os = require('os');

// Data directory (server/data/)
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Default config structure
function getDefaultConfig() {
  return {
    version: '1.0',
    lastProject: null,
    projects: {},
    settings: {
      theme: 'dark',
      fontSize: 14,
      autoSave: true
    }
  };
}

// Load config from disk
function loadConfig() {
  ensureDataDir();
  
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = getDefaultConfig();
    saveConfig(defaultConfig);
    return defaultConfig;
  }
  
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(data);
    // Merge with defaults in case new fields were added
    return { ...getDefaultConfig(), ...config };
  } catch (err) {
    console.error('[Config] Failed to load config, using defaults:', err.message);
    return getDefaultConfig();
  }
}

// Save config to disk
function saveConfig(config) {
  ensureDataDir();
  
  try {
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_PATH, data, 'utf8');
    return true;
  } catch (err) {
    console.error('[Config] Failed to save config:', err.message);
    return false;
  }
}

// Get current config (cached)
let cachedConfig = null;

function getConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

// Update config and save
function updateConfig(updates) {
  cachedConfig = { ...getConfig(), ...updates };
  return saveConfig(cachedConfig);
}

// Project-specific operations
function getProjectConfig(projectPath) {
  const config = getConfig();
  return config.projects[projectPath] || null;
}

function setProjectConfig(projectPath, projectData) {
  const config = getConfig();
  config.projects[projectPath] = {
    ...config.projects[projectPath],
    ...projectData,
    path: projectPath
  };
  return updateConfig({ projects: config.projects });
}

function setLastProject(projectPath) {
  return updateConfig({ lastProject: projectPath });
}

// Panel-specific state (chat history, UI state, etc.)
function getPanelState(projectPath, panelId) {
  const project = getProjectConfig(projectPath);
  // Migration guard: if panels undefined but workspaces exists, copy over
  if (project && !project.panels && project.workspaces) {
    project.panels = project.workspaces;
  }
  if (!project || !project.panels) return null;
  return project.panels[panelId] || null;
}

function setPanelState(projectPath, panelId, state) {
  const config = getConfig();
  if (!config.projects[projectPath]) {
    config.projects[projectPath] = { path: projectPath, panels: {} };
  }
  // Migration guard: if panels undefined but workspaces exists, copy over
  if (!config.projects[projectPath].panels && config.projects[projectPath].workspaces) {
    config.projects[projectPath].panels = config.projects[projectPath].workspaces;
  }
  if (!config.projects[projectPath].panels) {
    config.projects[projectPath].panels = {};
  }
  config.projects[projectPath].panels[panelId] = {
    ...config.projects[projectPath].panels[panelId],
    ...state
  };
  return updateConfig({ projects: config.projects });
}

// Chat history storage (separate file per project/panel for performance)
function getChatHistoryPath(projectPath, panelId) {
  const safeProjectName = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(DATA_DIR, `chat_${safeProjectName}_${panelId}.json`);
}

function saveChatHistory(projectPath, panelId, messages) {
  const filePath = getChatHistoryPath(projectPath, panelId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Config] Failed to save chat history:', err.message);
    return false;
  }
}

function loadChatHistory(projectPath, panelId) {
  const filePath = getChatHistoryPath(projectPath, panelId);
  if (!fs.existsSync(filePath)) return [];
  
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[Config] Failed to load chat history:', err.message);
    return [];
  }
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  getConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  getProjectConfig,
  setProjectConfig,
  setLastProject,
  getPanelState,
  setPanelState,
  saveChatHistory,
  loadChatHistory
};
