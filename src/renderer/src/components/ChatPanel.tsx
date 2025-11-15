import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import io from 'socket.io-client';
import './ChatPanel.css';
import { Agent } from './Agents';
import MessageRenderer from './MessageRenderer';
import JSONExplorer from './JSONExplorer';
import { WrenchScrewdriverIcon, CpuChipIcon, UserIcon, PhotoIcon } from '@heroicons/react/24/outline';

// Circle progress component for context usage visualization
const CircleProgress: React.FC<{ percentage: number; size?: number }> = React.memo(({ percentage, size = 24 }) => {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  
  // Color based on usage percentage
  const getColor = (pct: number) => {
    if (pct >= 90) return '#ef4444'; // red
    if (pct >= 70) return '#f59e0b'; // orange
    return '#10b981'; // green
  };
  
  return (
    <svg width={size} height={size} className="circle-progress">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#404040"
        strokeWidth="2"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={getColor(percentage)}
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  );
});

const socket = io('http://localhost:3002');
const CHAT_PANEL_WIDTH_KEY = 'chatPanelWidth';
const CHAT_PANEL_EXPANDED_KEY = 'chatPanelExpanded';
const SELECTED_TOOLS_KEY = 'selectedTools';

interface UserSettings {
  allowUseGitName: boolean;
  allowUseGitEmail: boolean;
  nickname: string;
  language: string;
  age: string;
  gender: string;
  orientation: string;
  race: string;
  ethnicity: string;
  jobTitle: string;
  employer: string;
  incomeLevel: string;
  educationLevel: string;
  politicalIdeology: string;
  maritalStatus: string;
  numberOfChildren: string;
  housing: string;
  headOfHousehold: string;
  religion: string;
  interests: string;
  country: string;
  state: string;
  zipcode: string;
  gitName?: string;
  gitEmail?: string;
}

// Load selected tools from localStorage for a specific agent
const loadSelectedTools = (agentId: string | null | undefined): string[] => {
  if (!agentId) return [];
  
  try {
    const saved = localStorage.getItem(SELECTED_TOOLS_KEY);
    if (saved) {
      const allTools = JSON.parse(saved);
      // Return tools for this specific agent, or empty array if none saved
      return allTools[agentId] || [];
    }
  } catch (error) {
    console.error('Error loading selected tools:', error);
  }
  return [];
};

// Save selected tools to localStorage for a specific agent
const saveSelectedTools = (agentId: string | null | undefined, tools: string[]): void => {
  if (!agentId) return;
  
  try {
    const saved = localStorage.getItem(SELECTED_TOOLS_KEY);
    const allTools = saved ? JSON.parse(saved) : {};
    allTools[agentId] = tools;
    localStorage.setItem(SELECTED_TOOLS_KEY, JSON.stringify(allTools));
  } catch (error) {
    console.error('Error saving selected tools:', error);
  }
};

interface UserProfile {
  email: string;
  name: string;
  avatar: string;
}

export interface ChatPanelRef {
  focusInput: () => void;
}

export type SelectedContext = 
  | { type: 'project'; path: string }
  | { type: 'container'; id: string; name: string }
  | null;

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedContext: SelectedContext;
  selectedAgent?: Agent | null;
  agents?: Agent[];
  userProfile?: UserProfile;
  terminalHeight?: number;
  onAgentChatStart?: (agentId: string, agentName: string) => void;
  onClearAgentTabs?: () => void;
  onClearAgentTab?: (agentId: string) => void;
  onOpenTerminal?: () => void;
}

interface ChatMessage {
  id: string;
  type: 'prompt' | 'response' | 'toolResult' | 'toolCall';
  content: string;
  expanded: boolean;
  timestamp: Date;
  agent?: Agent | null;
  isStreaming?: boolean;
  toolName?: string; // Name of the tool that produced this result
  toolResult?: any; // Tool result data (for toolResult type messages)
  _requestId?: string; // Request ID to match with token usage
  _isPlaceholder?: boolean; // Flag to identify placeholder messages
  _isToolCallOnly?: boolean; // Flag to indicate this response is only a tool call
  contextUsage?: {
    promptTokens: number;
    maxContext: number;
    usagePercent: number;
  };
}

interface Model {
  name: string;
  id: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  tokensUsed: number;
  changedLines: number;
  isProcessing: boolean;
  lastUpdated: Date;
}

// Load chat panel width from localStorage
const loadChatPanelWidth = (): number => {
  try {
    const saved = localStorage.getItem(CHAT_PANEL_WIDTH_KEY);
    if (saved) {
      const width = parseInt(saved, 10);
      return width >= 300 ? width : 500; // Ensure minimum width
    }
  } catch (error) {
    console.error('Error loading chat panel width:', error);
  }
  return 500; // Default width
};

// Load chat panel expanded state from localStorage
const loadChatPanelExpanded = (): boolean => {
  try {
    const saved = localStorage.getItem(CHAT_PANEL_EXPANDED_KEY);
    return saved === 'true';
  } catch (error) {
    console.error('Error loading chat panel expanded state:', error);
  }
  return false; // Default to not expanded
};

// Save chat panel expanded state to localStorage
const saveChatPanelExpanded = (isExpanded: boolean): void => {
  try {
    localStorage.setItem(CHAT_PANEL_EXPANDED_KEY, String(isExpanded));
  } catch (error) {
    console.error('Error saving chat panel expanded state:', error);
  }
};

// Helper function to parse final answer from response text
// Looks for common patterns like '\n--\n' and '\nAnswer:\n'
// If no pattern is found, returns the entire response
const parseFinalAnswer = (fullResponse: string): string => {
  if (!fullResponse || fullResponse.trim().length === 0) {
    return fullResponse;
  }
  
  // First, remove any tool call JSON blocks from the response
  // Pattern: ```json\n{"tool_call": {...}}\n``` 
  const toolCallPattern = /```json\s*\n\{[\s\S]*?"tool_call"[\s\S]*?\}\s*\n```/g;
  let cleanedResponse = fullResponse.replace(toolCallPattern, '').trim();
  
  // If after removing tool calls, there's nothing left, return empty
  if (!cleanedResponse) {
    return cleanedResponse;
  }
  
  // Try pattern: '\n--\n' (common separator)
  const separatorPattern = /\n--\n/;
  const separatorMatch = cleanedResponse.search(separatorPattern);
  if (separatorMatch !== -1) {
    const finalAnswer = cleanedResponse.substring(separatorMatch + 4).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // Try pattern: '\nAnswer:\n' (common answer marker)
  const answerPattern1 = /\nAnswer:\s*\n/i;
  const answerMatch1 = cleanedResponse.match(answerPattern1);
  if (answerMatch1 && answerMatch1.index !== undefined) {
    const finalAnswer = cleanedResponse.substring(answerMatch1.index + answerMatch1[0].length).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // Try pattern: 'Answer:' (without newline)
  const answerPattern2 = /Answer:\s*/i;
  const answerMatch2 = cleanedResponse.match(answerPattern2);
  if (answerMatch2 && answerMatch2.index !== undefined) {
    const finalAnswer = cleanedResponse.substring(answerMatch2.index + answerMatch2[0].length).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // Try pattern: 'Final Answer:' or 'Final Answer:'
  const finalAnswerPattern = /Final\s+Answer:\s*/i;
  const finalAnswerMatch = cleanedResponse.match(finalAnswerPattern);
  if (finalAnswerMatch && finalAnswerMatch.index !== undefined) {
    const finalAnswer = cleanedResponse.substring(finalAnswerMatch.index + finalAnswerMatch[0].length).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // No pattern found - return cleaned response (will be parsed as markdown)
  return cleanedResponse;
};

// Helper function to separate thinking from answer
const separateThinkingAndAnswer = (fullResponse: string): { thinking: string; answer: string } => {
  if (!fullResponse || fullResponse.trim().length === 0) {
    return { thinking: '', answer: '' };
  }
  
  // First, remove any tool call JSON blocks from the response
  const toolCallPattern = /```json\s*\n\{[\s\S]*?"tool_call"[\s\S]*?\}\s*\n```/g;
  let cleanedResponse = fullResponse.replace(toolCallPattern, '').trim();
  
  if (!cleanedResponse) {
    return { thinking: '', answer: '' };
  }
  
  // Try pattern: '\n--\n' (common separator)
  const separatorPattern = /\n--\n/;
  const separatorMatch = cleanedResponse.search(separatorPattern);
  if (separatorMatch !== -1) {
    const thinking = cleanedResponse.substring(0, separatorMatch).trim();
    const answer = cleanedResponse.substring(separatorMatch + 4).trim();
    return { thinking, answer };
  }
  
  // Try pattern: '\nAnswer:\n' (common answer marker)
  const answerPattern1 = /\nAnswer:\s*\n/i;
  const answerMatch1 = cleanedResponse.match(answerPattern1);
  if (answerMatch1 && answerMatch1.index !== undefined) {
    const thinking = cleanedResponse.substring(0, answerMatch1.index).trim();
    const answer = cleanedResponse.substring(answerMatch1.index + answerMatch1[0].length).trim();
    return { thinking, answer };
  }
  
  // Try pattern: 'Answer:' (without newline)
  const answerPattern2 = /Answer:\s*/i;
  const answerMatch2 = cleanedResponse.match(answerPattern2);
  if (answerMatch2 && answerMatch2.index !== undefined) {
    const thinking = cleanedResponse.substring(0, answerMatch2.index).trim();
    const answer = cleanedResponse.substring(answerMatch2.index + answerMatch2[0].length).trim();
    return { thinking, answer };
  }
  
  // Try pattern: 'Final Answer:' or 'Final Answer:'
  const finalAnswerPattern = /Final\s+Answer:\s*/i;
  const finalAnswerMatch = cleanedResponse.match(finalAnswerPattern);
  if (finalAnswerMatch && finalAnswerMatch.index !== undefined) {
    const thinking = cleanedResponse.substring(0, finalAnswerMatch.index).trim();
    const answer = cleanedResponse.substring(finalAnswerMatch.index + finalAnswerMatch[0].length).trim();
    return { thinking, answer };
  }
  
  // No pattern found - treat entire cleaned response as answer
  return { thinking: '', answer: cleanedResponse };
};

// Helper function to calculate confidence score
// This is a simple heuristic - backend can provide more accurate scores later
const calculateConfidenceScore = (
  response: string,
  tokenUsage?: { promptTokens: number; completionTokens?: number; totalTokens?: number; maxContext: number; usagePercent: number; timings?: any }
): number => {
  if (!response || response.trim().length === 0) {
    return 0;
  }
  
  let score = 50; // Base confidence
  
  // Increase confidence for longer responses (more thoughtful)
  const responseLength = response.length;
  if (responseLength > 500) {
    score += 15;
  } else if (responseLength > 200) {
    score += 10;
  } else if (responseLength < 50) {
    score -= 10; // Very short responses might be incomplete
  }
  
  // Adjust based on context usage (moderate usage is good)
  if (tokenUsage) {
    const usagePercent = tokenUsage.usagePercent;
    if (usagePercent > 0 && usagePercent < 80) {
      score += 10; // Good context usage
    } else if (usagePercent >= 90) {
      score -= 5; // Context might be too full
    }
  }
  
  // Check for markers of uncertainty
  const uncertaintyMarkers = ['maybe', 'perhaps', 'might', 'could', 'possibly', 'uncertain', 'not sure'];
  const lowerResponse = response.toLowerCase();
  const uncertaintyCount = uncertaintyMarkers.filter(marker => lowerResponse.includes(marker)).length;
  score -= uncertaintyCount * 3;
  
  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, Math.round(score)));
};

// ANSI color codes for terminal output
const ANSI_RESET = '\x1b[0m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_ORANGE = '\x1b[38;5;208m'; // 256-color mode orange
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_BOLD = '\x1b[1m';

// Helper function to format duration with color coding
const formatDurationWithColor = (durationSeconds: string): string => {
  const duration = parseFloat(durationSeconds);
  if (duration > 12) {
    return `${ANSI_BOLD}${ANSI_RED}${durationSeconds}s${ANSI_RESET}`;
  } else if (duration > 6) {
    return `${ANSI_ORANGE}${durationSeconds}s${ANSI_RESET}`;
  } else if (duration > 1) {
    return `${ANSI_YELLOW}${durationSeconds}s${ANSI_RESET}`;
  }
  return `${durationSeconds}s`;
};

// Helper function to format size with color coding
const formatSizeWithColor = (size: number, formattedSize: string): string => {
  const sizeKB = size / 1024;
  if (sizeKB > 15) {
    return `${ANSI_ORANGE}${formattedSize}${ANSI_RESET}`;
  } else if (sizeKB > 5) {
    return `${ANSI_YELLOW}${formattedSize}${ANSI_RESET}`;
  }
  return formattedSize;
};

// Helper function to format tokens per second with color coding
const formatTokensPerSecondWithColor = (tokensPerSecond: number): string => {
  const formatted = tokensPerSecond.toFixed(1);
  if (tokensPerSecond < 10) {
    return `${ANSI_RED}${formatted} tokens/s${ANSI_RESET}`;
  } else if (tokensPerSecond < 20) {
    return `${ANSI_ORANGE}${formatted} tokens/s${ANSI_RESET}`;
  } else if (tokensPerSecond < 50) {
    return `${ANSI_YELLOW}${formatted} tokens/s${ANSI_RESET}`;
  } else if (tokensPerSecond > 100) {
    return `${ANSI_GREEN}${formatted} tokens/s${ANSI_RESET}`;
  }
  return `${formatted} tokens/s`;
};

// Helper function to parse tool calls from message content
const parseToolCalls = (content: string): Array<{ name: string; arguments: any }> => {
  const toolCalls: Array<{ name: string; arguments: any }> = [];
  
  // Match JSON code blocks with tool_call format
  // Pattern: ```json\n{"tool_call": {"name": "...", "arguments": {...}}}\n```
  const codeBlockPattern = /```json\s*\n(\{[\s\S]*?\})\s*\n```/g;
  let match;
  
  while ((match = codeBlockPattern.exec(content)) !== null) {
    try {
      const jsonStr = match[1];
      const parsed = JSON.parse(jsonStr);
      
      // Check if it's a tool_call format
      if (parsed.tool_call && parsed.tool_call.name) {
        toolCalls.push({
          name: parsed.tool_call.name,
          arguments: parsed.tool_call.arguments || {}
        });
      }
    } catch (err) {
      // Not a valid tool call, continue parsing other blocks
    }
  }
  
  return toolCalls;
};

// Helper function to check if content is ONLY a tool call (nothing else)
const isOnlyToolCall = (content: string): { isOnly: boolean; toolName?: string } => {
  if (!content || content.trim().length === 0) {
    return { isOnly: false };
  }
  
  // Match the entire content to see if it's just a tool call
  const trimmedContent = content.trim();
  const codeBlockPattern = /^```json\s*\n(\{[\s\S]*?\})\s*\n```$/;
  const match = trimmedContent.match(codeBlockPattern);
  
  if (match) {
    try {
      const jsonStr = match[1];
      const parsed = JSON.parse(jsonStr);
      
      // Check if it's a tool_call format and ONLY that
      if (parsed.tool_call && parsed.tool_call.name) {
        return { isOnly: true, toolName: parsed.tool_call.name };
      }
    } catch (err) {
      // Not a valid tool call
    }
  }
  
  return { isOnly: false };
};

// Helper function to replace tool call JSON blocks with simplified display
const replaceToolCallsInContent = (content: string): string => {
  // Match JSON code blocks with tool_call format
  const codeBlockPattern = /```json\s*\n(\{[\s\S]*?\})\s*\n```/g;
  
  return content.replace(codeBlockPattern, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr);
      
      // Check if it's a tool_call format
      if (parsed.tool_call && parsed.tool_call.name) {
        return `### Tool call: ${parsed.tool_call.name}`;
      }
    } catch (err) {
      // Not a valid tool call, return original
    }
    return match;
  });
};

const ChatPanel = forwardRef<ChatPanelRef, ChatPanelProps>(({ isOpen, onClose, selectedContext, selectedAgent, agents = [], userProfile, terminalHeight = 0, onAgentChatStart, onClearAgentTabs, onClearAgentTab, onOpenTerminal }, ref) => {
  const [width, setWidth] = useState(loadChatPanelWidth());
  const [isResizing, setIsResizing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(loadChatPanelExpanded());
  const [thinkingTokens, setThinkingTokens] = useState(8192); // Default to 8192 for larger context
  const [promptText, setPromptText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentContextUsage, setCurrentContextUsage] = useState<{
    promptTokens: number;
    maxContext: number;
    usagePercent: number;
  } | null>(null);
  const [, setChatHistory] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>({
    allowUseGitName: true,
    allowUseGitEmail: true,
    nickname: '',
    language: '',
    age: '',
    gender: '',
    orientation: '',
    race: '',
    ethnicity: '',
    jobTitle: '',
    employer: '',
    incomeLevel: '',
    educationLevel: '',
    politicalIdeology: '',
    maritalStatus: '',
    numberOfChildren: '',
    housing: '',
    headOfHousehold: '',
    religion: '',
    interests: '',
    country: '',
    state: '',
    zipcode: '',
    gitName: '',
    gitEmail: '',
  });
  const pendingRequestsRef = useRef<Set<string>>(new Set()); // Track all pending request IDs across all agents
  const [hasPendingRequests, setHasPendingRequests] = useState(false); // State to trigger re-renders
  const [ragIndexingStatus, setRagIndexingStatus] = useState<string | null>(null); // RAG indexing status
  const [selectedTools, setSelectedTools] = useState<string[]>([]); // Selected tools for the current conversation
  const [showToolsDropdown, setShowToolsDropdown] = useState(false); // Show tools dropdown
  const [globallyEnabledTools, setGloballyEnabledTools] = useState<string[]>([]); // Globally enabled MCP servers
  const [selectedImage, setSelectedImage] = useState<{ data: string; mediaType: string; name: string } | null>(null); // Selected image for upload
  const [availableSessions, setAvailableSessions] = useState<any[]>([]); // Available sessions for current agent
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null); // Currently selected session
  const [sessionSummaries, setSessionSummaries] = useState<Map<string, string>>(new Map()); // Session ID -> summary
  const requestTokenUsage = useRef<Map<string, { promptTokens: number; completionTokens?: number; totalTokens?: number; maxContext: number; usagePercent: number; timings?: any }>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousMessagesLengthRef = useRef<number>(0);
  const isSwitchingAgentRef = useRef<boolean>(false);
  const inputTextareaRef = useRef<HTMLTextAreaElement>(null);
  const previousAgentIdRef = useRef<string | null>(null);
  const previousContextRef = useRef<SelectedContext>(null);
  const previousIsOpenRef = useRef<boolean>(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const isWaitingForResponseRef = useRef<boolean>(false);
  const requestIdToAgentIdRef = useRef<Map<string, string>>(new Map()); // Track which agent each request belongs to
  const focusTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track focus timeout to prevent loops
  const lastFocusTimeRef = useRef<number>(0); // Track last focus time to prevent rapid focus calls
  const requestStartTimesRef = useRef<Map<string, number>>(new Map()); // Track request start times for duration calculation
  const requestResponseSizesRef = useRef<Map<string, number>>(new Map()); // Track response sizes in bytes (keyed by responseId)
  const responseIdToRequestIdRef = useRef<Map<string, string>>(new Map()); // Map responseId to requestId for lookups
  const firstChunkTimesRef = useRef<Map<string, number>>(new Map()); // Track when first chunk arrives (for latency) - keyed by responseId
  const streamingStartTimesRef = useRef<Map<string, number>>(new Map()); // Track when streaming starts (for answering duration) - keyed by responseId
  const lastChunkTimesRef = useRef<Map<string, number>>(new Map()); // Track when last chunk arrives (for answering duration) - keyed by responseId
  const metricsCalculatedRef = useRef<Set<string>>(new Set()); // Track which responses have already had metrics calculated to prevent duplicates
  
  // Helper function to check if there are pending requests for the current agent
  const checkPendingRequestsForCurrentAgent = useCallback(() => {
    if (!selectedAgent) {
      setHasPendingRequests(false);
      return;
    }
    
    // Check if any pending request belongs to the current agent
    const hasPendingForCurrentAgent = Array.from(pendingRequestsRef.current).some(requestId => {
      const agentId = requestIdToAgentIdRef.current.get(requestId);
      return agentId === selectedAgent.id;
    });
    
    setHasPendingRequests(hasPendingForCurrentAgent);
  }, [selectedAgent]);
  
  // Keep refs in sync with state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  
  useEffect(() => {
    isWaitingForResponseRef.current = isWaitingForResponse;
  }, [isWaitingForResponse]);
  
  // Expose focusInput method via ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      // Prevent focus loops by checking if focus was called recently
      const now = Date.now();
      const timeSinceLastFocus = now - lastFocusTimeRef.current;
      
      // If focus was called within the last 100ms, ignore this call to prevent loops
      if (timeSinceLastFocus < 100) {
        return;
      }
      
      // Clear any pending focus timeout
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      
      // Only focus if the element exists and is not already focused
      if (inputTextareaRef.current && document.activeElement !== inputTextareaRef.current) {
        lastFocusTimeRef.current = Date.now();
        // Use a small timeout to ensure DOM is ready
        focusTimeoutRef.current = setTimeout(() => {
          if (inputTextareaRef.current && document.activeElement !== inputTextareaRef.current) {
            inputTextareaRef.current.focus();
          }
          focusTimeoutRef.current = null;
        }, 10);
      }
    }
  }), []);

  // Helper to get project path from context
  const getProjectPathFromContext = (context: SelectedContext): string | null => {
    return context?.type === 'project' ? context.path : null;
  };

  // Create stable context key for dependency comparison - use ref to avoid recalculating
  const contextKeyRef = useRef<string | null>(null);
  const getContextKey = useCallback((context: SelectedContext): string | null => {
    if (!context) return null;
    if (context.type === 'project') {
      return `project:${context.path}`;
    } else {
      return `container:${context.id}:${context.name}`;
    }
  }, []);
  
  // Use useMemo to create stable context key
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentContextKey = useMemo(() => getContextKey(selectedContext), [
    selectedContext?.type,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectedContext?.type === 'project' ? selectedContext?.path : selectedContext?.id,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectedContext?.type === 'container' ? selectedContext?.name : undefined,
  ]);

  // Apply agent settings when agent is selected
  useEffect(() => {
    const agentId = selectedAgent?.id;
    const previousAgentId = previousAgentIdRef.current;
    const previousContextKey = contextKeyRef.current;
    const contextChanged = previousContextKey !== currentContextKey;
    
    // Skip if this is the same agent and context we just processed
    if (agentId === previousAgentId && !contextChanged && previousAgentId !== null) {
      return;
    }
    
    if (selectedAgent) {
      const isDifferentAgent = previousAgentId !== null && previousAgentId !== agentId;
      const isDifferentContext = contextChanged;
      
      // Update context key ref if it changed
      if (contextChanged) {
        contextKeyRef.current = currentContextKey;
      }
      
      // Only save and clear if we're actually switching agents or context
      if (isDifferentAgent || isDifferentContext) {
        // Save current session before switching agents or context
        // History is now automatically saved by the backend to history files
        // No need to save sessions manually
        
        setThinkingTokens(selectedAgent.contextSize);
        // Mark that we're switching agents
        isSwitchingAgentRef.current = true;
        // Clear current messages when switching agents - but wait for history to load
        setMessages([]);
        setPromptText('');
        setCurrentSessionId(null);
        setCurrentContextUsage(null);
        
        // Load sessions list for this agent (which will also load the current session's history)
        socket.emit('getAgentSessions', { agentId: agentId });
      }
      // Note: We don't update thinking tokens for same agent/context anymore to avoid loops
      // Users can manually adjust if needed
      
      // Update refs
      previousAgentIdRef.current = agentId ?? null;
      previousContextRef.current = selectedContext;
      
      // Check pending requests for the current agent (using ref to avoid dependency)
      const hasPendingForCurrentAgent = Array.from(pendingRequestsRef.current).some(requestId => {
        const requestAgentId = requestIdToAgentIdRef.current.get(requestId);
        return requestAgentId === agentId;
      });
      setHasPendingRequests(hasPendingForCurrentAgent);
    } else {
      // No agent selected - only clear if we had an agent before
      if (previousAgentId !== null) {
        // History is now automatically saved by the backend to history files
        // No need to save sessions manually
        
        // If no agent selected, clear everything
        setMessages([]);
        setPromptText('');
        setCurrentSessionId(null);
        setCurrentContextUsage(null);
        isSwitchingAgentRef.current = false;
        previousAgentIdRef.current = null;
        previousContextRef.current = null;
        setHasPendingRequests(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent?.id ?? null, currentContextKey]); // Only depend on agent ID and context key

  // Load history when chat panel opens if we have an agent selected but no messages
  useEffect(() => {
    const wasOpen = previousIsOpenRef.current;
    const isNowOpen = isOpen;
    
    // Update the ref
    previousIsOpenRef.current = isOpen;
    
    // If chat just opened and we have an agent selected but no messages, load sessions
    if (!wasOpen && isNowOpen && selectedAgent && messages.length === 0) {
      console.log('Chat panel opened with agent selected, loading sessions');
      isSwitchingAgentRef.current = true;
      socket.emit('getAgentSessions', { agentId: selectedAgent.id });
    }
  }, [isOpen, selectedAgent, messages.length]);

  // Save chat panel width to localStorage when it changes
  useEffect(() => {
    if (width >= 300 && width <= window.innerWidth * 0.8) {
      try {
        localStorage.setItem(CHAT_PANEL_WIDTH_KEY, width.toString());
      } catch (error) {
        console.error('Error saving chat panel width:', error);
      }
    }
  }, [width]);

  // Close tools dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showToolsDropdown && toolsDropdownRef.current && !toolsDropdownRef.current.contains(event.target as Node)) {
        setShowToolsDropdown(false);
      }
    };

    if (showToolsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showToolsDropdown]);

  // Fetch globally enabled MCP servers and tools
  useEffect(() => {
    socket.emit('getMCPServers');
    socket.emit('getMCPTools');
    
    socket.on('mcpServers', (serverList: Array<{ name: string; enabled: boolean }>) => {
      // Filter to only enabled servers
      const enabled = serverList.filter(s => s.enabled).map(s => s.name);
      console.log('MCP servers updated:', enabled);
      // Set to server names initially, will be replaced by actual tools
      setGloballyEnabledTools(enabled);
    });
    
    // Listen for MCP tools updates (actual tool names from the gateway)
    // This should only be used on initial load, not after each prompt execution
    socket.on('mcpToolsUpdated', (toolNames: string[]) => {
      console.log('MCP tools updated:', toolNames);
      // Only update if we're getting a larger or initial list
      // This prevents the list from shrinking when backend emits only used tools
      setGloballyEnabledTools(prev => {
        // If new list is larger, or we have no list yet, update it
        if (!prev || prev.length === 0 || toolNames.length > prev.length) {
          console.log('Updating tools list (larger or initial):', toolNames);
          // Clear selected tools that are no longer available
          setSelectedTools(prevSelected => 
            prevSelected.filter(tool => toolNames.includes(tool))
          );
          return toolNames;
        }
        // Otherwise keep the existing list
        console.log('Keeping existing tools list (new list is smaller)');
        return prev;
      });
    });
    
    return () => {
      socket.off('mcpServers');
      socket.off('mcpToolsUpdated');
    };
  }, []);

  // Initialize selected tools when agent changes - load from localStorage
  useEffect(() => {
    // Load previously selected tools for this agent from localStorage
    const savedTools = loadSelectedTools(selectedAgent?.id);
    setSelectedTools(savedTools);
  }, [selectedAgent?.id]);

  // Save selected tools to localStorage whenever they change
  useEffect(() => {
    // Only save if we have an agent selected
    if (selectedAgent?.id) {
      saveSelectedTools(selectedAgent.id, selectedTools);
    }
  }, [selectedTools, selectedAgent?.id]);

  // Save messages when chat window closes
  useEffect(() => {
    // When chat closes (isOpen changes from true to false), save current session
    const wasOpen = previousIsOpenRef.current;
    const isClosing = wasOpen && !isOpen;
    
    // History is now automatically saved by the backend to history files
    // No need to save sessions manually when closing
    
    // Update ref for next comparison
    previousIsOpenRef.current = isOpen;
  }, [isOpen, selectedAgent, messages, currentSessionId, isWaitingForResponse, selectedContext]);

  // Load history when chat opens
  useEffect(() => {
    if (isOpen && selectedAgent) {
      console.log('Chat opened, loading history for agent:', selectedAgent.id);
      // Always reload history when opening chat to get latest updates
      socket.emit('getAgentChatHistory', { projectPath: getProjectPathFromContext(selectedContext), agentId: selectedAgent.id });
      // Check pending requests for the current agent when opening chat (using ref to avoid dependency)
      const currentAgentId = selectedAgent.id;
      const hasPendingForCurrentAgent = Array.from(pendingRequestsRef.current).some(requestId => {
        const agentId = requestIdToAgentIdRef.current.get(requestId);
        return agentId === currentAgentId;
      });
      setHasPendingRequests(hasPendingForCurrentAgent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedAgent?.id ?? null, currentContextKey]); // Reload when opening or agent/context changes

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      // Get the parent container (the flex container that holds main content and chat)
      const parentContainer = panelRef.current.parentElement;
      if (!parentContainer) return;

      const parentRect = parentContainer.getBoundingClientRect();
      const newWidth = parentRect.right - e.clientX;

      // Minimum width constraint
      if (newWidth < 350) {
        setWidth(350);
      } else {
        // Limit max width to 80% of parent container width
        const maxWidth = parentRect.width * 0.8;
        setWidth(Math.min(newWidth, maxWidth));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onClose]);

  // Load models and chat history on mount
  useEffect(() => {
    if (isOpen) {
      socket.emit('getChatModels');
      // Reload user settings when chat opens
      socket.emit('getUserSettings');
    }

    socket.on('userSettings', (settings: UserSettings) => {
      setUserSettings(settings);
    });

    socket.on('chatModels', (modelsList: Model[]) => {
      // Models loaded but not used - agent provides the model
    });

    socket.on('ragIndexingStatus', (data: { status: string | null }) => {
      setRagIndexingStatus(data.status);
    });

    socket.on('chatStatusUpdate', (data: { id: string; status: string; details: string }) => {
      // Status updates are now handled in terminal view, not in chat
      // Just ensure placeholder exists if needed
      setMessages(prev => {
        const placeholder = prev.find(msg => msg._isPlaceholder && msg._requestId === currentRequestId);
        if (!placeholder && currentRequestId) {
          const placeholderResponse: ChatMessage = {
            id: data.id,
            type: 'response',
            content: '',
            expanded: false,
            timestamp: new Date(),
            agent: selectedAgent || null,
            isStreaming: true,
            _isPlaceholder: true,
            _requestId: currentRequestId,
          };
          return [...prev, placeholderResponse];
        }
        return prev;
      });
    });

    // Handle streaming response chunks - only final response content is streamed
    socket.on('chatResponseChunk', (data: { id: string; chunk: string }) => {
      // Find which agent this response belongs to by finding the placeholder with matching requestId
      // The responseId might be different from requestId, so we need to find the placeholder
      let responseAgentId: string | undefined;
      
      // Check if we have a placeholder with a requestId that matches
      // The data.id might be the responseId, so we need to check currentRequestId or find placeholder
      const matchingPlaceholder = messagesRef.current.find(msg => 
        msg._isPlaceholder && msg._requestId === currentRequestId
      );
      
      if (matchingPlaceholder && matchingPlaceholder.agent) {
        responseAgentId = matchingPlaceholder.agent.id;
        // Store mapping of responseId to agentId for final response
        requestIdToAgentIdRef.current.set(data.id, responseAgentId);
      } else {
        // Try to find by checking existing mappings
        responseAgentId = requestIdToAgentIdRef.current.get(data.id) ?? 
          (currentRequestId ? requestIdToAgentIdRef.current.get(currentRequestId) : undefined);
      }
      
      // If this response doesn't belong to the current agent, ignore it (will handle in final response)
      if (responseAgentId && responseAgentId !== selectedAgent?.id) {
        // Store the mapping for when final response comes
        requestIdToAgentIdRef.current.set(data.id, responseAgentId);
        
        // Map responseId to requestId for later lookup
        const requestId = currentRequestId || data.id;
        if (requestId && data.id !== requestId) {
          responseIdToRequestIdRef.current.set(data.id, requestId);
        }
        
        // Still track response size even for other agents (needed for status message)
        // Use responseId (data.id) as the key since chunks come with responseId
        if (data.id) {
          const currentSize = requestResponseSizesRef.current.get(data.id) || 0;
          const chunkSize = new TextEncoder().encode(data.chunk).length;
          requestResponseSizesRef.current.set(data.id, currentSize + chunkSize);
          
          // Track timing for first chunk (latency)
          if (!firstChunkTimesRef.current.has(data.id)) {
            firstChunkTimesRef.current.set(data.id, Date.now());
            streamingStartTimesRef.current.set(data.id, Date.now());
          }
          // Update last chunk time (for answering duration)
          lastChunkTimesRef.current.set(data.id, Date.now());
        }
        
        return;
      }
      
      setMessages(prev => {
        // Find existing message or placeholder
        const existing = prev.find(msg => msg.id === data.id);
        const placeholder = prev.find(msg => msg._isPlaceholder && msg._requestId === currentRequestId);
        const targetMessage = existing || placeholder;
        
        // Map responseId to requestId for later lookup
        const requestId = targetMessage?._requestId || currentRequestId;
        if (requestId && data.id !== requestId) {
          responseIdToRequestIdRef.current.set(data.id, requestId);
        }
        
        if (targetMessage) {
          // Update content - replace "Thinking..." with actual content
          const newContent = (targetMessage.content || '') + data.chunk;
          const updatedId = targetMessage._isPlaceholder ? data.id : targetMessage.id;
          
          // Track response size using responseId (data.id) since chunks come with responseId
          if (data.id) {
            const currentSize = requestResponseSizesRef.current.get(data.id) || 0;
            const chunkSize = new TextEncoder().encode(data.chunk).length;
            requestResponseSizesRef.current.set(data.id, currentSize + chunkSize);
            
            // Track timing for first chunk (latency)
            if (!firstChunkTimesRef.current.has(data.id)) {
              firstChunkTimesRef.current.set(data.id, Date.now());
              streamingStartTimesRef.current.set(data.id, Date.now());
            }
            // Update last chunk time (for answering duration)
            lastChunkTimesRef.current.set(data.id, Date.now());
          }
          
          return prev.map(msg => 
            msg.id === targetMessage.id
              ? { 
                  ...msg, 
                  id: updatedId,
                  content: newContent,
                  isStreaming: true,
                  _isPlaceholder: false, // No longer a placeholder once we have content
                  // Preserve contextUsage during streaming
                  contextUsage: msg.contextUsage,
                }
              : msg
          );
        } else {
          // No existing message or placeholder found
          // Check if the last message is a tool call - if so, replace it
          const lastMessage = prev[prev.length - 1];
          
          if (lastMessage && lastMessage.type === 'toolCall') {
            // Replace the tool call message with streaming content
            // Track response size
            if (data.id) {
              const currentSize = requestResponseSizesRef.current.get(data.id) || 0;
              const chunkSize = new TextEncoder().encode(data.chunk).length;
              requestResponseSizesRef.current.set(data.id, currentSize + chunkSize);
              
              // Track timing for first chunk (latency)
              if (!firstChunkTimesRef.current.has(data.id)) {
                firstChunkTimesRef.current.set(data.id, Date.now());
                streamingStartTimesRef.current.set(data.id, Date.now());
              }
              // Update last chunk time (for answering duration)
              lastChunkTimesRef.current.set(data.id, Date.now());
            }
            
            return prev.map((msg, idx) =>
              idx === prev.length - 1
                ? {
                    ...msg,
                    id: data.id,
                    type: 'response',
                    content: data.chunk,
                    toolName: undefined,
                    isStreaming: true,
                    _isPlaceholder: false,
                    _isToolCallOnly: false,
                    // Preserve contextUsage from the tool call message
                    contextUsage: msg.contextUsage,
                  }
                : msg
            );
          }
          
          // Otherwise create new message (fallback)
          const newMessage: ChatMessage = {
            id: data.id,
            type: 'response',
            content: data.chunk,
            expanded: false,
            timestamp: new Date(),
            agent: selectedAgent || null,
            isStreaming: true,
            _requestId: currentRequestId || undefined,
          };
          return [...prev, newMessage];
        }
      });
    });

    socket.on('chatResponse', (response: { id: string; requestId?: string; content: string; timestamp: Date; toolName?: string; toolResult?: any }) => {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📨 chatResponse RECEIVED:', {
        id: response.id,
        requestId: response.requestId,
        selectedAgentId: selectedAgent?.id,
        currentRequestId: currentRequestId,
      });
      
      // Find which agent this response belongs to using requestId from server
      let responseAgentId: string | undefined;
      
      if (response.requestId) {
        // Server sent requestId, use it to find the agent
        responseAgentId = requestIdToAgentIdRef.current.get(response.requestId);
        console.log('📨 Looking up agent by requestId:', response.requestId, '→', responseAgentId);
      } else {
        // Fallback: try to find by responseId or currentRequestId
        responseAgentId = requestIdToAgentIdRef.current.get(response.id) ?? 
          (currentRequestId ? requestIdToAgentIdRef.current.get(currentRequestId) : undefined);
        console.log('📨 Looking up agent by responseId/currentRequestId:', response.id, currentRequestId, '→', responseAgentId);
        
        // If still not found, try to find by matching placeholder's requestId
        if (!responseAgentId && currentRequestId) {
          const matchingPlaceholder = messagesRef.current.find(msg => 
            msg._isPlaceholder && msg._requestId === currentRequestId
          );
          if (matchingPlaceholder && matchingPlaceholder.agent) {
            responseAgentId = matchingPlaceholder.agent.id;
            console.log('📨 Found agent via placeholder:', responseAgentId);
          }
        }
      }
      
      console.log('📨 Determined responseAgentId:', responseAgentId);
      console.log('📨 Is for current agent?', responseAgentId === selectedAgent?.id);
      
      // If this response doesn't belong to the current agent, save it to that agent's history instead
      if (responseAgentId && responseAgentId !== selectedAgent?.id) {
        console.log(`📨 PATH: OTHER AGENT - Response for agent ${responseAgentId} received while viewing agent ${selectedAgent?.id}, saving to history`);
        // Find the prompt message that corresponds to this response using requestId
        const promptMessage = response.requestId 
          ? messagesRef.current.find(msg => msg.type === 'prompt' && msg._requestId === response.requestId)
          : messagesRef.current.find(msg => 
              msg.type === 'prompt' && msg._requestId && requestIdToAgentIdRef.current.get(msg._requestId) === responseAgentId
            );
        
        // Try to find accumulated content from messagesRef (chunks might have been stored even for other agents)
        const requestIdToFind = response.requestId || currentRequestId;
        const accumulatedMessage = messagesRef.current.find(msg => 
          (msg.id === response.id || (msg._isPlaceholder && msg._requestId === requestIdToFind)) &&
          msg.agent?.id === responseAgentId
        );
        const accumulatedContent = accumulatedMessage?.content || response.content || '';
        const finalAnswer = parseFinalAnswer(accumulatedContent);
        
        // Also check if we can find it by looking at all messages for this agent
        if (!promptMessage) {
          // We'll save just the response - the prompt might have been cleared when switching
          const responseMessage: ChatMessage = {
            id: response.id,
            type: 'response',
            content: finalAnswer,
            expanded: false,
            timestamp: new Date(response.timestamp),
            agent: agents.find(a => a.id === responseAgentId) || null,
            isStreaming: false,
          };
          
          // History is now automatically saved by the backend to history files
        } else {
          // Save the complete conversation to that agent's history
          const responseMessage: ChatMessage = {
            id: response.id,
            type: 'response',
            content: finalAnswer,
            expanded: false,
            timestamp: new Date(response.timestamp),
            agent: agents.find(a => a.id === responseAgentId) || null,
            isStreaming: false,
          };
          
          // History is now automatically saved by the backend to history files
        }
        
        // Calculate metrics and send status message to terminal (for other agent)
        // Use setTimeout to allow tokenUsage event to arrive if it hasn't yet
        const requestIdToUse = response.requestId || currentRequestId;
        const responseId = response.id;
        const responseAgentIdForMetrics = responseAgentId;
        const accumulatedContentForMetrics = accumulatedContent;
        
          // Track if we've already scheduled metrics calculation for this responseId to prevent duplicates
          const metricsKey = `metrics_${responseId}`;
          if (metricsCalculatedRef.current.has(metricsKey)) {
            return;
          }
          metricsCalculatedRef.current.add(metricsKey);

          setTimeout(() => {
            // Get response size using responseId (response.id) since chunks are tracked by responseId
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const fullResponseSize = requestResponseSizesRef.current.get(responseId) || 0;
            
            // Separate thinking from answer to calculate sizes separately
            const { thinking: thinkingContent, answer: answerContent } = separateThinkingAndAnswer(accumulatedContentForMetrics);
            const thinkingSize = new TextEncoder().encode(thinkingContent).length;
            const answerSize = new TextEncoder().encode(answerContent).length;
            
            if (requestIdToUse && responseAgentIdForMetrics) {
              const startTime = requestStartTimesRef.current.get(requestIdToUse);
              // Try to get token usage by requestId, also try by responseId as fallback
              let tokenUsage = requestTokenUsage.current.get(requestIdToUse);
              
              if (!tokenUsage && responseId) {
                tokenUsage = requestTokenUsage.current.get(responseId);
              }
              
              // If still not found, try to find any tokenUsage entry (might be the only one)
              if (!tokenUsage && requestTokenUsage.current.size > 0) {
                // Get the most recent entry (last one in the map)
                const entries = Array.from(requestTokenUsage.current.entries());
                if (entries.length > 0) {
                  tokenUsage = entries[entries.length - 1][1];
                }
              }
            
            if (startTime) {
            const endTime = Date.now();
            const totalDuration = endTime - startTime;
            const totalDurationSeconds = (totalDuration / 1000).toFixed(2);
            
            // Calculate latency (time from request to first chunk)
            const firstChunkTime = firstChunkTimesRef.current.get(responseId);
            const latency = firstChunkTime ? firstChunkTime - startTime : 0;
            const latencySeconds = latency > 0 ? (latency / 1000).toFixed(2) : '0.00';
            
            // Calculate answering duration (time from first chunk to last chunk)
            const lastChunkTime = lastChunkTimesRef.current.get(responseId);
            const answeringDuration = (firstChunkTime && lastChunkTime) ? lastChunkTime - firstChunkTime : totalDuration;
            const answeringDurationSeconds = answeringDuration > 0 ? (answeringDuration / 1000).toFixed(2) : '0.00';
            
            // Format response sizes
            const formatSize = (size: number): string => {
              if (size < 1024) {
                return `${size} bytes`;
              } else {
                return `${(size / 1024).toFixed(2)} KB`;
              }
            };
            
            const thinkingSizeFormatted = formatSize(thinkingSize);
            const answerSizeFormatted = formatSize(answerSize);
            
            // Format with colors
            const latencyFormatted = formatDurationWithColor(latencySeconds);
            const answeringFormatted = formatDurationWithColor(answeringDurationSeconds);
            const totalFormatted = formatDurationWithColor(totalDurationSeconds);
            const thinkingSizeColored = formatSizeWithColor(thinkingSize, thinkingSizeFormatted);
            const answerSizeColored = formatSizeWithColor(answerSize, answerSizeFormatted);
            
            // Format timings metadata with colors
            let timingsSection = '';
            if (tokenUsage?.timings) {
              const timings = tokenUsage.timings;
              const cachedTokens = timings.cache_n || 0;
              const promptTokens = timings.prompt_n || 0;
              const promptTimeMs = timings.prompt_ms || 0;
              const promptTimePerToken = timings.prompt_per_token_ms || 0;
              const promptSpeed = timings.prompt_per_second || 0;
              const completionTokens = timings.predicted_n || 0;
              const completionTimeMs = timings.predicted_ms || 0;
              const completionTimePerToken = timings.predicted_per_token_ms || 0;
              const completionSpeed = timings.predicted_per_second || 0;
              
              const promptSpeedFormatted = formatTokensPerSecondWithColor(promptSpeed);
              const completionSpeedFormatted = formatTokensPerSecondWithColor(completionSpeed);
              
              timingsSection = `   Model Performance:\n` +
                `      Prompt Tokens: ${promptTokens.toLocaleString()}\n` +
                `      Cached Tokens: ${cachedTokens.toLocaleString()}\n` +
                `      Prompt Processing: ${promptTimeMs.toFixed(2)}ms (${promptTimePerToken.toFixed(2)}ms/token, ${promptSpeedFormatted})\n` +
                `      Completion Tokens: ${completionTokens.toLocaleString()}\n` +
                `      Completion Time: ${completionTimeMs.toFixed(2)}ms (${completionTimePerToken.toFixed(2)}ms/token, ${completionSpeedFormatted})\n`;
            }
            
            // Calculate confidence score
            const confidenceScore = calculateConfidenceScore(finalAnswer, tokenUsage);
            
            // Parse tool calls from the accumulated content
            const toolCalls = parseToolCalls(accumulatedContentForMetrics);
            
            // Build tool calls section - summarize by counting and grouping
            let toolCallsSection = '';
            if (toolCalls.length > 0) {
              // Count tool calls by name
              const toolCallCounts = new Map<string, number>();
              toolCalls.forEach(toolCall => {
                const count = toolCallCounts.get(toolCall.name) || 0;
                toolCallCounts.set(toolCall.name, count + 1);
              });
              
              toolCallsSection = `   Tool Calls: ${toolCalls.length} total\n`;
              toolCallCounts.forEach((count, toolName) => {
                toolCallsSection += `      ${toolName}${count > 1 ? ` (${count}x)` : ''}\n`;
              });
            }
            
            // Send status message to terminal
            const statusMessage = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `Agent Response Status:\n` +
              `   Duration:\n` +
              `      Latency: ${latencyFormatted}\n` +
              `      Answering: ${answeringFormatted}\n` +
              `      Total: ${totalFormatted}\n` +
              `   Response Size:\n` +
              `      Thinking: ${thinkingSizeColored}\n` +
              `      Answer: ${answerSizeColored}\n` +
              `${timingsSection}` +
              `${toolCallsSection}` +
              `   Confidence: ${confidenceScore}%\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            
            socket.emit('agentStatusMessage', { agentId: responseAgentIdForMetrics, text: statusMessage });
            
            // Clean up tracking data
            requestStartTimesRef.current.delete(requestIdToUse);
            requestResponseSizesRef.current.delete(responseId);
            responseIdToRequestIdRef.current.delete(responseId);
            firstChunkTimesRef.current.delete(responseId);
            streamingStartTimesRef.current.delete(responseId);
            lastChunkTimesRef.current.delete(responseId);
          }
        }
        }, 500); // Wait 500ms for tokenUsage to arrive
        
        // Clean up pending request tracking for this response
        if (response.requestId) {
          pendingRequestsRef.current.delete(response.requestId);
          // Clean up the mapping - delete by requestId, not response.id
          requestIdToAgentIdRef.current.delete(response.requestId);
          checkPendingRequestsForCurrentAgent();
        }
        
        console.log('📨 PATH: OTHER AGENT - Returning early, metrics calculated');
        return;
      }
      
      console.log('📨 PATH: CURRENT AGENT - Processing response for current agent');
      
      // Final response - mark as complete (only if it belongs to current agent)
      // Note: Pending request cleanup happens below after processing the response
      setMessages(prev => {
        // Find the message - could be existing or placeholder
        // Use response.requestId if available, otherwise fall back to currentRequestId
        const requestIdToFind = response.requestId || currentRequestId;
        const existing = prev.find(msg => msg.id === response.id);
        const placeholder = prev.find(msg => msg._isPlaceholder && msg._requestId === requestIdToFind);
        const targetMessage = existing || placeholder;
        
        console.log('🔍 Looking for target message:', {
          requestIdToFind,
          foundExisting: !!existing,
          existingContextUsage: existing?.contextUsage,
          foundPlaceholder: !!placeholder,
          placeholderContextUsage: placeholder?.contextUsage,
          targetMessage: targetMessage ? {
            id: targetMessage.id,
            type: targetMessage.type,
            hasContextUsage: !!targetMessage.contextUsage,
            contextUsage: targetMessage.contextUsage
          } : null
        });
        
        if (!targetMessage) {
          // No message found, create one (fallback)
          // But first check if the last message is a tool call - if so, replace it
          const lastMessage = prev[prev.length - 1];
          const finalAnswer = parseFinalAnswer(response.content || '');
          
          if (lastMessage && lastMessage.type === 'toolCall') {
            // Look for placeholder with same requestId to get contextUsage
            const placeholderWithContext = prev.find(m => 
              m._isPlaceholder && m._requestId && 
              (m._requestId === lastMessage._requestId || m._requestId === response.requestId)
            );
            const contextToUse = placeholderWithContext?.contextUsage || lastMessage.contextUsage;
            
            // Replace the tool call message with this response, preserving contextUsage
            const replacedMessage: ChatMessage = {
              ...lastMessage,
              id: response.id,
              type: 'response',
              content: finalAnswer,
              toolName: undefined,
              isStreaming: false,
              _isPlaceholder: false,
              _isToolCallOnly: false,
              // Preserve contextUsage from placeholder or lastMessage
              contextUsage: contextToUse,
            };
            
            return prev
              .map((msg, idx) => idx === prev.length - 1 ? replacedMessage : msg)
              // Remove placeholder after extracting contextUsage
              .filter(msg => !(msg._isPlaceholder && msg._requestId === response.requestId));
          }
          
          // Otherwise create a new message
          const responseMessage: ChatMessage = {
            id: response.id,
            type: 'response',
            content: finalAnswer,
            expanded: false,
            timestamp: new Date(response.timestamp),
            agent: selectedAgent || null,
            isStreaming: false,
          };
          return [...prev, responseMessage];
        }
        
        // Remove placeholders when response completes, but keep the one with our requestId to extract contextUsage
        // We need to filter out other placeholders but preserve contextUsage from our placeholder
        let filteredPrev = prev.filter(msg => !msg._isPlaceholder || msg.id === targetMessage.id || msg._requestId === requestIdToFind);
        
        // Get the accumulated content from the message (it was streamed via chunks)
        // response.content is empty because everything was streamed
        const accumulatedContent = targetMessage.content || '';
        
        // Check if this response is ONLY a tool call
        const toolCallCheck = isOnlyToolCall(accumulatedContent);
        
        // Parse the final answer from the accumulated content
        const finalAnswer = parseFinalAnswer(accumulatedContent);
        
        // Preserve contextUsage from placeholder (which has it) even if targetMessage is the existing message
        // Check both existing and placeholder for contextUsage
        const contextUsageToPreserve = placeholder?.contextUsage || existing?.contextUsage || targetMessage.contextUsage;
        console.log('💾 Context usage sources:', {
          fromPlaceholder: placeholder?.contextUsage,
          fromExisting: existing?.contextUsage,
          fromTarget: targetMessage.contextUsage,
          willPreserve: contextUsageToPreserve
        });
        
        // If this is NOT a tool call, check if we should replace a previous tool call message
        if (!toolCallCheck.isOnly) {
          // Look for the most recent tool call message from this same request
          const toolCallMessageIndex = filteredPrev.findIndex(msg => 
            msg.type === 'toolCall' && msg._requestId === (targetMessage._requestId || requestIdToFind)
          );
          
          // If we found a tool call message from the same request, replace it with this response
          if (toolCallMessageIndex !== -1) {
            // Replace the tool call message with the actual response
            // Remove the target message if it's different from the tool call message
            const messagesWithoutTarget = filteredPrev.filter((msg, idx) => 
              !(msg.id === targetMessage.id && idx !== toolCallMessageIndex)
            );
            
            return messagesWithoutTarget.map((msg, idx) =>
              msg.type === 'toolCall' && msg._requestId === (targetMessage._requestId || requestIdToFind)
                ? {
                    ...msg,
                    id: response.id,
                    type: 'response',
                    content: finalAnswer,
                    toolName: undefined,
                    isStreaming: false,
                    _isPlaceholder: false,
                    _isToolCallOnly: false,
                    // Preserve contextUsage from placeholder, targetMessage, or msg (check all sources)
                    contextUsage: contextUsageToPreserve || targetMessage.contextUsage || msg.contextUsage,
                  }
                : msg
            );
          }
        }
        
        // Update the message with parsed final answer
        const updatedMessages = filteredPrev.map(msg => {
          if (msg.id === targetMessage.id) {
            console.log('💾 Preserving contextUsage in final response:', contextUsageToPreserve);
            const finalMessage: ChatMessage = { 
              ...msg, 
              id: response.id,
              type: (toolCallCheck.isOnly ? 'toolCall' : msg.type) as 'response' | 'toolCall',
              content: finalAnswer,
              toolName: toolCallCheck.toolName,
              isStreaming: false,
              _isPlaceholder: false,
              _isToolCallOnly: toolCallCheck.isOnly,
              // Preserve contextUsage from placeholder or any available source
              contextUsage: contextUsageToPreserve,
            };
            console.log('✨ Final message created:', {
              id: finalMessage.id,
              type: finalMessage.type,
              hasContextUsage: !!finalMessage.contextUsage,
              contextUsage: finalMessage.contextUsage
            });
            return finalMessage;
          }
          return msg;
        })
        // Remove any remaining placeholder messages for this request after we've extracted contextUsage
        .filter(msg => !(msg._isPlaceholder && msg._requestId === requestIdToFind));
        
        // Calculate metrics and send status message to terminal
        // Use a small delay to allow tokenUsage event to arrive if it hasn't yet
        const requestIdToUse = response.requestId || currentRequestId;
        const responseId = response.id;
        const responseAgentIdForMetrics = responseAgentId;
        
        // Track if we've already scheduled metrics calculation for this responseId to prevent duplicates
        const metricsKey = `metrics_${responseId}`;
        if (metricsCalculatedRef.current.has(metricsKey)) {
          return updatedMessages;
        }
        metricsCalculatedRef.current.add(metricsKey);
        
        setTimeout(() => {
          // Get response size using responseId (response.id) since chunks are tracked by responseId
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const fullResponseSize = requestResponseSizesRef.current.get(responseId) || 0;
          
          // Separate thinking from answer to calculate sizes separately
          const { thinking: thinkingContent, answer: answerContent } = separateThinkingAndAnswer(accumulatedContent);
          const thinkingSize = new TextEncoder().encode(thinkingContent).length;
          const answerSize = new TextEncoder().encode(answerContent).length;
          
          if (requestIdToUse && responseAgentIdForMetrics) {
            const startTime = requestStartTimesRef.current.get(requestIdToUse);
            // Try to get token usage by requestId, also try by responseId as fallback
            let tokenUsage = requestTokenUsage.current.get(requestIdToUse);
            
            if (!tokenUsage && responseId) {
              tokenUsage = requestTokenUsage.current.get(responseId);
            }
            
            // If still not found, try to find any tokenUsage entry (might be the only one)
            if (!tokenUsage && requestTokenUsage.current.size > 0) {
              // Get the most recent entry (last one in the map)
              const entries = Array.from(requestTokenUsage.current.entries());
              if (entries.length > 0) {
                tokenUsage = entries[entries.length - 1][1];
              }
            }
            
            if (startTime) {
              const endTime = Date.now();
              const totalDuration = endTime - startTime;
              const totalDurationSeconds = (totalDuration / 1000).toFixed(2);
              
              // Calculate latency (time from request to first chunk)
              const firstChunkTime = firstChunkTimesRef.current.get(responseId);
              const latency = firstChunkTime ? firstChunkTime - startTime : 0;
              const latencySeconds = latency > 0 ? (latency / 1000).toFixed(2) : '0.00';
              
              // Calculate answering duration (time from first chunk to last chunk)
              const lastChunkTime = lastChunkTimesRef.current.get(responseId);
              const answeringDuration = (firstChunkTime && lastChunkTime) ? lastChunkTime - firstChunkTime : totalDuration;
              const answeringDurationSeconds = answeringDuration > 0 ? (answeringDuration / 1000).toFixed(2) : '0.00';
              
              // Format response sizes
              const formatSize = (size: number): string => {
                if (size < 1024) {
                  return `${size} bytes`;
                } else {
                  return `${(size / 1024).toFixed(2)} KB`;
                }
              };
              
              const thinkingSizeFormatted = formatSize(thinkingSize);
              const answerSizeFormatted = formatSize(answerSize);
              
              // Format with colors
              const latencyFormatted = formatDurationWithColor(latencySeconds);
              const answeringFormatted = formatDurationWithColor(answeringDurationSeconds);
              const totalFormatted = formatDurationWithColor(totalDurationSeconds);
              const thinkingSizeColored = formatSizeWithColor(thinkingSize, thinkingSizeFormatted);
              const answerSizeColored = formatSizeWithColor(answerSize, answerSizeFormatted);
              
              // Format timings metadata with colors
              let timingsSection = '';
              if (tokenUsage?.timings) {
                const timings = tokenUsage.timings;
                const cachedTokens = timings.cache_n || 0;
                const promptTokens = timings.prompt_n || 0;
                const promptTimeMs = timings.prompt_ms || 0;
                const promptTimePerToken = timings.prompt_per_token_ms || 0;
                const promptSpeed = timings.prompt_per_second || 0;
                const completionTokens = timings.predicted_n || 0;
                const completionTimeMs = timings.predicted_ms || 0;
                const completionTimePerToken = timings.predicted_per_token_ms || 0;
                const completionSpeed = timings.predicted_per_second || 0;
                
                const promptSpeedFormatted = formatTokensPerSecondWithColor(promptSpeed);
                const completionSpeedFormatted = formatTokensPerSecondWithColor(completionSpeed);
                
                timingsSection = `   Model Performance:\n` +
                  `      Prompt Tokens: ${promptTokens.toLocaleString()}\n` +
                  `      Cached Tokens: ${cachedTokens.toLocaleString()}\n` +
                  `      Prompt Processing: ${promptTimeMs.toFixed(2)}ms (${promptTimePerToken.toFixed(2)}ms/token, ${promptSpeedFormatted})\n` +
                  `      Completion Tokens: ${completionTokens.toLocaleString()}\n` +
                  `      Completion Time: ${completionTimeMs.toFixed(2)}ms (${completionTimePerToken.toFixed(2)}ms/token, ${completionSpeedFormatted})\n`;
              }
              
              // Calculate confidence score
              const confidenceScore = calculateConfidenceScore(finalAnswer, tokenUsage);
              
              // Parse tool calls from the accumulated content
              const toolCalls = parseToolCalls(accumulatedContent);
              
              // Build tool calls section - summarize by counting and grouping
              let toolCallsSection = '';
              if (toolCalls.length > 0) {
                // Count tool calls by name
                const toolCallCounts = new Map<string, number>();
                toolCalls.forEach(toolCall => {
                  const count = toolCallCounts.get(toolCall.name) || 0;
                  toolCallCounts.set(toolCall.name, count + 1);
                });
                
                toolCallsSection = `   Tool Calls: ${toolCalls.length} total\n`;
                toolCallCounts.forEach((count, toolName) => {
                  toolCallsSection += `      ${toolName}${count > 1 ? ` (${count}x)` : ''}\n`;
                });
              }
              
              // Send status message to terminal
              const statusMessage = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Agent Response Status:\n` +
                `   Duration:\n` +
                `      Latency: ${latencyFormatted}\n` +
                `      Answering: ${answeringFormatted}\n` +
                `      Total: ${totalFormatted}\n` +
                `   Response Size:\n` +
                `      Thinking: ${thinkingSizeColored}\n` +
                `      Answer: ${answerSizeColored}\n` +
                `${timingsSection}` +
                `${toolCallsSection}` +
                `   Confidence: ${confidenceScore}%\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
              
              socket.emit('agentStatusMessage', { agentId: responseAgentIdForMetrics, text: statusMessage });
              
              // Clean up tracking data
              requestStartTimesRef.current.delete(requestIdToUse);
              requestResponseSizesRef.current.delete(responseId);
              responseIdToRequestIdRef.current.delete(responseId);
              firstChunkTimesRef.current.delete(responseId);
              streamingStartTimesRef.current.delete(responseId);
              lastChunkTimesRef.current.delete(responseId);
            }
          }
        }, 500); // Wait 500ms for tokenUsage to arrive
        
        // If there's a tool result, create a separate tool result message
        // Note: updatedMessages was already created above
        if (response.toolName && response.toolResult !== undefined) {
          const toolResultMessage: ChatMessage = {
            id: `${response.id}-tool-result`,
            type: 'toolResult',
            content: '',
            expanded: false,
            timestamp: new Date(response.timestamp),
            agent: selectedAgent || null,
            toolName: response.toolName,
            toolResult: response.toolResult,
          };
          return [...updatedMessages, toolResultMessage];
        }
        
        return updatedMessages;
      });
      
      setIsWaitingForResponse(false);
      
      // Clean up pending request tracking - prioritize response.requestId from server
      if (response.requestId) {
        pendingRequestsRef.current.delete(response.requestId);
      }
      // Fallback: also clean up currentRequestId if it exists and is different
      if (currentRequestId && currentRequestId !== response.requestId) {
        pendingRequestsRef.current.delete(currentRequestId);
      }
      
      checkPendingRequestsForCurrentAgent();
      setCurrentRequestId(null);
      // Clean up the mapping - delete by requestId, not response.id
      if (response.requestId) {
        requestIdToAgentIdRef.current.delete(response.requestId);
      }
      // Fallback: also clean up currentRequestId if it exists and is different
      if (currentRequestId && currentRequestId !== response.requestId) {
        requestIdToAgentIdRef.current.delete(currentRequestId);
      }
    });

    socket.on('chatInfo', (info: string) => {
      console.log('Chat info:', info);
    });

    socket.on('chatError', (error: string) => {
      console.error('Chat error:', error);
      setIsWaitingForResponse(false);
      
      // Display error message to user in chat
      setMessages(prev => {
        // Remove any "Thinking..." placeholder for this request
        const withoutPlaceholder = prev.filter(msg => 
          !(msg._isPlaceholder && msg._requestId === currentRequestId)
        );
        
        // Add error message
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          type: 'response',
          content: `**Error**\n\n${error}`,
          expanded: false,
          timestamp: new Date(),
          agent: selectedAgent || null,
          isStreaming: false,
        };
        
        return [...withoutPlaceholder, errorMessage];
      });
      
      // Clean up pending request tracking
      if (currentRequestId) {
        pendingRequestsRef.current.delete(currentRequestId);
        // Clean up the mapping
        requestIdToAgentIdRef.current.delete(currentRequestId);
        // Clean up tracking data
        requestStartTimesRef.current.delete(currentRequestId);
        requestResponseSizesRef.current.delete(currentRequestId);
      }
      
      checkPendingRequestsForCurrentAgent();
      setCurrentRequestId(null);
    });

    socket.on('chatAborted', () => {
      setIsWaitingForResponse(false);
      
      // Clean up pending request tracking
      if (currentRequestId) {
        pendingRequestsRef.current.delete(currentRequestId);
        // Clean up the mapping
        requestIdToAgentIdRef.current.delete(currentRequestId);
        // Clean up tracking data
        requestStartTimesRef.current.delete(currentRequestId);
        requestResponseSizesRef.current.delete(currentRequestId);
      }
      
      checkPendingRequestsForCurrentAgent();
      setCurrentRequestId(null);
      const abortMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'response',
        content: '(Request aborted)',
        expanded: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, abortMessage]);
    });

    socket.on('chatHistory', (history: ChatSession[]) => {
      // Only set history if we don't have an agent selected (shouldn't happen now, but keeping for safety)
      if (!selectedAgent) {
        setChatHistory(history);
      }
    });

    socket.on('agentChatMessages', (messages: ChatMessage[]) => {
      console.log('agentChatMessages received:', messages.length, 'messages, isSwitchingAgentRef:', isSwitchingAgentRef.current);
      
      // If we just switched agents or have no messages, load the history
      if (isSwitchingAgentRef.current || messagesRef.current.length === 0) {
        if (messages.length > 0) {
          console.log('Loading agent chat history:', messages.length, 'messages');
          setMessages(messages);
        } else {
          console.log('No history available for this agent');
          setMessages([]);
        }
        // Reset the switching flag
        isSwitchingAgentRef.current = false;
      } else {
        console.log('Messages exist and not switching, keeping current messages');
      }
    });

    socket.on('chatSessionSaved', (sessionId: string) => {
      console.log('Chat session saved:', sessionId);
    });

    socket.on('agentChatSessionSaved', (sessionId: string) => {
      console.log('Agent chat session saved:', sessionId);
    });

    socket.on('tokenUsage', (data: { requestId?: string; promptTokens: number; completionTokens?: number; totalTokens?: number; maxContext: number; usagePercent: number; timings?: any }) => {
      // Store token usage per request ID - prioritize the requestId from the event
      const requestId = data.requestId || currentRequestId;
      if (requestId) {
        requestTokenUsage.current.set(requestId, {
          promptTokens: data.promptTokens,
          completionTokens: data.completionTokens || 0,
          totalTokens: data.totalTokens || data.promptTokens,
          maxContext: data.maxContext,
          usagePercent: data.usagePercent,
          timings: data.timings,
        });
        
        // Update the current context usage display (only if changed to avoid loops)
        setCurrentContextUsage(prev => {
          // Only update if values have actually changed
          if (!prev || 
              prev.promptTokens !== data.promptTokens || 
              prev.maxContext !== data.maxContext || 
              prev.usagePercent !== data.usagePercent) {
            return {
              promptTokens: data.promptTokens,
              maxContext: data.maxContext,
              usagePercent: data.usagePercent,
            };
          }
          return prev;
        });
        
        // Update the message with context usage information
        setMessages(prev => {
          return prev.map(msg => {
            // Match by requestId and include all response-like types
            if (msg._requestId === requestId && (msg.type === 'response' || msg.type === 'toolCall' || msg._isPlaceholder)) {
              return {
                ...msg,
                contextUsage: {
                  promptTokens: data.promptTokens,
                  maxContext: data.maxContext,
                  usagePercent: data.usagePercent,
                }
              };
            }
            return msg;
          });
        });
      }
    });

    // Handle firstChunkTime event from backend (for latency tracking)
    socket.on('firstChunkTime', ({ requestId, responseId, timestamp }: { requestId: string; responseId: string; timestamp: number }) => {
      // Store first chunk time using responseId (as that's what chunks use)
      if (responseId) {
        firstChunkTimesRef.current.set(responseId, timestamp);
      }
      // Also map responseId to requestId if not already mapped
      if (responseId && requestId && responseId !== requestId) {
        responseIdToRequestIdRef.current.set(responseId, requestId);
      }
    });

    // Handle agent history cleared events
    socket.on('agentHistoryCleared', (data: { agentId: string }) => {
      // Clear messages if the cleared agent is currently selected
      if (selectedAgent && selectedAgent.id === data.agentId) {
        setMessages([]);
        // Reload sessions list to update UI
        socket.emit('getAgentSessions', { agentId: data.agentId });
      }
    });

    socket.on('allAgentsHistoryCleared', () => {
      // Always clear messages when all history is cleared
      setMessages([]);
      // Reload sessions list if we have a selected agent
      if (selectedAgent) {
        socket.emit('getAgentSessions', { agentId: selectedAgent.id });
      }
    });

    // Session management listeners
    socket.on('agentSessions', ({ agentId, sessions, currentSessionId }: { agentId: string; sessions: any[]; currentSessionId: string | null }) => {
      console.log('agentSessions received for agent:', agentId, 'sessions:', sessions.length, 'current:', currentSessionId);
      if (selectedAgent && agentId === selectedAgent.id) {
        setAvailableSessions(sessions);
        setSelectedSessionId(currentSessionId);
        
        // If we have sessions and a current session, load its history
        if (currentSessionId && sessions.length > 0) {
          socket.emit('loadSessionHistory', { agentId, sessionId: currentSessionId });
        } else if (sessions.length === 0) {
          // No sessions available - clear messages
          setMessages([]);
        }
        
        // Generate summaries for sessions that don't have one yet
        sessions.forEach(session => {
          if (!sessionSummaries.has(session.id) && session.messageCount > 0) {
            // Request summary generation
            socket.emit('generateSessionSummary', { agentId, sessionId: session.id });
          }
        });
      }
    });

    socket.on('sessionHistory', ({ agentId, sessionId, messages: sessionMessages }: { agentId: string; sessionId: string; messages: ChatMessage[] }) => {
      console.log('sessionHistory received for session:', sessionId, 'messages:', sessionMessages.length);
      // Update messages if it's for the current agent (don't check selectedSessionId due to state timing)
      if (selectedAgent && agentId === selectedAgent.id) {
        console.log('Loading session history into messages:', sessionMessages.length);
        setMessages(sessionMessages);
        setSelectedSessionId(sessionId); // Ensure selectedSessionId is in sync
      }
    });

    socket.on('currentSessionSet', ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
      console.log('currentSessionSet:', sessionId);
      if (selectedAgent && agentId === selectedAgent.id) {
        setSelectedSessionId(sessionId);
        // Load the session history
        socket.emit('loadSessionHistory', { agentId, sessionId });
      }
    });

    socket.on('newSessionCreated', ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
      console.log('newSessionCreated:', sessionId);
      if (selectedAgent && agentId === selectedAgent.id) {
        // Reload sessions list
        socket.emit('getAgentSessions', { agentId });
        // Set as current and clear messages
        setSelectedSessionId(sessionId);
        setMessages([]);
        setCurrentContextUsage(null);
      }
    });

    socket.on('sessionSummary', ({ sessionId, summary }: { sessionId: string; summary: string }) => {
      console.log('sessionSummary received for session:', sessionId);
      setSessionSummaries(prev => new Map(prev).set(sessionId, summary));
    });

    socket.on('allAgentSessionsCleared', ({ agentId }: { agentId: string }) => {
      console.log('allAgentSessionsCleared for agent:', agentId);
      if (selectedAgent && agentId === selectedAgent.id) {
        // Reload sessions
        socket.emit('getAgentSessions', { agentId });
      }
    });

    return () => {
      socket.off('userSettings');
      socket.off('chatModels');
      socket.off('ragIndexingStatus');
      socket.off('chatResponseChunk');
      socket.off('chatResponse');
      socket.off('chatStatusUpdate');
      socket.off('chatInfo');
      socket.off('chatError');
      socket.off('chatAborted');
      socket.off('chatHistory');
      socket.off('agentChatHistory');
      socket.off('chatSessionSaved');
      socket.off('agentChatSessionSaved');
      socket.off('tokenUsage');
      socket.off('firstChunkTime');
      socket.off('agentHistoryCleared');
      socket.off('allAgentsHistoryCleared');
      socket.off('agentSessions');
      socket.off('sessionHistory');
      socket.off('currentSessionSet');
      socket.off('newSessionCreated');
      socket.off('sessionSummary');
      socket.off('allAgentSessionsCleared');
      // Clean up focus timeout on unmount
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentContextKey, selectedAgent?.id ?? null]);

  // Auto-scroll to bottom when new messages arrive (but not when just expanding/collapsing thinking sections)
  useEffect(() => {
    // Only scroll if the number of messages increased (new message added)
    if (messages.length > previousMessagesLengthRef.current) {
      // Use requestAnimationFrame to avoid interfering with focus
      requestAnimationFrame(() => {
        // Scroll to bottom, but use a non-blocking approach to avoid focus issues
        if (messagesEndRef.current) {
          // Check if input is focused - if so, scroll more carefully
          const isInputFocused = inputTextareaRef.current && document.activeElement === inputTextareaRef.current;
          if (isInputFocused) {
            // If input is focused, scroll without smooth behavior to avoid focus issues
            messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
          } else {
            // Normal smooth scroll when input is not focused
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    }
    previousMessagesLengthRef.current = messages.length;
  }, [messages]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleToggleExpand = () => {
    const newExpandedState = !isExpanded;
    setIsExpanded(newExpandedState);
    saveChatPanelExpanded(newExpandedState);
  };

  const handleClearAll = () => {
    // Clear all agent tabs
    if (onClearAgentTabs) {
      onClearAgentTabs();
    }
    
    // Clear all agent chat histories on server
    agents.forEach(agent => {
      socket.emit('clearAgentChatHistory', { 
        projectPath: getProjectPathFromContext(selectedContext), 
        agentId: agent.id 
      });
    });
    
    // Clear current chat messages
    setMessages([]);
    setPromptText('');
    setCurrentSessionId(null);
    setCurrentContextUsage(null);
    setSelectedImage(null);
    
    // Clear chat history from state
    setChatHistory([]);
  };

  // Handle image selection
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Please select a valid image file (JPEG, PNG, GIF, or WebP)');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      alert('Image file size must be less than 5MB');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64Data = base64String.split(',')[1];
      
      setSelectedImage({
        data: base64Data,
        mediaType: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  // Remove selected image
  const handleRemoveImage = () => {
    setSelectedImage(null);
  };

  const handleSend = () => {
    if ((!promptText.trim() && !selectedImage) || !selectedAgent || hasPendingRequests) return;
    
    // Add prompt to messages
    const messageContent = selectedImage 
      ? (promptText.trim() ? `[Image]\n${promptText}` : '[Image attached]')
      : promptText;
    
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'prompt',
      content: messageContent,
      expanded: false,
      timestamp: new Date(),
      _requestId: undefined, // Will be set below
    };
    
    const requestId = Date.now().toString();
    newMessage._requestId = requestId;
    
    // Store mapping of requestId to agentId
    requestIdToAgentIdRef.current.set(requestId, selectedAgent.id);
    
    const placeholderResponseId = `placeholder-${requestId}`;
    
    // Create placeholder response message immediately to show "Thinking..."
    const placeholderResponse: ChatMessage = {
      id: placeholderResponseId,
      type: 'response',
      content: '',
      expanded: false,
      timestamp: new Date(),
      agent: selectedAgent || null,
      isStreaming: true,
      _requestId: requestId,
      _isPlaceholder: true, // Flag to identify placeholder messages
    };
    
    setMessages(prev => [...prev, newMessage, placeholderResponse]);
    setPromptText('');
    setIsWaitingForResponse(true);
    setCurrentRequestId(requestId);
    
    // Track this request as pending
    pendingRequestsRef.current.add(requestId);
    checkPendingRequestsForCurrentAgent();
    
    // Track request start time for duration calculation
    requestStartTimesRef.current.set(requestId, Date.now());
    requestResponseSizesRef.current.set(requestId, 0); // Initialize response size tracking
    
    // Notify that agent chat has started (for terminal tab creation)
    if (selectedAgent && onAgentChatStart) {
      onAgentChatStart(selectedAgent.id, selectedAgent.name);
    }
    
    // Log image data for debugging
    if (selectedImage) {
      console.log('[IMAGE] Sending image with request:', {
        mediaType: selectedImage.mediaType,
        dataLength: selectedImage.data.length,
        fileName: selectedImage.name
      });
    }
    
    // Send to AI via socket
    // Note: We only send the current message now. The backend will reconstruct
    // the conversation history from the agent's history file to keep everything in sync.
    socket.emit('sendChatPrompt', {
      requestId,
      prompt: newMessage.content,
      // conversationHistory removed - backend now loads history from file
      model: selectedAgent.model,
      thinkingTokens,
      projectPath: getProjectPathFromContext(selectedContext),
      containerId: selectedContext?.type === 'container' ? selectedContext.id : null,
      agentId: selectedAgent?.id,
      requestedTools: selectedTools, // Tools selected by user for this conversation
      agentName: selectedAgent.name || null,
      agentNickname: selectedAgent.nickname || null,
      agentJobTitle: selectedAgent.jobTitle || null,
      userName: userSettings.allowUseGitName ? userProfile?.name : null,
      userEmail: userSettings.allowUseGitEmail ? userProfile?.email : null,
      userNickname: userSettings.nickname || null,
      userLanguage: userSettings.language || null,
      userAge: userSettings.age || null,
      userGender: userSettings.gender || null,
      userOrientation: userSettings.orientation || null,
      userJobTitle: userSettings.jobTitle || null,
      userEmployer: userSettings.employer || null,
      userEducationLevel: userSettings.educationLevel || null,
      userPoliticalIdeology: userSettings.politicalIdeology || null,
      userReligion: userSettings.religion || null,
      userInterests: userSettings.interests || null,
      userCountry: userSettings.country || null,
      userState: userSettings.state || null,
      userZipcode: userSettings.zipcode || null,
      image: selectedImage ? {
        data: selectedImage.data,
        mediaType: selectedImage.mediaType
      } : null,
    });
    
    // Clear the selected image after sending
    setSelectedImage(null);
  };

  const handleAbort = (requestId: string) => {
    console.log('Aborting request:', requestId);
    socket.emit('abortChatPrompt', { requestId });
    
    // Clean up pending request tracking
    pendingRequestsRef.current.delete(requestId);
    // Clean up the mapping
    requestIdToAgentIdRef.current.delete(requestId);
    checkPendingRequestsForCurrentAgent();
    
    // Remove placeholder message
    setMessages(prev => prev.filter(msg => !(msg._isPlaceholder && msg._requestId === requestId)));
    
    // If this was the current request, update state
    if (currentRequestId === requestId) {
      setIsWaitingForResponse(false);
      setCurrentRequestId(null);
    }
  };

  // Get available tools (globally enabled MCP servers)
  const getAvailableTools = (): string[] => {
    return globallyEnabledTools;
  };

  // Toggle a specific tool
  const toggleTool = (tool: string) => {
    setSelectedTools(prev => 
      prev.includes(tool) 
        ? prev.filter(t => t !== tool)
        : [...prev, tool]
    );
  };

  // Toggle all tools on/off
  const toggleAllTools = () => {
    const availableTools = getAvailableTools();
    if (selectedTools.length === availableTools.length) {
      // All selected, deselect all
      setSelectedTools([]);
    } else {
      // Not all selected, select all
      setSelectedTools(availableTools);
    }
  };

  const handleThinkingClick = (agentId: string | undefined, agentName: string | undefined) => {
    if (agentId && agentName && onAgentChatStart) {
      // Create/focus the agent tab
      onAgentChatStart(agentId, agentName);
      // Open terminal panel
      if (onOpenTerminal) {
        onOpenTerminal();
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div 
      ref={panelRef}
      className={`chat-panel ${isOpen ? 'open' : ''} ${isExpanded ? 'expanded' : ''}`}
      style={{ 
        width: isOpen ? (isExpanded ? '100%' : `${width}px`) : '0',
        height: '100%',
        ...(isExpanded && {
          bottom: `${terminalHeight + 40}px`, // Terminal height + terminal header height
        })
      }}
    >
      <div 
        className="resize-handle"
        onMouseDown={handleMouseDown}
      />
      <div className="chat-panel-content">
        {/* Chat Header */}
        <div className="chat-header">
          <div className="flex items-center space-x-3 flex-1">
            {selectedAgent ? (
              <div className="flex items-center space-x-2 flex-1">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {selectedAgent.avatar ? (
                    <img src={selectedAgent.avatar} alt={selectedAgent.name} className="w-full h-full object-cover" />
                  ) : (
                    <CpuChipIcon className="w-6 h-6 text-gray-400" />
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-200">{selectedAgent.name}</span>
                  {selectedAgent.jobTitle && (
                    <span className="text-xs text-gray-400">{selectedAgent.jobTitle}</span>
                  )}
                </div>
                
                {/* Session selector */}
                <div className="flex items-center space-x-2 ml-4">
                  <select
                    value={selectedSessionId || ''}
                    onChange={(e) => {
                      const newSessionId = e.target.value;
                      if (newSessionId && selectedAgent) {
                        socket.emit('setCurrentSession', { agentId: selectedAgent.id, sessionId: newSessionId });
                      }
                    }}
                    disabled={availableSessions.length === 0}
                    className={`bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500 ${
                      availableSessions.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    style={{ minWidth: '150px', maxWidth: '200px' }}
                  >
                    {availableSessions.length === 0 ? (
                      <option value="">No sessions yet</option>
                    ) : (
                      availableSessions.map(session => {
                        const summary = sessionSummaries.get(session.id);
                        const label = summary || `Session (${session.messageCount} messages)`;
                        const truncatedLabel = label.length > 30 ? label.substring(0, 27) + '...' : label;
                        return (
                          <option key={session.id} value={session.id}>
                            {truncatedLabel}
                          </option>
                        );
                      })
                    )}
                  </select>
                  
                  <button
                    onClick={() => {
                      if (selectedAgent) {
                        socket.emit('createNewSession', { agentId: selectedAgent.id });
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs rounded px-2 py-1 flex items-center space-x-1"
                    title="New Session"
                  >
                    <span>+</span>
                    <span>New</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">
                No agent selected. Select an agent from the toolbar to start chatting.
              </div>
            )}
          </div>
          <div className="header-buttons">
            <button 
              className="expand-button" 
              onClick={handleToggleExpand} 
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? "⇱" : "⤢"}
            </button>
            <button className="close-button" onClick={onClose} title="Close">×</button>
          </div>
        </div>

        {/* Chat Response Area */}
        <div className="chat-messages">
              {messages.length === 0 ? (
                <p className="empty-state">Start a conversation with {selectedAgent?.nickname || selectedAgent?.name || 'your AI assistant'}...</p>
              ) : (
                messages
                  .filter(msg => !msg.content.includes('Starting MCP gateway'))
                  .map(msg => (
                    <div key={msg.id} className={`message ${msg.type}`}>
                      {(msg.type === 'response' || msg.type === 'toolResult' || msg.type === 'toolCall') && msg.agent && (
                        <div className="message-agent-header">
                          <div className="message-agent-header-left">
                            <div className="message-agent-avatar">
                              {msg.agent.avatar ? (
                                <img src={msg.agent.avatar} alt={msg.agent.name} />
                              ) : (
                                <CpuChipIcon className="w-full h-full text-gray-400" />
                              )}
                            </div>
                            <div className="message-agent-name">
                              {msg.agent.name}
                              {msg.agent.jobTitle && (
                                <span className="message-agent-title"> • {msg.agent.jobTitle}</span>
                              )}
                              {msg.type === 'toolResult' && msg.toolName && (
                                <span className="message-tool-name"> • {msg.toolName}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {msg.type === 'prompt' && userProfile && userProfile.name && (
                        <div className="message-user-header">
                          <div className="message-user-info">
                            <div className="message-user-name">
                              {userProfile.name}
                            </div>
                            {userProfile.email && (
                              <div className="message-user-email">
                                {userProfile.email}
                              </div>
                            )}
                          </div>
                          <div className="message-user-avatar">
                            {userProfile.avatar ? (
                              <img src={userProfile.avatar} alt={userProfile.name} />
                            ) : (
                              <UserIcon className="w-full h-full text-gray-400" />
                            )}
                          </div>
                        </div>
                      )}
                      <div className="message-content">
                        {msg.type === 'toolCall' ? (
                          // Tool call message - show "Calling tool: <tool-name>..."
                          <div className="thinking-indicator-container">
                            <div 
                              className="thinking-indicator"
                              style={{ cursor: 'default' }}
                            >
                              Calling tool: {msg.toolName}...
                            </div>
                          </div>
                        ) : msg.type === 'toolResult' ? (
                          // Tool result message - display JSON data
                          <div className="tool-result-section">
                            <JSONExplorer data={msg.toolResult} />
                          </div>
                        ) : msg.isStreaming && !msg.content ? (
                          // Show "Thinking..." when streaming and no content yet
                          <div className="thinking-indicator clickable"
                            onClick={() => handleThinkingClick(msg.agent?.id, msg.agent?.name)}
                            style={{ cursor: msg.agent ? 'pointer' : 'default' }}
                          >
                            Thinking...
                            {msg.agent && (
                              <span className="thinking-hint"> (Click to view in terminal)</span>
                            )}
                          </div>
                        ) : (
                          // Regular message (prompt or response)
                          <MessageRenderer content={replaceToolCallsInContent(msg.content)} isStreaming={msg.isStreaming || false} />
                        )}
                      </div>
                    </div>
                  ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Prompt Section */}
            <div className="chat-prompt-section">
              {/* Context Size Control */}
              {selectedAgent && (
                <div className="context-size-control">
                  <label>
                    <span className="context-label">Thinking Tokens</span>
                    <span className="context-usage">
                      {currentContextUsage 
                        ? `used ${currentContextUsage.promptTokens.toLocaleString()} of ${thinkingTokens.toLocaleString()} available`
                        : `${thinkingTokens.toLocaleString()} available`
                      }
                    </span>
                  </label>
                  <div className="context-slider-row">
                    <input
                      type="range"
                      min="1024"
                      max="131072"
                      step="1024"
                      value={thinkingTokens}
                      onChange={(e) => setThinkingTokens(parseInt(e.target.value, 10))}
                      className="context-slider"
                    />
                    <div className="context-usage-display">
                      <CircleProgress percentage={currentContextUsage?.usagePercent ?? 0} size={32} />
                      <span className="context-usage-text">
                        {currentContextUsage ? Math.round(currentContextUsage.usagePercent) : 0}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {/* Prompt Input */}
              <div className="prompt-input">
                <textarea 
                  ref={inputTextareaRef}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  rows={3}
                />
                <div className="prompt-buttons">
                  {ragIndexingStatus && (
                    <div className="rag-indexing-status">
                      {ragIndexingStatus}
                    </div>
                  )}
                  <button 
                    onClick={handleClearAll}
                    title="Clear all chat history and agent terminals"
                    className="clear-button"
                  >
                    Clear History
                  </button>
                  {/* Tools Dropdown - only show if agent has tools */}
                  {getAvailableTools().length > 0 && (
                    <div className="tools-dropdown-container" ref={toolsDropdownRef}>
                      <button
                        className="tools-dropdown-btn"
                        onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                        title="Select tools for this conversation"
                      >
                        <WrenchScrewdriverIcon className="w-4 h-4 inline mr-1" />
                        Tools ({selectedTools.length}/{getAvailableTools().length})
                      </button>
                      {showToolsDropdown && (
                        <div className="tools-dropdown-menu">
                          <div className="tools-dropdown-header">
                            <label className="tools-toggle-all">
                              <input
                                type="checkbox"
                                checked={selectedTools.length === getAvailableTools().length}
                                onChange={toggleAllTools}
                              />
                              <span>All Tools</span>
                            </label>
                          </div>
                          <div className="tools-list">
                            {getAvailableTools().map(tool => (
                              <label key={tool} className="tool-item">
                                <input
                                  type="checkbox"
                                  checked={selectedTools.includes(tool)}
                                  onChange={() => toggleTool(tool)}
                                />
                                <span>{tool}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Image Upload Button */}
                  {selectedImage ? (
                    <div className="image-preview-container">
                      <span className="image-preview-name" title={selectedImage.name}>
                        <PhotoIcon className="w-4 h-4 inline-block mr-1" /> Image
                      </span>
                      <div
                        className="remove-image-btn clickable"
                        onClick={handleRemoveImage}
                        title="Remove image"
                      >
                        ✕
                      </div>
                    </div>
                  ) : (
                    <label className="image-upload-btn" title="Upload image">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        onChange={handleImageSelect}
                        style={{ display: 'none' }}
                      />
                      <PhotoIcon className="w-4 h-4 inline-block mr-1" /> Image
                    </label>
                  )}
                  <button 
                    className={hasPendingRequests ? "abort-btn" : "send-btn"}
                    onClick={() => {
                      if (hasPendingRequests && currentRequestId) {
                        handleAbort(currentRequestId);
                      } else {
                        handleSend();
                      }
                    }}
                    disabled={!hasPendingRequests && !promptText.trim() && !selectedImage}
                    title={hasPendingRequests ? 'Abort current request' : 'Send message'}
                  >
                    {hasPendingRequests ? 'Abort' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
      </div>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';

export default React.memo(ChatPanel, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Compare arrays by length and first element ID
  const agentsChanged = prevProps.agents?.length !== nextProps.agents?.length ||
    prevProps.agents?.[0]?.id !== nextProps.agents?.[0]?.id;
  
  const propsChanged = 
    prevProps.isOpen !== nextProps.isOpen ||
    prevProps.selectedAgent?.id !== nextProps.selectedAgent?.id ||
    prevProps.terminalHeight !== nextProps.terminalHeight ||
    prevProps.selectedContext !== nextProps.selectedContext ||
    prevProps.userProfile?.email !== nextProps.userProfile?.email ||
    agentsChanged;
  
  if (propsChanged) {
    console.log('ChatPanel props changed:', {
      isOpen: prevProps.isOpen !== nextProps.isOpen,
      selectedAgent: prevProps.selectedAgent?.id !== nextProps.selectedAgent?.id,
      terminalHeight: prevProps.terminalHeight !== nextProps.terminalHeight,
      selectedContext: prevProps.selectedContext !== nextProps.selectedContext,
      userProfile: prevProps.userProfile?.email !== nextProps.userProfile?.email,
      agents: agentsChanged,
    });
  }
  
  // Return true to skip re-render, false to allow re-render
  return !propsChanged;
});

