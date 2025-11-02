# RAG System Testing Guide

## Overview

This guide provides test scenarios to verify the RAG (Retrieval-Augmented Generation) feature is working correctly.

## Prerequisites

1. Build the application: `npm run build:main`
2. Start the application: `npm start`
3. Create or select an AI agent
4. Ensure RAG is enabled in Settings

## Test Scenarios

### Test 1: Basic Message Storage and Retrieval

**Objective**: Verify messages are stored and retrieved correctly.

**Steps**:
1. Open the application and select an agent
2. Send a message: "What is Docker?"
3. Wait for response
4. Send another message: "How do I create a container?"
5. Wait for response
6. Send: "Tell me more about that Docker thing"

**Expected Results**:
- All messages should be stored in the database
- The third query should retrieve context from the first message about Docker
- Console should show: "Added RAG context from past conversations"
- The agent's response should reference the previous Docker discussion

**Verification**:
```
Console logs to check:
- "Stored user message in RAG database"
- "Stored assistant message in RAG database"
- "Added RAG context from past conversations"
```

### Test 2: Similarity Threshold

**Objective**: Test similarity threshold filtering.

**Steps**:
1. Go to Settings → RAG
2. Set Similarity Threshold to 0.9 (high)
3. Have a conversation about "Python programming"
4. Ask a completely different question: "What's the weather like?"

**Expected Results**:
- With high threshold, unrelated queries should NOT retrieve context
- Weather question should not include Python context
- Lower threshold to 0.5 and repeat - should see more context

### Test 3: Top K Configuration

**Objective**: Test retrieving different numbers of similar messages.

**Steps**:
1. Have 10+ message exchanges with the agent on various topics
2. Go to Settings → RAG
3. Set Top K to 2
4. Ask a question that relates to multiple past topics
5. Change Top K to 10
6. Ask the same question again

**Expected Results**:
- With Top K = 2: Only 2 most similar messages in context
- With Top K = 10: Up to 10 similar messages in context
- More context may lead to more comprehensive answers

### Test 4: Enable/Disable RAG

**Objective**: Verify RAG can be turned on and off.

**Steps**:
1. Have a conversation about "React components"
2. Wait a moment for embeddings to be generated
3. Go to Settings → RAG and disable RAG
4. Ask: "What did we discuss about React?"
5. Enable RAG again
6. Ask the same question

**Expected Results**:
- With RAG disabled: Agent has no context from previous conversation
- With RAG enabled: Agent references the React discussion
- Statistics should show total messages regardless of enabled state

### Test 5: Agent-Specific History

**Objective**: Verify each agent maintains separate history.

**Steps**:
1. Create two agents: "Agent A" and "Agent B"
2. Chat with Agent A about "Docker containers"
3. Switch to Agent B
4. Chat with Agent B about "Kubernetes pods"
5. Switch back to Agent A
6. Ask: "What did we discuss before?"

**Expected Results**:
- Agent A should only reference Docker conversation
- Agent B should only reference Kubernetes conversation
- Histories are completely separate

### Test 6: Project-Specific Context

**Objective**: Verify context is scoped to projects when applicable.

**Steps**:
1. Select Project A and have a conversation with an agent
2. Switch to Project B and continue conversation with same agent
3. Ask questions that should reference Project A context

**Expected Results**:
- Context should be scoped to current project
- Messages from Project A should be retrievable when on Project A
- Messages from Project B should be retrievable when on Project B

### Test 7: Statistics Accuracy

**Objective**: Verify statistics are accurate and update in real-time.

**Steps**:
1. Note current statistics in Settings → RAG
2. Have a conversation (5+ messages)
3. Refresh or check statistics again
4. Clear history for the agent
5. Check statistics again

**Expected Results**:
- Total Messages should increase by the number of messages sent
- Total Embeddings should match Total Messages (or slightly lag due to async)
- After clearing, counts should decrease
- Statistics should be accurate

### Test 8: Large Conversation History

**Objective**: Test performance with many messages.

**Steps**:
1. Have an extended conversation (50+ messages)
2. Monitor response times
3. Check database size in user data directory
4. Ask questions that reference early messages

**Expected Results**:
- Response times should remain fast (<100ms for retrieval)
- Database should be reasonably sized (~2-4 KB per message)
- Early messages should still be retrievable
- No memory leaks or performance degradation

### Test 9: Edge Cases

**Objective**: Test unusual inputs and edge cases.

**Steps**:
1. Send very short messages: "hi", "ok", "yes"
2. Send very long messages (1000+ words)
3. Send messages with special characters: emojis, code blocks, URLs
4. Send identical messages multiple times

**Expected Results**:
- All message types should be stored correctly
- Embeddings should be generated without errors
- Similarity search should handle all message types
- No crashes or data corruption

### Test 10: Context Quality

**Objective**: Evaluate the quality of retrieved context.

**Steps**:
1. Have conversations on distinct topics:
   - Topic 1: "Setting up a Node.js project"
   - Topic 2: "Deploying to AWS"
   - Topic 3: "React best practices"
2. Ask questions that clearly relate to each topic
3. Review the RAG context that was retrieved (check console logs)

**Expected Results**:
- Questions about Node.js should retrieve Topic 1 context
- Questions about AWS should retrieve Topic 2 context
- Questions about React should retrieve Topic 3 context
- Context should be relevant and helpful

## Automated Verification

### Console Logs to Monitor

Enable verbose logging and check for:

```
✅ Good logs:
- "RAG service initialized successfully"
- "SQLite vector extension loaded successfully"
- "Added RAG context from past conversations"
- "Stored user message in RAG database"
- "Stored assistant message in RAG database"

❌ Error logs to watch for:
- "Failed to initialize RAG service"
- "Vector extension not found"
- "Failed to store message"
- "Failed to build RAG context"
- "Failed to find similar messages"
```

### Database Verification

Check the database directly:

```bash
# Location (macOS)
cd ~/Library/Application\ Support/docker-developer

# List tables
sqlite3 chat-history.db ".tables"

# Check message count
sqlite3 chat-history.db "SELECT COUNT(*) FROM chat_messages;"

# Check embedding count
sqlite3 chat-history.db "SELECT COUNT(*) FROM chat_embeddings;"

# View recent messages
sqlite3 chat-history.db "SELECT role, content, timestamp FROM chat_messages ORDER BY timestamp DESC LIMIT 5;"
```

## Performance Benchmarks

Expected performance metrics:

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Store message | < 5ms | Excluding embedding generation |
| Generate embedding | 5-10ms | Simple hash-based |
| Vector search | < 10ms | For 10,000 messages |
| Build RAG context | < 20ms | Including search + formatting |
| Total overhead | < 50ms | Per message |

## Known Limitations

Current implementation uses a simple embedding model for demonstration:
- Not as semantically accurate as transformer models
- May not capture complex semantic relationships
- Works best for keyword-based similarity

For production use, integrate with:
- Sentence-BERT models (all-MiniLM-L6-v2)
- OpenAI embeddings API
- Cohere embeddings API

## Troubleshooting Tests

If tests fail:

1. **Check RAG is enabled**: Settings → RAG → Enable RAG
2. **Verify extension loaded**: Check console for "SQLite vector extension loaded"
3. **Check database exists**: Look for `chat-history.db` in user data
4. **Clear and retry**: Clear history and test again
5. **Check logs**: Review console for error messages
6. **Restart app**: Close and reopen the application

## Test Results Template

Document your test results:

```
Test Date: [DATE]
App Version: [VERSION]
OS: [macOS/Windows/Linux]

Test 1: Basic Storage and Retrieval
Status: [PASS/FAIL]
Notes: [Any observations]

Test 2: Similarity Threshold
Status: [PASS/FAIL]
Notes: [Any observations]

[... continue for all tests ...]

Overall Assessment: [PASS/FAIL]
Issues Found: [List any issues]
```

## Continuous Testing

For ongoing verification:
1. Monitor RAG statistics regularly
2. Review context quality in responses
3. Check for any error logs
4. Verify database size growth is reasonable
5. Test after each code change

## Next Steps

After testing:
1. Document any issues found
2. Verify fixes for any failures
3. Consider additional test scenarios
4. Improve embedding model if needed
5. Optimize performance if necessary


