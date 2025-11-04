#!/usr/bin/env node
const http = require('http');
const fs = require('fs');

const requestBody = process.env.REQUEST_PAYLOAD;
const responseFile = process.env.RESPONSE_FILE;
const iteration = parseInt(process.env.ITERATION);
const debug = process.env.DEBUG === 'true';
const startTime = parseInt(process.env.START_TIME);
const toolMode = (process.env.TOOL_MODE || 'prompt').toLowerCase();

let firstChunkTime = process.env.FIRST_CHUNK_TIME;
let responseContent = '';
let tokenUsage = null;
let timings = null;
let buffer = '';
const hasTools = (process.env.TOOLS || '').trim().length > 0;
let nativeToolCalls = [];

// Check if we need jinja flag (for native tool calling)
let needsJinja = false;
if (toolMode === 'native') {
  try {
    const payload = JSON.parse(requestBody);
    needsJinja = payload.tools && payload.tools.length > 0;
  } catch(e) {}
}

const apiPath = needsJinja 
  ? '/engines/llama.cpp/v1/chat/completions?jinja=true'
  : '/engines/llama.cpp/v1/chat/completions';

if (debug && needsJinja) {
  console.error('[DEBUG] Using native tool calling with jinja=true');
}

const options = {
  hostname: 'localhost',
  port: 12434,
  path: apiPath,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 300000,
};

const req = http.request(options, (res) => {
  if (res.statusCode !== 200) {
    let errorBody = '';
    res.on('data', (chunk) => {
      errorBody += chunk.toString('utf8');
    });
    res.on('end', () => {
      try {
        const errorData = JSON.parse(errorBody);
        // Check if this is a jinja flag error for native mode
        if (toolMode === 'native' && errorData.error && 
            errorData.error.message && errorData.error.message.includes('--jinja flag')) {
          // Save special error code to trigger fallback to prompt mode
          fs.writeFileSync(responseFile + '.error', 'NATIVE_MODE_NOT_SUPPORTED');
        } else {
          fs.writeFileSync(responseFile + '.error', JSON.stringify(errorData));
        }
      } catch(e) {
        fs.writeFileSync(responseFile + '.error', errorBody);
      }
      process.exit(1);
    });
    return;
  }
  
  // ALWAYS streaming - handle SSE response
  res.on('data', (chunk) => {
    if (!firstChunkTime) {
      firstChunkTime = Date.now();
      fs.writeFileSync(responseFile + '.firstchunk', firstChunkTime.toString());
    }
    
    const text = chunk.toString('utf8');
    buffer += text;
    
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data: ')) continue;
      
      const dataStr = line.substring(6).trim();
      if (dataStr === '[DONE]') continue;
      
      try {
        const data = JSON.parse(dataStr);
        
        if (data.choices && data.choices[0] && data.choices[0].delta) {
          const delta = data.choices[0].delta;
          const deltaContent = delta.content || '';
          
          if (deltaContent) {
            responseContent += deltaContent;
            
            // ALWAYS STREAM IMMEDIATELY - NO BUFFERING
            process.stdout.write(deltaContent);
          }
          
          // Capture tool_calls from delta (native mode)
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            delta.tool_calls.forEach(tc => {
              const existingIndex = nativeToolCalls.findIndex(t => t.index === tc.index);
              if (existingIndex >= 0) {
                // Append to existing tool call
                const existing = nativeToolCalls[existingIndex];
                if (tc.function) {
                  if (!existing.function) existing.function = {};
                  if (tc.function.name) existing.function.name = tc.function.name;
                  if (tc.function.arguments) {
                    existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
                  }
                }
                if (tc.id) existing.id = tc.id;
              } else {
                // New tool call
                nativeToolCalls.push({...tc});
              }
            });
          }
        }
        
        if (data.usage) tokenUsage = data.usage;
        if (data.timings) {
          timings = data.timings;
          if (!tokenUsage && timings) {
            tokenUsage = {
              prompt_tokens: (timings.cache_n || 0) + (timings.prompt_n || 0),
              completion_tokens: timings.predicted_n || 0,
              total_tokens: (timings.cache_n || 0) + (timings.prompt_n || 0) + (timings.predicted_n || 0),
              prompt_tokens_details: {
                cached_tokens: timings.cache_n || 0
              }
            };
          }
        }
        
        if (data.choices && data.choices[0] && data.choices[0].finish_reason) {
          if (data.usage) tokenUsage = data.usage;
          if (data.timings) {
            timings = data.timings;
            if (!tokenUsage && timings) {
              tokenUsage = {
                prompt_tokens: (timings.cache_n || 0) + (timings.prompt_n || 0),
                completion_tokens: timings.predicted_n || 0,
                total_tokens: (timings.cache_n || 0) + (timings.prompt_n || 0) + (timings.predicted_n || 0),
                prompt_tokens_details: {
                  cached_tokens: timings.cache_n || 0
                }
              };
            }
          }
        }
      } catch(parseError) {}
    }
  });
  
  res.on('end', () => {
    // Always add newline at the end since we always stream
    process.stdout.write('\n');
    
    // Save native tool calls if we captured any
    if (nativeToolCalls.length > 0) {
      fs.writeFileSync(responseFile + '.nativetoolcalls', JSON.stringify(nativeToolCalls));
    }
    
    const result = {
      content: responseContent,
      usage: tokenUsage,
      timings: timings,
    };
    fs.writeFileSync(responseFile + '.json', JSON.stringify(result));
    fs.writeFileSync(responseFile + '.content', responseContent);
    process.exit(0);
  });
  
  res.on('error', (error) => {
    fs.writeFileSync(responseFile + '.error', error.message);
    process.exit(1);
  });
});

req.on('error', (error) => {
  fs.writeFileSync(responseFile + '.error', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  fs.writeFileSync(responseFile + '.error', 'Request timeout');
  process.exit(1);
});

if (!requestBody) {
  fs.writeFileSync(responseFile + '.error', 'Empty request payload');
  process.exit(1);
}

req.write(requestBody);
req.end();

