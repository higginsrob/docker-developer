#!/usr/bin/env node
// Helper script to get or create current session ID for an agent
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const agentName = process.argv[2];

if (!agentName) {
  console.error('Usage: ai-model-get-session.js <agent-name>');
  process.exit(1);
}

const dataDir = path.join(os.homedir(), '.docker-developer');
const sessionsConfigPath = path.join(dataDir, 'sessions.json');
const sessionDir = path.join(dataDir, 'history', agentName);

// Ensure session directory exists
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

// Load sessions config
let sessionsConfig = {};
if (fs.existsSync(sessionsConfigPath)) {
  try {
    sessionsConfig = JSON.parse(fs.readFileSync(sessionsConfigPath, 'utf8'));
  } catch (error) {
    console.error('Error loading sessions config:', error.message);
  }
}

// Get or create session ID
let sessionId = sessionsConfig[agentName];

if (!sessionId) {
  // Create new session
  sessionId = crypto.randomUUID();
  sessionsConfig[agentName] = sessionId;
  
  // Save sessions config
  fs.writeFileSync(sessionsConfigPath, JSON.stringify(sessionsConfig, null, 2));
  
  // Create empty session file
  const sessionPath = path.join(sessionDir, `${sessionId}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify([], null, 2));
}

// Output session ID
console.log(sessionId);



