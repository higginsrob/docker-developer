import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import io from 'socket.io-client';
import './ChatPanel.css';
import { Agent } from './Agents';
import MessageRenderer from './MessageRenderer';
import JSONExplorer from './JSONExplorer';

const socket = io('http://localhost:3002');
const CHAT_PANEL_WIDTH_KEY = 'chatPanelWidth';
const USER_SETTINGS_KEY = 'userSettings';

interface UserSettings {
  allowUseGitName: boolean;
  allowUseGitEmail: boolean;
  nickname: string;
  language: string;
  age: string;
  gender: string;
  orientation: string;
  jobTitle: string;
  employer: string;
  educationLevel: string;
  politicalIdeology: string;
  religion: string;
  interests: string;
  country: string;
  state: string;
  zipcode: string;
}

// Load user settings from localStorage
const loadUserSettings = (): UserSettings => {
  try {
    const saved = localStorage.getItem(USER_SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading user settings:', error);
  }
  return {
    allowUseGitName: true,
    allowUseGitEmail: true,
    nickname: '',
    language: '',
    age: '',
    gender: '',
    orientation: '',
    jobTitle: '',
    employer: '',
    educationLevel: '',
    politicalIdeology: '',
    religion: '',
    interests: '',
    country: '',
    state: '',
    zipcode: '',
  };
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

type ViewMode = 'chat' | 'history';

interface ChatMessage {
  id: string;
  type: 'prompt' | 'response' | 'toolResult';
  content: string;
  expanded: boolean;
  timestamp: Date;
  agent?: Agent | null;
  isStreaming?: boolean;
  toolName?: string; // Name of the tool that produced this result
  toolResult?: any; // Tool result data (for toolResult type messages)
  _requestId?: string; // Request ID to match with token usage
  _isPlaceholder?: boolean; // Flag to identify placeholder messages
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

// Helper function to parse final answer from response text
// Looks for common patterns like '\n--\n' and '\nAnswer:\n'
// If no pattern is found, returns the entire response
const parseFinalAnswer = (fullResponse: string): string => {
  if (!fullResponse || fullResponse.trim().length === 0) {
    return fullResponse;
  }
  
  // Try pattern: '\n--\n' (common separator)
  const separatorPattern = /\n--\n/;
  const separatorMatch = fullResponse.search(separatorPattern);
  if (separatorMatch !== -1) {
    const finalAnswer = fullResponse.substring(separatorMatch + 4).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // Try pattern: '\nAnswer:\n' (common answer marker)
  const answerPattern1 = /\nAnswer:\s*\n/i;
  const answerMatch1 = fullResponse.match(answerPattern1);
  if (answerMatch1 && answerMatch1.index !== undefined) {
    const finalAnswer = fullResponse.substring(answerMatch1.index + answerMatch1[0].length).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // Try pattern: 'Answer:' (without newline)
  const answerPattern2 = /Answer:\s*/i;
  const answerMatch2 = fullResponse.match(answerPattern2);
  if (answerMatch2 && answerMatch2.index !== undefined) {
    const finalAnswer = fullResponse.substring(answerMatch2.index + answerMatch2[0].length).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // Try pattern: 'Final Answer:' or 'Final Answer:'
  const finalAnswerPattern = /Final\s+Answer:\s*/i;
  const finalAnswerMatch = fullResponse.match(finalAnswerPattern);
  if (finalAnswerMatch && finalAnswerMatch.index !== undefined) {
    const finalAnswer = fullResponse.substring(finalAnswerMatch.index + finalAnswerMatch[0].length).trim();
    if (finalAnswer.length > 0) {
      return finalAnswer;
    }
  }
  
  // No pattern found - return entire response (will be parsed as markdown)
  return fullResponse;
};

// Helper function to separate thinking from answer
const separateThinkingAndAnswer = (fullResponse: string): { thinking: string; answer: string } => {
  if (!fullResponse || fullResponse.trim().length === 0) {
    return { thinking: '', answer: '' };
  }
  
  // Try pattern: '\n--\n' (common separator)
  const separatorPattern = /\n--\n/;
  const separatorMatch = fullResponse.search(separatorPattern);
  if (separatorMatch !== -1) {
    const thinking = fullResponse.substring(0, separatorMatch).trim();
    const answer = fullResponse.substring(separatorMatch + 4).trim();
    return { thinking, answer };
  }
  
  // Try pattern: '\nAnswer:\n' (common answer marker)
  const answerPattern1 = /\nAnswer:\s*\n/i;
  const answerMatch1 = fullResponse.match(answerPattern1);
  if (answerMatch1 && answerMatch1.index !== undefined) {
    const thinking = fullResponse.substring(0, answerMatch1.index).trim();
    const answer = fullResponse.substring(answerMatch1.index + answerMatch1[0].length).trim();
    return { thinking, answer };
  }
  
  // Try pattern: 'Answer:' (without newline)
  const answerPattern2 = /Answer:\s*/i;
  const answerMatch2 = fullResponse.match(answerPattern2);
  if (answerMatch2 && answerMatch2.index !== undefined) {
    const thinking = fullResponse.substring(0, answerMatch2.index).trim();
    const answer = fullResponse.substring(answerMatch2.index + answerMatch2[0].length).trim();
    return { thinking, answer };
  }
  
  // Try pattern: 'Final Answer:' or 'Final Answer:'
  const finalAnswerPattern = /Final\s+Answer:\s*/i;
  const finalAnswerMatch = fullResponse.match(finalAnswerPattern);
  if (finalAnswerMatch && finalAnswerMatch.index !== undefined) {
    const thinking = fullResponse.substring(0, finalAnswerMatch.index).trim();
    const answer = fullResponse.substring(finalAnswerMatch.index + finalAnswerMatch[0].length).trim();
    return { thinking, answer };
  }
  
  // No pattern found - treat entire response as answer
  return { thinking: '', answer: fullResponse };
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

const ChatPanel = forwardRef<ChatPanelRef, ChatPanelProps>(({ isOpen, onClose, selectedContext, selectedAgent, agents = [], userProfile, terminalHeight = 0, onAgentChatStart, onClearAgentTabs, onClearAgentTab, onOpenTerminal }, ref) => {
  const [width, setWidth] = useState(loadChatPanelWidth());
  const [isResizing, setIsResizing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [thinkingTokens, setThinkingTokens] = useState(8192); // Default to 8192 for larger context
  const [promptText, setPromptText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>(loadUserSettings());
  const [showClearDropdown, setShowClearDropdown] = useState(false);
  const pendingRequestsRef = useRef<Set<string>>(new Set()); // Track all pending request IDs across all agents
  const [hasPendingRequests, setHasPendingRequests] = useState(false); // State to trigger re-renders
  const [ragIndexingStatus, setRagIndexingStatus] = useState<string | null>(null); // RAG indexing status
  const requestTokenUsage = useRef<Map<string, { promptTokens: number; completionTokens?: number; totalTokens?: number; maxContext: number; usagePercent: number; timings?: any }>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);
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
  const clearDropdownRef = useRef<HTMLDivElement>(null);
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
        if (messagesRef.current.length > 0 && previousAgentId) {
          console.log('Saving session before switching agent/context');
          const sessionId = currentSessionIdRef.current || Date.now().toString();
          const session: ChatSession = {
            id: sessionId,
            title: messagesRef.current[0]?.content.substring(0, 50) || 'New Chat',
            messages: messagesRef.current,
            tokensUsed: 0,
            changedLines: 0,
            isProcessing: isWaitingForResponseRef.current,
            lastUpdated: new Date(),
          };
          socket.emit('saveAgentChatSession', { 
            projectPath: getProjectPathFromContext(previousContextRef.current), 
            agentId: previousAgentId,
            session 
          });
        }
        
        setThinkingTokens(selectedAgent.contextSize);
        // Mark that we're switching agents
        isSwitchingAgentRef.current = true;
        // Clear current messages when switching agents - but wait for history to load
        setMessages([]);
        setPromptText('');
        setCurrentSessionId(null);
        
        // Load chat history specific to this agent
        socket.emit('getAgentChatHistory', { projectPath: getProjectPathFromContext(selectedContext), agentId: agentId });
      } else {
        // Same agent/context, just update thinking tokens if needed
        const currentThinkingTokens = thinkingTokens;
        if (selectedAgent.contextSize !== currentThinkingTokens) {
          setThinkingTokens(selectedAgent.contextSize);
        }
      }
      
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
        // Save current session before clearing if we had an agent selected
        if (messagesRef.current.length > 0 && previousAgentId) {
          console.log('Saving session before clearing agent');
          const sessionId = currentSessionIdRef.current || Date.now().toString();
          const session: ChatSession = {
            id: sessionId,
            title: messagesRef.current[0]?.content.substring(0, 50) || 'New Chat',
            messages: messagesRef.current,
            tokensUsed: 0,
            changedLines: 0,
            isProcessing: isWaitingForResponseRef.current,
            lastUpdated: new Date(),
          };
          socket.emit('saveAgentChatSession', { 
            projectPath: getProjectPathFromContext(previousContextRef.current), 
            agentId: previousAgentId,
            session 
          });
        }
        
        // If no agent selected, clear everything
        setMessages([]);
        setPromptText('');
        setCurrentSessionId(null);
        isSwitchingAgentRef.current = false;
        previousAgentIdRef.current = null;
        previousContextRef.current = null;
        setHasPendingRequests(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent?.id ?? null, currentContextKey]); // Only depend on agent ID and context key

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

  // Save messages when chat window closes
  useEffect(() => {
    // When chat closes (isOpen changes from true to false), save current session
    const wasOpen = previousIsOpenRef.current;
    const isClosing = wasOpen && !isOpen;
    
    if (isClosing && selectedAgent && messages.length > 0) {
      console.log('Saving session before closing chat window');
      const sessionId = currentSessionId || Date.now().toString();
      const session: ChatSession = {
        id: sessionId,
        title: messages[0]?.content.substring(0, 50) || 'New Chat',
        messages,
        tokensUsed: 0,
        changedLines: 0,
        isProcessing: isWaitingForResponse,
        lastUpdated: new Date(),
      };
      socket.emit('saveAgentChatSession', { 
        projectPath: getProjectPathFromContext(selectedContext), 
        agentId: selectedAgent.id,
        session 
      });
    }
    
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

  // Save current session function
  const saveCurrentSession = useCallback(() => {
    if (messages.length === 0 || !selectedAgent) return;

    const sessionId = currentSessionId || Date.now().toString();
    const session: ChatSession = {
      id: sessionId,
      title: messages[0]?.content.substring(0, 50) || 'New Chat',
      messages,
      tokensUsed: 0, // TODO: Calculate actual tokens
      changedLines: 0, // TODO: Track changed lines
      isProcessing: isWaitingForResponse,
      lastUpdated: new Date(),
    };

    // Save to agent-specific history
    socket.emit('saveAgentChatSession', { 
      projectPath: getProjectPathFromContext(selectedContext), 
      agentId: selectedAgent.id,
      session 
    });
    
    if (!currentSessionId) {
      setCurrentSessionId(sessionId);
    }
  }, [messages, currentSessionId, isWaitingForResponse, selectedContext, selectedAgent]);

  // Load models and chat history on mount
  useEffect(() => {
    if (isOpen) {
      socket.emit('getChatModels');
      // Reload user settings when chat opens
      setUserSettings(loadUserSettings());
    }

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
                }
              : msg
          );
        } else {
          // No existing message or placeholder found, create new message (fallback)
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
          
          const sessionId = Date.now().toString();
          const session: ChatSession = {
            id: sessionId,
            title: finalAnswer.substring(0, 50) || 'New Chat',
            messages: [responseMessage], // Just the response if we can't find the prompt
            tokensUsed: 0,
            changedLines: 0,
            isProcessing: false,
            lastUpdated: new Date(),
          };
          
          socket.emit('saveAgentChatSession', {
            projectPath: getProjectPathFromContext(selectedContext),
            agentId: responseAgentId!,
            session
          });
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
          
          const sessionId = Date.now().toString();
          const session: ChatSession = {
            id: sessionId,
            title: promptMessage.content.substring(0, 50) || 'New Chat',
            messages: [promptMessage, responseMessage],
            tokensUsed: 0,
            changedLines: 0,
            isProcessing: false,
            lastUpdated: new Date(),
          };
          
          socket.emit('saveAgentChatSession', {
            projectPath: getProjectPathFromContext(selectedContext),
            agentId: responseAgentId!,
            session
          });
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
        
        if (!targetMessage) {
          // No message found, create one (fallback)
          // Even though response.content is empty (everything was streamed), parse it for consistency
          const finalAnswer = parseFinalAnswer(response.content || '');
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
        
        // Remove placeholders when response completes
        let filteredPrev = prev.filter(msg => !msg._isPlaceholder || msg.id === targetMessage.id);
        
        // Get the accumulated content from the message (it was streamed via chunks)
        // response.content is empty because everything was streamed
        const accumulatedContent = targetMessage.content || '';
        
        // Parse the final answer from the accumulated content
        const finalAnswer = parseFinalAnswer(accumulatedContent);
        
        // Update the message with parsed final answer
        const updatedMessages = filteredPrev.map(msg =>
          msg.id === targetMessage.id
            ? { 
                ...msg, 
                id: response.id,
                content: finalAnswer,
                isStreaming: false,
                _isPlaceholder: false,
              }
            : msg
        );
        
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

    socket.on('agentChatHistory', (history: ChatSession[]) => {
      console.log('agentChatHistory received:', history.length, 'sessions, isSwitchingAgentRef:', isSwitchingAgentRef.current);
      setChatHistory(history);
      // If we just switched agents and have history, restore the most recent session
      if (isSwitchingAgentRef.current && history.length > 0) {
        console.log('Restoring agent chat history, most recent session:', history[history.length - 1].id);
        // Use a callback to get the current messages from ref
        setMessages(prev => {
          // Always restore if we're switching and have history, even if prev has some messages
          // This ensures we load the correct agent's history
          if (history.length > 0) {
            // Load the most recent session
            const mostRecentSession = history[history.length - 1];
            if (mostRecentSession && mostRecentSession.messages.length > 0) {
              console.log('Restoring messages:', mostRecentSession.messages.length);
              return mostRecentSession.messages;
            }
          }
          return prev;
        });
        // Also update session ID if we restored
        if (history.length > 0) {
          const mostRecentSession = history[history.length - 1];
          if (mostRecentSession) {
            setCurrentSessionId(mostRecentSession.id);
          }
        }
        // Reset the switching flag
        isSwitchingAgentRef.current = false;
      } else if (history.length > 0) {
        // Always restore history if we have it and no messages (or we're opening chat)
        // This handles both switching and opening chat for the first time
        // Use ref to check messages length to avoid stale closure issues
        if (messagesRef.current.length === 0) {
          console.log('Loading history for agent (no existing messages)');
          const mostRecentSession = history[history.length - 1];
          if (mostRecentSession && mostRecentSession.messages.length > 0) {
            setMessages(mostRecentSession.messages);
            setCurrentSessionId(mostRecentSession.id);
          }
        } else {
          console.log('History available but messages exist, not overriding');
        }
      } else {
        console.log('No history available for this agent');
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

    return () => {
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showClearDropdown && clearDropdownRef.current && !clearDropdownRef.current.contains(event.target as Node)) {
        setShowClearDropdown(false);
      }
    };

    if (showClearDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showClearDropdown]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleNewChat = () => {
    // Save current session before starting new one
    if (messages.length > 0) {
      saveCurrentSession();
    }
    
    setMessages([]);
    setPromptText('');
    setCurrentSessionId(null);
  };

  const handleClear = () => {
    if (!selectedAgent) return;
    
    // Clear current chat messages
    setMessages([]);
    setPromptText('');
    setCurrentSessionId(null);
    
    // Clear the current agent's terminal tab (this will clear the thinking logs)
    if (onClearAgentTab && selectedAgent) {
      onClearAgentTab(selectedAgent.id);
    }
    
    // Clear agent's chat history on server
    socket.emit('clearAgentChatHistory', { 
      projectPath: getProjectPathFromContext(selectedContext), 
      agentId: selectedAgent.id 
    });
    
    // Clear chat history from state
    setChatHistory([]);
    setShowClearDropdown(false);
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
    
    // Clear chat history from state
    setChatHistory([]);
    setShowClearDropdown(false);
  };

  const handleSend = () => {
    if (!promptText.trim() || !selectedAgent || hasPendingRequests) return;
    
    // Add prompt to messages
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'prompt',
      content: promptText,
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
    
    // Prepare conversation history (exclude placeholder messages and the current message)
    // Include recent messages for context - limit to last 20 messages to manage context window
    const conversationHistory = messages
      .filter(msg => !msg._isPlaceholder && msg.id !== newMessage.id)
      .slice(-20) // Last 20 messages for context
      .map(msg => ({
        role: msg.type === 'prompt' ? 'user' : 'assistant',
        content: msg.content
      }));
    
    // Send to AI via socket
    socket.emit('sendChatPrompt', {
      requestId,
      prompt: newMessage.content,
      conversationHistory, // Include conversation history for stateful conversations
      model: selectedAgent.model,
      thinkingTokens,
      projectPath: selectedAgent?.enabledAttributes?.includes('Project Path') ? getProjectPathFromContext(selectedContext) : null,
      containerId: selectedContext?.type === 'container' ? selectedContext.id : null,
      agentId: selectedAgent?.id,
      agentTools: selectedAgent?.enabledTools || [],
      agentPrivilegedTools: selectedAgent?.privilegedTools || [],
      agentName: selectedAgent?.enabledAttributes?.includes('Agent Name') ? selectedAgent.name : null,
      agentNickname: selectedAgent?.enabledAttributes?.includes('Agent Nickname') ? selectedAgent.nickname : null,
      agentJobTitle: selectedAgent?.enabledAttributes?.includes('Agent Job Title') ? selectedAgent.jobTitle : null,
      userName: selectedAgent?.enabledAttributes?.includes('User Name') && userSettings.allowUseGitName ? userProfile?.name : null,
      userEmail: selectedAgent?.enabledAttributes?.includes('User Email') && userSettings.allowUseGitEmail ? userProfile?.email : null,
      userNickname: selectedAgent?.enabledAttributes?.includes('User Nickname') && userSettings.nickname ? userSettings.nickname : null,
      userLanguage: selectedAgent?.enabledAttributes?.includes('User Language') && userSettings.language ? userSettings.language : null,
      userAge: selectedAgent?.enabledAttributes?.includes('User Age') && userSettings.age ? userSettings.age : null,
      userGender: selectedAgent?.enabledAttributes?.includes('User Gender Identity') && userSettings.gender ? userSettings.gender : null,
      userOrientation: selectedAgent?.enabledAttributes?.includes('User Gender Orientation') && userSettings.orientation ? userSettings.orientation : null,
      userJobTitle: selectedAgent?.enabledAttributes?.includes('User Job Title') && userSettings.jobTitle ? userSettings.jobTitle : null,
      userEmployer: selectedAgent?.enabledAttributes?.includes('User Employer') && userSettings.employer ? userSettings.employer : null,
      userEducationLevel: selectedAgent?.enabledAttributes?.includes('User Education Level') && userSettings.educationLevel ? userSettings.educationLevel : null,
      userPoliticalIdeology: selectedAgent?.enabledAttributes?.includes('User Political Ideology') && userSettings.politicalIdeology ? userSettings.politicalIdeology : null,
      userReligion: selectedAgent?.enabledAttributes?.includes('User Religion') && userSettings.religion ? userSettings.religion : null,
      userInterests: selectedAgent?.enabledAttributes?.includes('User Interests') && userSettings.interests ? userSettings.interests : null,
      userCountry: selectedAgent?.enabledAttributes?.includes('User Country') && userSettings.country ? userSettings.country : null,
      userState: selectedAgent?.enabledAttributes?.includes('User State') && userSettings.state ? userSettings.state : null,
      userZipcode: selectedAgent?.enabledAttributes?.includes('User Zipcode') && userSettings.zipcode ? userSettings.zipcode : null,
    });
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

  const loadChatSession = (session: ChatSession) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setViewMode('chat');
  };

  const deleteChatSession = (sessionId: string) => {
    if (!selectedAgent) return;
    
    socket.emit('deleteAgentChatSession', { 
      projectPath: getProjectPathFromContext(selectedContext), 
      agentId: selectedAgent.id,
      sessionId 
    });
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
      className={`chat-panel ${isOpen ? 'open' : ''}`}
      style={{ 
        width: isOpen ? `${width}px` : '0',
        height: '100%'
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
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {selectedAgent.avatar ? (
                    <img src={selectedAgent.avatar} alt={selectedAgent.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">🤖</span>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-200">{selectedAgent.name}</span>
                  {selectedAgent.jobTitle && (
                    <span className="text-xs text-gray-400">{selectedAgent.jobTitle}</span>
                  )}
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
              onClick={handleNewChat}
              title="New Chat"
              className="new-chat-button"
            >
              New
            </button>
            <button 
              onClick={() => setViewMode(viewMode === 'chat' ? 'history' : 'chat')}
              className={viewMode === 'history' ? 'active' : ''}
              title="Chat History"
            >
              History
            </button>
            <div className="relative" ref={clearDropdownRef}>
              <button 
                onClick={() => setShowClearDropdown(!showClearDropdown)}
                title="Clear Chat and Agent Terminals"
                className="clear-button"
              >
                Clear {showClearDropdown ? '▲' : '▼'}
              </button>
              {showClearDropdown && (
                <div className="absolute right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[160px]">
                  <button
                    onClick={handleClear}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 first:rounded-t-lg"
                    disabled={!selectedAgent}
                  >
                    Clear Current
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 last:rounded-b-lg"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>
            <button className="close-button" onClick={onClose} title="Close">×</button>
          </div>
        </div>

        {viewMode === 'chat' ? (
          <>
            {/* Chat Response Area */}
            <div className="chat-messages">
              {messages.length === 0 ? (
                <p className="empty-state">Start a conversation with {selectedAgent?.nickname || selectedAgent?.name || 'your AI assistant'}...</p>
              ) : (
                messages
                  .filter(msg => !msg.content.includes('Starting MCP gateway'))
                  .map(msg => (
                    <div key={msg.id} className={`message ${msg.type}`}>
                      {(msg.type === 'response' || msg.type === 'toolResult') && msg.agent && (
                        <div className="message-agent-header">
                          <div className="message-agent-avatar">
                            {msg.agent.avatar ? (
                              <img src={msg.agent.avatar} alt={msg.agent.name} />
                            ) : (
                              <span>🤖</span>
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
                              <span>👤</span>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="message-content">
                        {msg.type === 'toolResult' ? (
                          // Tool result message - display JSON data
                          <div className="tool-result-section">
                            <JSONExplorer data={msg.toolResult} />
                          </div>
                        ) : msg.isStreaming && !msg.content ? (
                          // Show "Thinking..." when streaming and no content yet
                          <div className="thinking-indicator-container">
                            <div 
                              className="thinking-indicator clickable"
                              onClick={() => handleThinkingClick(msg.agent?.id, msg.agent?.name)}
                              style={{ cursor: msg.agent ? 'pointer' : 'default' }}
                            >
                              Thinking...
                              {msg.agent && (
                                <span className="thinking-hint"> (Click to view in terminal)</span>
                              )}
                            </div>
                            {msg._requestId && (
                              <button
                                className="abort-thinking-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAbort(msg._requestId!);
                                }}
                                title="Abort this request"
                              >
                                Abort
                              </button>
                            )}
                          </div>
                        ) : (
                          // Regular message (prompt or response)
                          <MessageRenderer content={msg.content} isStreaming={msg.isStreaming || false} />
                        )}
                      </div>
                    </div>
                  ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Prompt Section */}
            <div className="chat-prompt-section">
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
                    className="send-btn"
                    onClick={handleSend}
                    disabled={!promptText.trim() || hasPendingRequests}
                    title={hasPendingRequests ? 'Please wait for responses to complete' : 'Send message'}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Chat History View */
          <div className="chat-history">
            <div className="history-list">
              {chatHistory.length === 0 ? (
                <p className="empty-state">No chat history yet...</p>
              ) : (
                chatHistory.map(session => (
                  <div key={session.id} className="history-item">
                    <div className="history-item-header" onClick={() => loadChatSession(session)}>
                      <h4>{session.title}</h4>
                      {session.isProcessing && <span className="processing-badge">Processing</span>}
                    </div>
                    <div className="history-item-meta">
                      <span>Tokens: {session.tokensUsed}</span>
                      <span>Lines Changed: {session.changedLines}</span>
                      <span>{new Date(session.lastUpdated).toLocaleDateString()}</span>
                    </div>
                    <button 
                      className="delete-session-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChatSession(session.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatPanel;

