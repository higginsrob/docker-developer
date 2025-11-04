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

// If this is the first message, add system prompt with user info
if (history.length === 0) {
  let systemPrompt = 'You are a helpful assistant.';
  
  // Load user settings
  let userSettings = null;
  try {
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
  
  // Build user introduction from settings and add to system prompt
  if (userSettings) {
    // Get user name for personalization
    let userName = '';
    if (userSettings.allowUseGitName && userSettings.gitName) {
      userName = userSettings.gitName;
    } else if (userSettings.nickname) {
      userName = userSettings.nickname;
    }
    
    if (userName) {
      systemPrompt += ` You are assisting ${userName}.`;
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

