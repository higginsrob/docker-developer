import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
}

const MessageRenderer: React.FC<MessageRendererProps> = ({ content, isStreaming = false }) => {
  // Tool results are now handled separately in ChatPanel, so we don't parse them here anymore
  
  // Check if content looks like markdown (has common markdown patterns)
  const hasMarkdownPatterns = /(#{1,6}\s|```|`[^`]+`|\*\*|__|\[.*\]\(.*\))/.test(content);
  
  if (hasMarkdownPatterns) {
    return (
      <div className="message-renderer">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }
  
  // Plain text - render line by line with fade animation if streaming
  if (isStreaming) {
    const lines = content.split('\n');
    return (
      <div className="message-renderer">
        {lines.map((line, index) => (
          <div key={index} className="streaming-line">
            {line.split('').map((char, charIndex) => (
              <span 
                key={charIndex} 
                className="streaming-char"
                style={{ animationDelay: `${charIndex * 20}ms` }}
              >
                {char}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }
  
  // Plain text, not streaming
  return (
    <div className="message-renderer">
      {content.split('\n').map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
};

export default MessageRenderer;

