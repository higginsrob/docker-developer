#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const historyFile = process.env.HISTORY_FILE;
let messages = [];

try {
  if (fs.existsSync(historyFile)) {
    messages = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  }
} catch(e) {}

// Load user settings from userData directory
let userSettings = null;
try {
  // Get userData path - try Electron userData first, fallback to ~/.docker-developer
  let userDataPath;
  
  // Try to detect if we're in an Electron environment
  try {
    const electronApp = require('electron').app;
    userDataPath = electronApp.getPath('userData');
  } catch(e) {
    // Not in Electron, use home directory
    userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'docker-developer');
  }
  
  const userSettingsPath = path.join(userDataPath, 'user-settings.json');
  
  if (fs.existsSync(userSettingsPath)) {
    userSettings = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8'));
  }
} catch(e) {
  // Silently fail if user settings not available
}

const toolMode = (process.env.TOOL_MODE || 'prompt').toLowerCase();
const toolsConfig = (process.env.TOOLS || '').trim();

let useNativeTools = false;
let systemPrompt = 'You are a helpful assistant.';

// Get existing system message from history if it exists
if (messages.length > 0 && messages[0].role === 'system') {
  systemPrompt = messages[0].content;
}

if (toolsConfig) {
  try {
    const { execSync } = require('child_process');
    const mcpToolsJson = execSync('docker mcp tools ls --format json 2>/dev/null', { encoding: 'utf8' });
    const mcpTools = JSON.parse(mcpToolsJson);
    
    const requestedTools = toolsConfig.split(',').map(t => t.trim());
    const selectedTools = mcpTools.filter(tool => requestedTools.includes(tool.name));
    
    if (selectedTools.length > 0) {
      if (toolMode === 'native') {
        useNativeTools = true;
      } else {
        systemPrompt += '\n\nYou have access to the following tools:\n\n';
        selectedTools.forEach(tool => {
          systemPrompt += 'Tool: ' + tool.name + '\n';
          systemPrompt += 'Description: ' + (tool.description || 'No description') + '\n';
          systemPrompt += 'Parameters: ' + JSON.stringify(tool.inputSchema || {}, null, 2) + '\n\n';
        });
        systemPrompt += 'To use a tool, respond with a JSON code block in this exact format:\n';
        systemPrompt += '```json\n{"tool_call": {"name": "tool_name", "arguments": {...}}}\n```\n';
        systemPrompt += 'After I execute the tool, I will provide you with the results and you should give your final answer.';
      }
    }
  } catch(e) {}
}

if (!useNativeTools) {
  if (messages.length === 0 || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: systemPrompt });
  } else if (toolsConfig) {
    // Update existing system message with tools
    messages[0].content = systemPrompt;
  }
}

// ALWAYS STREAM - NO BUFFERING, NO EXCEPTIONS
const payload = {
  model: process.env.MODEL,
  messages: messages,
  stream: true,
  max_tokens: parseInt(process.env.MAX_TOKENS) || 2048,
  temperature: parseFloat(process.env.TEMPERATURE) || 0.7,
  top_p: parseFloat(process.env.TOP_P) || 0.9,
};

const ctxSize = parseInt(process.env.CTX_SIZE);
if (ctxSize && ctxSize > 0) {
  payload.n_ctx = ctxSize;
}

// Add tools for native mode (only on first iteration to prevent loops)
const currentIteration = parseInt(process.env.ITERATION) || 1;
if (useNativeTools && toolsConfig && currentIteration === 1) {
  try {
    const { execSync } = require('child_process');
    const mcpToolsJson = execSync('docker mcp tools ls --format json 2>/dev/null', { encoding: 'utf8' });
    const mcpTools = JSON.parse(mcpToolsJson);
    
    const requestedTools = toolsConfig.split(',').map(t => t.trim());
    const selectedTools = mcpTools.filter(tool => requestedTools.includes(tool.name));
    
    const tools = selectedTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema || { type: 'object', properties: {} }
      }
    }));
    
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = process.env.TOOL_CHOICE || 'auto';
    }
  } catch(e) {}
}

console.log(JSON.stringify(payload));
