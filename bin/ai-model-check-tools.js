#!/usr/bin/env node
const fs = require('fs');
const responseData = JSON.parse(process.env.RESPONSE_JSON);
const content = process.env.RESPONSE_CONTENT || responseData.content;
const historyFile = process.env.HISTORY_FILE;
const toolMode = (process.env.TOOL_MODE || 'prompt').toLowerCase();

let toolCalls = [];

if (toolMode === 'native') {
  // Native mode - check for tool_calls from non-streaming response
  const nativeToolCallsFile = process.env.RESPONSE_FILE + '.nativetoolcalls';
  if (fs.existsSync(nativeToolCallsFile)) {
    try {
      toolCalls = JSON.parse(fs.readFileSync(nativeToolCallsFile, 'utf8'));
    } catch(e) {}
  } else if (responseData.tool_calls && Array.isArray(responseData.tool_calls)) {
    toolCalls = responseData.tool_calls;
  }
} else {
  // Prompt mode - parse JSON code blocks OR plain JSON objects
  // Try code block format first
  const toolCallPattern = /```json\s*\n(\{[\s\S]*?\})\s*\n```/g;
  let match;

  while ((match = toolCallPattern.exec(content)) !== null) {
    try {
      const jsonStr = match[1];
      const parsed = JSON.parse(jsonStr);
      
      if (parsed.tool_call && parsed.tool_call.name) {
        toolCalls.push({
          id: 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          type: 'function',
          function: {
            name: parsed.tool_call.name,
            arguments: JSON.stringify(parsed.tool_call.arguments || {})
          }
        });
      }
    } catch(err) {}
  }
  
  // If no code blocks found, try parsing the entire content as JSON
  if (toolCalls.length === 0) {
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed.tool_call && parsed.tool_call.name) {
        toolCalls.push({
          id: 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          type: 'function',
          function: {
            name: parsed.tool_call.name,
            arguments: JSON.stringify(parsed.tool_call.arguments || {})
          }
        });
      }
    } catch(err) {
      // Not valid JSON, that's fine
    }
  }
}

const message = {
  role: 'assistant',
  content: content
};

if (toolCalls.length > 0) {
  message.tool_calls = toolCalls;
  fs.writeFileSync(process.env.RESPONSE_FILE + '.toolcalls', JSON.stringify(toolCalls));
}

let history = [];
try {
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  }
} catch(e) {}

history.push(message);
fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

console.log(toolCalls.length > 0 ? 'true' : 'false');

