#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const historyFile = process.env.HISTORY_FILE;
const dir = path.dirname(historyFile);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let history = [];
try {
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  }
} catch(e) {}

// If this is the first message, add system prompt with agent info first, then user info
if (history.length === 0) {
  // Use centralized data directory at ~/.docker-developer/
  const userDataPath = path.join(os.homedir(), '.docker-developer');
  
  // Load agent configuration
  let agentConfig = null;
  let agent = null;
  try {
    // Get executable name from environment or config file
    const executableName = process.env.MODEL_NAME;
    
    if (executableName) {
      // Try to load the executable's config file
      const configPath = process.env.CONFIG_FILE;
      if (configPath && fs.existsSync(configPath)) {
        agentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      // Try to load the agent from agents.json
      const agentsPath = path.join(userDataPath, 'agents.json');
      if (fs.existsSync(agentsPath)) {
        const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
        // Find agent by matching the executable name pattern
        agent = agents.find(a => {
          const agentExecName = a.name.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-');
          return agentExecName === executableName;
        });
      }
    }
  } catch(e) {
    // Silently fail if agent config not available
  }
  
  // Load user settings
  let userSettings = null;
  try {
    const userSettingsPath = path.join(userDataPath, 'user-settings.json');
    
    if (fs.existsSync(userSettingsPath)) {
      userSettings = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8'));
    }
  } catch(e) {
    // Silently fail if user settings not available
  }
  
  // Build system prompt starting with agent introduction
  let systemPrompt = '';
  
  // Start with agent identity if available
  if (agent && agent.name) {
    systemPrompt = `You are a helpful assistant named ${agent.name}.`;
    
    // Add nickname to introduction if available
    if (agent.nickname) {
      systemPrompt += ` Your nickname is "${agent.nickname}".`;
    }
    
    // Add job title to introduction if available
    if (agent.jobTitle) {
      systemPrompt += ` Your job title is ${agent.jobTitle}.`;
    }
  } else {
    systemPrompt = 'You are a helpful assistant.';
  }
  
  // Add detailed agent configuration information
  if (agent || agentConfig) {
    const agentInfoLines = [];
    
    // Add configuration details
    if (agentConfig) {
      agentInfoLines.push(`- AI Model: ${agentConfig.image || 'unknown'}`);
      agentInfoLines.push(`- Context Window: ${agentConfig.context_size || 8192} tokens`);
      agentInfoLines.push(`- Max Output Tokens: ${agentConfig.max_tokens || 2048} tokens`);
      agentInfoLines.push(`- Temperature: ${agentConfig.temperature || 0.7}`);
      if (agentConfig.top_p) {
        agentInfoLines.push(`- Top P: ${agentConfig.top_p}`);
      }
      if (agentConfig.top_k) {
        agentInfoLines.push(`- Top K: ${agentConfig.top_k}`);
      }
      if (agentConfig.tool_choice) {
        agentInfoLines.push(`- Tool Choice Mode: ${agentConfig.tool_choice}`);
      }
      if (agentConfig.tool_mode) {
        agentInfoLines.push(`- Tool Mode: ${agentConfig.tool_mode}`);
      }
      if (agentConfig.response_format) {
        agentInfoLines.push(`- Response Format: ${agentConfig.response_format}`);
      }
      if (agentConfig.debug_mode) {
        agentInfoLines.push(`- Debug Mode: ${agentConfig.debug_mode ? 'enabled' : 'disabled'}`);
      }
    }
    
    if (agentInfoLines.length > 0) {
      systemPrompt += '\n\nHere is some background information about you:\n' + agentInfoLines.join('\n');
    }
  }
  
  // Now add user information AFTER agent information
  // Get user name for addressing
  let userName = '';
  if (userSettings) {
    if (userSettings.allowUseGitName && userSettings.gitName) {
      userName = userSettings.gitName;
    } else if (userSettings.nickname) {
      userName = userSettings.nickname;
    }
    
    if (userName) {
      systemPrompt += `\n\nYou are assisting ${userName}.`;
    }
    
    // Build detailed user information
    const userInfoLines = [];
  
    // Add git info if allowed
    if (userSettings.allowUseGitName && userSettings.gitName) {
      userInfoLines.push(`- Name: ${userSettings.gitName}`);
    }
    if (userSettings.allowUseGitEmail && userSettings.gitEmail) {
      userInfoLines.push(`- Email: ${userSettings.gitEmail}`);
    }
    
    // Helper function to convert field names to readable labels
    const fieldLabels = {
    nickname: 'Nickname',
    language: 'Language',
    age: 'Age',
    gender: 'Gender Identity',
    orientation: 'Gender Orientation',
    race: 'Race',
    ethnicity: 'Ethnicity',
    jobTitle: 'Job Title',
    employer: 'Employer',
    incomeLevel: 'Income Level',
    educationLevel: 'Education Level',
    politicalIdeology: 'Political Ideology',
    maritalStatus: 'Marital Status',
    numberOfChildren: 'Number of Children',
    housing: 'Housing',
    headOfHousehold: 'Head of Household',
    religion: 'Religion',
    interests: 'Interests',
    country: 'Country',
    state: 'State',
      zipcode: 'Zipcode'
    };
    
    // Dynamically add all user settings fields (future-proof for new fields)
    Object.keys(userSettings).forEach(key => {
      // Skip internal fields
      if (key === 'allowUseGitName' || key === 'allowUseGitEmail' || key === 'gitName' || key === 'gitEmail') {
        return;
      }
      
      const value = userSettings[key];
      if (value && value.toString().trim() !== '') {
        const label = fieldLabels[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
        userInfoLines.push(`- ${label}: ${value}`);
      }
    });
    
    // Add user info to system prompt if we have any
    if (userInfoLines.length > 0) {
      systemPrompt += '\n\nHere is some background information about your user:\n' + userInfoLines.join('\n');
    }
  }
  
  // Add system message as first message
  history.push({ role: 'system', content: systemPrompt });
}

// Add user message
history.push({ role: 'user', content: process.env.PROMPT });

// Keep last 30 messages to prevent context overflow
if (history.length > 30) {
  history = history.slice(-30);
}

fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

