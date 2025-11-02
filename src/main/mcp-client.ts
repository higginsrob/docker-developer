import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';

interface MCPRequest {
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  id: string | number;
  result?: any;
  error?: any;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

/**
 * MCP Client that communicates via stdio with a spawned MCP gateway process
 */
interface WriteQueueItem {
  data: string;
  callback: (err?: Error | null) => void;
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess;
  private buffer: string = '';
  private connected: boolean = false;
  private requestId: number = 1;
  private pendingRequests: Map<string | number, { resolve: Function; reject: Function; method: string }> = new Map();
  private tools: MCPTool[] = [];
  private sessionInitialized: boolean = false;
  private writeQueue: WriteQueueItem[] = [];
  private isWriting: boolean = false;

  constructor(gatewayProcess: ChildProcess) {
    super();
    this.process = gatewayProcess;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {

      if (!this.process.stdout || !this.process.stdin) {
        return reject(new Error('Gateway process missing stdout/stdin'));
      }

      // Handle stdout data
      this.process.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        // Log raw data received for debugging (first 500 chars)
        // if (text.length > 0) {
        //   console.log(`MCP Gateway stdout raw (${data.length} bytes, first 500 chars):`, text.substring(0, 500).replace(/\n/g, '\\n'));
        // }
        this.buffer += text;
        this.processBuffer();
      });

      // Handle stderr for logging
      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        // Log stderr output (these are log messages from the gateway)
        console.log('MCP Gateway log:', text.substring(0, 500));
      });

      // Handle process errors
      this.process.on('error', (err: Error) => {
        console.error('MCP Gateway process error:', err);
        this.connected = false;
        reject(err);
      });

      // Handle process exit
      this.process.on('exit', (code: number | null, signal: string | null) => {
        console.log(`MCP Gateway process exited: code=${code}, signal=${signal}`);
        this.connected = false;
        this.emit('disconnected');
      });

      this.connected = true;

      // Initialize the MCP session
      this.initialize()
        .then(() => {
          console.log('MCP Client connected and initialized');
          resolve();
        })
        .catch((err) => {
          console.error('MCP session initialization failed:', err);
          reject(err);
        });
    });
  }

  private processBuffer(): void {
    // Try to find complete JSON-RPC messages
    // JSON-RPC messages are newline-delimited JSON (NDJSON)
    let newlineIndex = this.buffer.indexOf('\n');
    
    while (newlineIndex !== -1) {
      const line = this.buffer.substring(0, newlineIndex);
      this.buffer = this.buffer.substring(newlineIndex + 1);
      
      const trimmed = line.trim();
      if (!trimmed) {
        newlineIndex = this.buffer.indexOf('\n');
        continue;
      }
      
      // Skip lines that are clearly not JSON (log messages, etc.)
      // JSON-RPC messages must start with { and be valid JSON
      // Log messages typically start with spaces, dashes, >, or other non-JSON characters
      if (!trimmed.startsWith('{')) {
        // This is definitely a log message from the gateway, skip it
        // Log it for debugging but don't try to parse it
        if (trimmed.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('-') && !trimmed.startsWith('>')) {
          console.log('Skipping non-JSON line from MCP gateway:', trimmed.substring(0, 150));
        }
        newlineIndex = this.buffer.indexOf('\n');
        continue;
      }
      
      // Only try to parse lines that start with { (JSON-RPC messages)
      try {
        const message = JSON.parse(trimmed);
        
        // Validate it's a JSON-RPC message
        // JSON-RPC 2.0 messages should have jsonrpc: "2.0" or at least an id or method field
        if (message.jsonrpc === '2.0' || message.id !== undefined || message.method !== undefined) {
          this.handleMessage(message);
        } else {
          // Looks like JSON but not a JSON-RPC message
          console.log('Skipping non-JSON-RPC JSON message:', trimmed.substring(0, 150));
        }
      } catch (err: any) {
        // If it starts with { but isn't valid JSON, it might be:
        // 1. A partial message (shouldn't happen with NDJSON, but handle it)
        // 2. A log message that happens to start with {
        if (trimmed.startsWith('{')) {
          // Check if it looks like partial JSON (unclosed braces)
          const openBraces = (trimmed.match(/\{/g) || []).length;
          const closeBraces = (trimmed.match(/\}/g) || []).length;
          
          if (openBraces > closeBraces) {
            // This might be a partial message, put it back in the buffer
            this.buffer = trimmed + '\n' + this.buffer;
            console.log('Detected partial JSON message, keeping in buffer');
            break;
          } else {
            // Not partial, just invalid JSON (probably a log message that starts with {)
            console.error('Failed to parse MCP message (invalid JSON, might be log message):', trimmed.substring(0, 200), err.message);
          }
        }
        // If it doesn't start with {, we already skipped it above
      }
      
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(message: any): void {
    // Debug: log all received messages
    if (message.id !== undefined) {
      console.log(`Received MCP message with id ${message.id}:`, JSON.stringify(message).substring(0, 300));
    }
    
    // Handle responses (have an id and match a pending request)
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        // Gateway returned an error response
        const errorMsg = message.error.message || message.error.data || JSON.stringify(message.error);
        // Use the method from the pending request
        const method = pending.method || 'unknown';
        
        // Detect specific error patterns and provide helpful context
        let fullError = `calling "${method}": ${errorMsg}`;
        
        // Check if this is a JSON-RPC parsing error from the gateway
        if (errorMsg.includes('unmarshaling jsonrpc message') && errorMsg.includes('invalid character')) {
          const charMatch = errorMsg.match(/invalid character '([^']+)'/);
          const problematicChar = charMatch ? charMatch[1] : 'unknown';
          console.error('MCP Gateway error: The gateway received an invalid response from the MCP server.');
          console.error(`The MCP server returned data starting with '${problematicChar}' instead of valid JSON-RPC.`);
          console.error('This typically means the MCP server is logging to stdout or returning non-JSON-RPC output.');
          console.error('Full error message object:', JSON.stringify(message.error, null, 2));
          
          // Provide a more helpful error message
          fullError = `MCP tool error: The MCP server returned invalid data (starts with '${problematicChar}'). This usually indicates the server is logging to stdout or not returning valid JSON-RPC. Original error: ${errorMsg}`;
        } else {
          console.error('MCP Gateway error response:', fullError);
          console.error('Full error message object:', JSON.stringify(message.error, null, 2));
        }
        
        pending.reject(new Error(fullError));
      } else {
        pending.resolve(message.result);
      }
    } else if (message.id !== undefined) {
      // Message has an id but doesn't match any pending request
      // This might be a duplicate, late, or orphaned response
      console.warn(`Received MCP message with id ${message.id} but no matching pending request`);
      console.warn('Message content:', JSON.stringify(message).substring(0, 300));
    } else if (message.method) {
      // Handle notifications/requests from server
      this.emit('notification', message);
    } else {
      // Unknown message type, log it but don't error
      console.log('Received unknown MCP message (no id or method):', JSON.stringify(message, null, 2));
    }
  }

  private async writeToStdin(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process.stdin) {
        reject(new Error('Gateway stdin not available'));
        return;
      }

      // Add to write queue
      this.writeQueue.push({
        data,
        callback: (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      });

      // Start processing queue if not already writing
      this.processWriteQueue();
    });
  }

  private processWriteQueue(): void {
    if (this.isWriting || this.writeQueue.length === 0 || !this.process.stdin) {
      return;
    }

    this.isWriting = true;
    const item = this.writeQueue.shift()!;

    // Log the exact bytes being written (for debugging)
    const byteLength = Buffer.byteLength(item.data, 'utf8');
    console.log(`Writing ${byteLength} bytes to stdin (first 200 chars):`, item.data.substring(0, 200).replace(/\n/g, '\\n'));

    this.process.stdin.write(item.data, 'utf8', (err) => {
      this.isWriting = false;
      item.callback(err);
      
      // Process next item in queue
      if (this.writeQueue.length > 0) {
        this.processWriteQueue();
      }
    });
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params && { params }),
      };

      this.pendingRequests.set(id, { resolve, reject, method });

      const requestStr = JSON.stringify(request) + '\n';
      console.log('Sending MCP request:', request.method, request.id);
      console.log('Request JSON (full):', requestStr);

      // Use queued write to ensure sequential writes
      this.writeToStdin(requestStr).catch((err) => {
        this.pendingRequests.delete(id);
        reject(err);
      });

      // Timeout after 60 seconds (longer for gateway that might be pulling images)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 60000);
    });
  }

  private async initialize(): Promise<void> {
    console.log('Initializing MCP session...');
    
    try {
      // Send initialize request
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'docker-developer',
          version: '1.0.0',
        },
      });

      console.log('MCP session initialized:', initResult);

      // Send initialized notification
      const notification = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n';
      await this.writeToStdin(notification);

      this.sessionInitialized = true;

      // List available tools
      await this.listTools();
    } catch (err) {
      console.error('Failed to initialize MCP session:', err);
      throw err;
    }
  }

  private async listTools(): Promise<void> {
    try {
      console.log('Listing available MCP tools...');
      const result = await this.sendRequest('tools/list', {});
      
      if (result && result.tools) {
        this.tools = result.tools;
        console.log(`Discovered ${this.tools.length} MCP tools:`, this.tools.map((t: MCPTool) => t.name).join(', '));
      } else {
        console.log('No tools returned from MCP gateway');
        this.tools = [];
      }
    } catch (err) {
      console.error('Failed to list tools:', err);
      this.tools = [];
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getToolsPrompt(): string {
    if (this.tools.length === 0) {
      return '';
    }

    // Create detailed tool descriptions
    const toolDescriptions = this.tools.map((tool: MCPTool) => {
      let desc = `\n### ${tool.name}`;
      if (tool.description) {
        desc += `\n${tool.description}`;
      }
      if (tool.inputSchema) {
        desc += `\nInput schema: ${JSON.stringify(tool.inputSchema, null, 2)}`;
      }
      return desc;
    }).join('\n');

    return `\n\n## Available Tools\nYou have access to these MCP tools:${toolDescriptions}\n\n## 🚨 CRITICAL: How to Use Tools - READ THIS CAREFULLY\n\n⚠️⚠️⚠️ IMPORTANT: When you need to use a tool, you MUST format your response EXACTLY like this:\n\n\`\`\`json\n{"tool_call": {"name": "tool_name", "arguments": {...}}}\n\`\`\`\n\nDO NOT just say "I need to use tool X" or "Let's use tool X" - you MUST include the JSON code block above.\nDO NOT just describe what you want to do - you MUST actually call the tool using the JSON format.\n\n### Correct Examples:\n\nExample 1 - Using read_wiki_structure:\n\`\`\`json\n{"tool_call": {"name": "read_wiki_structure", "arguments": {"repoName": "higginsrob/jdom"}}}\n\`\`\`\n\nExample 2 - Using read_wiki_contents:\n\`\`\`json\n{"tool_call": {"name": "read_wiki_contents", "arguments": {"repoName": "higginsrob/jdom"}}}\n\`\`\`\n\nExample 3 - Using ask_question:\n\`\`\`json\n{"tool_call": {"name": "ask_question", "arguments": {"repoName": "higginsrob/jdom", "question": "What testing frameworks are used?"}}}\n\`\`\`\n\n### ❌ WRONG Examples (DO NOT DO THIS):\n- "We need to use read_wiki_structure" ❌\n- "Let's read the wiki structure" ❌\n- "I should call read_wiki_structure" ❌\n- "Use read_wiki_structure to see docs" ❌\n\n### ✅ CORRECT Examples:\n- Including the JSON code block: \`\`\`json\n{"tool_call": {"name": "read_wiki_structure", "arguments": {"repoName": "higginsrob/jdom"}}}\n\`\`\` ✅\n\n### Rules:\n1. You MUST include the \`\`\`json code block with the tool_call\n2. You can include text before or after the code block, but the JSON MUST be present\n3. The JSON must be valid and match the tool's input schema\n4. DO NOT just describe what tool you want to use - ACTUALLY call it using the format above\n5. If you mention a tool name, you MUST immediately follow it with the JSON code block\n\n🚨 REMEMBER: Just describing what tool you want to use will NOT work. You MUST include the JSON code block with the tool_call format.`;
  }

  async callTool(toolName: string, args: any): Promise<any> {
    if (!this.connected || !this.sessionInitialized) {
      throw new Error('MCP Client not connected or session not initialized');
    }

    console.log(`Calling MCP tool: ${toolName} with args:`, JSON.stringify(args, null, 2));

    try {
      const result = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      console.log(`Tool ${toolName} result:`, result);
      return result;
    } catch (err: any) {
      console.error(`Tool ${toolName} error:`, err);
      throw err;
    }
  }

  isConnected(): boolean {
    return this.connected && this.sessionInitialized;
  }

  disconnect(): void {
    if (this.process && !this.process.killed) {
      console.log('Disconnecting MCP client and terminating gateway process');
      this.process.kill();
    }
    this.connected = false;
  }
}
