#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');

const toolCalls = JSON.parse(fs.readFileSync(process.env.RESPONSE_FILE + '.toolcalls', 'utf8'));
const historyFile = process.env.HISTORY_FILE;
const debug = process.env.DEBUG === 'true';

let history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));

for (const toolCall of toolCalls) {
  const toolName = toolCall.function.name;
  const toolArgs = JSON.parse(toolCall.function.arguments);
  
  if (debug) {
    console.error('\n  Tool: ' + toolName);
    console.error('  Args: ' + JSON.stringify(toolArgs, null, 2));
  }
  
  try {
    const argPairs = Object.entries(toolArgs)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => {
        const escapedValue = typeof value === 'string' && value.includes(' ') 
          ? `"${value.replace(/"/g, '\\"')}"` 
          : value;
        return `${key}=${escapedValue}`;
      }).join(' ');
    
    const result = execSync(`docker mcp tools call ${toolName} ${argPairs} 2>/dev/null`, { encoding: 'utf8' });
    
    const lines = result.trim().split('\n');
    const jsonLines = lines.filter(line => !line.startsWith('Tool call took:'));
    const toolResult = jsonLines.join('\n').trim();
    
    if (debug) {
      console.error('  Result: ' + toolResult.substring(0, 200) + '...');
    }
    
    history.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolName,
      content: toolResult
    });
  } catch(err) {
    if (debug) {
      console.error('  Error: ' + err.message);
    }
    
    history.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolName,
      content: JSON.stringify({ error: err.message })
    });
  }
}

// For native mode, add a user message to force final answer (prevent tool call loops)
if (process.env.TOOL_MODE === 'native') {
  history.push({
    role: 'user',
    content: 'Please provide your final answer based on the tool results above. Do not call any more tools.'
  });
}

fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

