# RAG (Retrieval-Augmented Generation) Feature

## Overview

The RAG feature enhances the AI agent's ability to provide contextual and relevant responses by leveraging past conversation history. It uses SQLite with vector search capabilities to store chat messages and retrieve similar past conversations when answering new queries.

## Architecture

### Components

1. **RAG Service** (`src/main/rag-service.ts`)
   - Manages SQLite database with vector search extension
   - Handles message storage and retrieval
   - Generates embeddings for chat messages
   - Performs similarity searches

2. **Database Schema**
   - `chat_messages`: Stores all chat messages with metadata
   - `chat_embeddings`: Stores vector embeddings using sqlite-vec extension

3. **Integration Points**
   - Main process (`src/main/index.ts`): Integrates RAG into chat flow
   - Settings UI (`src/renderer/src/components/Settings.tsx`): Configuration interface

## Features

### 1. Automatic Message Storage

All chat messages (both user prompts and assistant responses) are automatically stored in the database with:
- Project path
- Agent ID
- Role (user/assistant/system)
- Content
- Timestamp
- Session ID

### 2. Vector Similarity Search

When a user sends a new prompt:
1. The prompt is converted to a vector embedding
2. Similar past messages are retrieved using vector similarity search
3. Relevant context is added to the prompt automatically

### 3. Configurable Settings

Users can control RAG behavior through the Settings interface:

- **Enable/Disable**: Turn RAG on or off
- **Top K**: Number of similar conversations to retrieve (1-20)
- **Similarity Threshold**: Minimum similarity score (0.0-1.0)
- **Embedding Model**: Model used for generating embeddings

### 4. Statistics Dashboard

View database statistics:
- Total messages stored
- Total vector embeddings
- Number of agents with history

## How It Works

### Message Flow

```
User Sends Prompt
    ↓
Store User Message in DB
    ↓
Generate Embedding
    ↓
Search for Similar Past Messages
    ↓
Build RAG Context from Similar Messages
    ↓
Append Context to Prompt
    ↓
Send Enhanced Prompt to AI Model
    ↓
Receive Response
    ↓
Store Assistant Response in DB
    ↓
Generate Embedding (async)
```

### Embedding Generation

Uses **Xenova/all-MiniLM-L6-v2** - a production-ready sentence transformer model:
- Quantized version of sentence-transformers/all-MiniLM-L6-v2
- Provides 384-dimensional embeddings with excellent semantic understanding
- Optimized for semantic search of code and text
- Fast inference with quantized model (~5-10ms per embedding)
- Falls back to simple hash-based embeddings if model fails to load

The model provides high-quality semantic embeddings that understand the meaning of code and text, enabling accurate similarity search across:
- Previous chat conversations
- Project filesystem files
- Container filesystem files
- GitHub repository information

### Vector Search

Uses SQLite with cosine similarity for efficient similarity search:
- Cosine similarity for vector comparison
- Fast indexed searches
- Scalable to millions of messages

## Configuration

### Default Settings

```json
{
  "enabled": true,
  "topK": 5,
  "similarityThreshold": 0.7,
  "embeddingModel": "all-minilm"
}
```

### Files

- Database: `~/Library/Application Support/docker-developer/chat-history.db`
- Config: `~/Library/Application Support/docker-developer/rag-config.json`
- Vector Extension: `lib/vec0.dylib`

## Usage

### For Users

1. **Enable RAG**: Go to Settings → RAG section → Toggle "Enable RAG"
2. **Adjust Settings**: Configure Top K and Similarity Threshold based on your needs
3. **Chat Normally**: RAG works automatically in the background

### For Developers

#### Accessing RAG Service

```typescript
// The RAG service is initialized in main process
const ragService = new RAGService();
ragService.initialize();

// Store a message
await ragService.storeMessage({
  projectPath: '/path/to/project',
  agentId: 'agent-123',
  role: 'user',
  content: 'How do I implement authentication?',
  timestamp: new Date(),
  sessionId: 'session-456'
});

// Find similar messages
const similar = await ragService.findSimilarMessages(
  'What is the auth system?',
  'agent-123',
  '/path/to/project'
);

// Build context for RAG
const context = await ragService.buildRAGContext(
  'What is the auth system?',
  'agent-123',
  '/path/to/project'
);
```

#### Socket.IO Events

**Client → Server:**
- `getRAGConfig`: Get current RAG configuration
- `updateRAGConfig`: Update RAG configuration
- `getRAGStats`: Get database statistics
- `clearRAGHistory`: Clear history for an agent

**Server → Client:**
- `ragConfig`: Current configuration
- `ragStats`: Database statistics
- `ragConfigUpdated`: Configuration updated successfully
- `ragHistoryCleared`: History cleared
- `ragError`: Error occurred

## Testing

### Manual Testing

1. **Start the application**
2. **Create or select an agent**
3. **Have a conversation**:
   ```
   User: "How do I create a React component?"
   Agent: [Response explaining React components]
   
   User: "Show me an example"
   Agent: [Provides example]
   
   [Later in a new session]
   
   User: "What was that thing about React?"
   Agent: [Should reference the previous conversation about components]
   ```

4. **Check Settings**:
   - Go to Settings → RAG section
   - Verify statistics are updating
   - Try adjusting Top K and Similarity Threshold
   - Test disabling/enabling RAG

### Verification

Monitor console logs for:
```
RAG service initialized
Added RAG context from past conversations
Stored user message in RAG database
Stored assistant message in RAG database
```

## Performance Considerations

### Database Size

- Each message: ~500-2000 bytes
- Each embedding: ~1.5 KB (384 dimensions × 4 bytes)
- 10,000 messages ≈ 20 MB database

### Query Performance

- Similarity search: O(log n) with proper indexing
- Typical query time: <10ms for 10,000 messages
- Embedding generation: ~5-10ms per message

### Optimization Tips

1. **Periodic Cleanup**: Delete old or irrelevant messages
2. **Batch Processing**: Generate embeddings in batches
3. **Caching**: Recent embeddings are cached in memory
4. **Indexing**: sqlite-vec handles indexing automatically

## Future Enhancements

### Planned Features

1. **Advanced Embedding Models**
   - Integration with sentence-transformers
   - Support for multiple embedding models
   - Model selection per agent

2. **Semantic Search Improvements**
   - Multi-query expansion
   - Re-ranking with cross-encoder
   - Hybrid search (keyword + vector)

3. **Context Management**
   - Intelligent context pruning
   - Relevance scoring
   - Time-weighted relevance

4. **UI Enhancements**
   - Visualize similar messages in chat
   - Manual context selection
   - Export/import conversations

5. **Analytics**
   - RAG effectiveness metrics
   - Context usage statistics
   - Quality feedback loops

## Troubleshooting

### RAG Not Working

1. **Check if enabled**: Settings → RAG → Enable RAG checkbox
2. **Check database**: Verify `chat-history.db` exists in user data
3. **Check vector extension**: Verify `lib/vec0.dylib` is present
4. **Check logs**: Look for RAG-related errors in console

### No Similar Messages Found

1. **Adjust similarity threshold**: Lower the threshold in Settings
2. **Increase Top K**: Retrieve more results
3. **Build history**: RAG needs past conversations to work
4. **Check agent ID**: Messages are agent-specific

### Performance Issues

1. **Clear old history**: Use "Clear History" in agent chat
2. **Reduce Top K**: Retrieve fewer results
3. **Disable RAG**: Temporarily disable if not needed
4. **Optimize database**: Use SQLite VACUUM command

## Dependencies

- `better-sqlite3`: SQLite database driver
- `sqlite-vec`: Vector search extension for SQLite
- Electron: Desktop application framework

## License

Same as the main Docker Developer project.

## Support

For issues or questions:
1. Check console logs for errors
2. Review RAG statistics in Settings
3. File an issue on GitHub with logs

