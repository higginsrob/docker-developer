#!/usr/bin/env node

/**
 * Get agent information by model name
 * Used to fetch agent avatar for display in terminal
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration directory
const CONFIG_DIR = path.join(os.homedir(), '.docker-developer');
const AGENTS_FILE = path.join(CONFIG_DIR, 'agents.json');

/**
 * Load agents from file
 */
function loadAgents() {
  try {
    if (fs.existsSync(AGENTS_FILE)) {
      const data = fs.readFileSync(AGENTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    // Ignore errors
  }
  return [];
}

/**
 * Find agent by model name
 */
function findAgentByModel(modelName) {
  const agents = loadAgents();
  
  // Try exact match first
  let agent = agents.find(a => a.model === modelName);
  
  // If not found, try case-insensitive match
  if (!agent) {
    const lowerModel = modelName.toLowerCase();
    agent = agents.find(a => a.model.toLowerCase() === lowerModel);
  }
  
  return agent || null;
}

/**
 * Main function
 */
function main() {
  const modelName = process.argv[2];
  
  if (!modelName) {
    console.error('Usage: ai-model-get-agent.js <model-name>');
    process.exit(1);
  }
  
  const agent = findAgentByModel(modelName);
  
  if (agent) {
    // Output agent as JSON
    console.log(JSON.stringify(agent));
  } else {
    // No agent found - output empty object
    console.log('{}');
  }
}

main();



