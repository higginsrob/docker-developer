import path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import initSqlJs, { Database } from 'sql.js';
import { pipeline, env } from '@xenova/transformers';
import Docker from 'dockerode';
import simpleGit from 'simple-git';

interface RAGConfig {
  enabled: boolean;
  topK: number; // Number of similar file chunks to retrieve
  similarityThreshold: number; // Minimum similarity score (0-1)
  embeddingModel: string; // Model to use for embeddings
}

interface FileChunk {
  id?: number;
  projectPath: string | null;
  containerId: string | null;
  filePath: string;
  content: string;
  chunkIndex: number;
  lastModified: Date;
  embedding?: Float32Array;
}

interface SimilarFileChunk {
  id: number;
  filePath: string;
  content: string;
  similarity: number;
  chunkIndex: number;
}

interface GitHubRepoInfo {
  containerId: string | null;
  projectPath: string | null;
  remoteUrl: string | null;
  branch: string | null;
  lastCommit: string | null;
  lastCommitMessage: string | null;
  lastIndexed: Date;
}

interface FileTreeNode {
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

export type RAGStatusCallback = (status: string | null) => void;

export class RAGService {
  private db: Database | null = null;
  private dbPath: string;
  private config: RAGConfig;
  private embeddingCache: Map<string, Float32Array> = new Map();
  private sqlJsLib: any = null;
  private embeddingPipeline: any = null;
  private embeddingModelLoaded: boolean = false;
  private shouldAbortIndexing: boolean = false;
  private readonly CHUNK_SIZE = 1000; // Characters per chunk
  private readonly CHUNK_OVERLAP = 200; // Overlap between chunks
  private readonly MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB max file size to index
  private readonly MAX_CHUNKS = 10000; // Maximum number of chunks per file
  private readonly MAX_CONTEXT_LENGTH = 8000; // Maximum characters in context
  
  // Text file extensions to index
  private readonly TEXT_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyw', '.pyx',
    '.java', '.kt', '.scala',
    '.go', '.rs', '.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx',
    '.cs', '.vb', '.fs',
    '.php', '.rb', '.swift', '.dart',
    '.sh', '.bash', '.zsh', '.fish', '.ps1',
    '.sql', '.pl', '.lua', '.r', '.m', '.swift',
    '.md', '.markdown', '.txt', '.rst', '.adoc',
    '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.xml', '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.vue', '.svelte', '.elm',
    '.dockerfile', '.makefile', '.cmake',
    '.log', '.env', '.gitignore', '.gitattributes',
    '.editorconfig', '.prettierrc', '.eslintrc',
    '.sh', '.bat', '.cmd'
  ];
  
  // Image and binary file extensions to ignore
  private readonly BINARY_EXTENSIONS = [
    // Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico',
    '.tiff', '.tif', '.psd', '.ai', '.eps', '.raw', '.cr2', '.nef',
    '.orf', '.sr2', '.heic', '.heif', '.avif',
    // Binary formats
    '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp',
    '.db', '.sqlite', '.sqlite3', '.mdb',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.class', '.jar', '.war', '.ear',
    '.o', '.obj', '.a', '.lib'
  ];
  
  constructor() {
    // Database will be stored in userData directory
    this.dbPath = path.join(app.getPath('userData'), 'rag-index.db');
    
    // Default configuration
    this.config = {
      enabled: true,
      topK: 5,
      similarityThreshold: 0.7,
      embeddingModel: 'all-minilm' // Using Xenova/all-MiniLM-L6-v2 - a production-ready sentence transformer model
    };
    
    this.loadConfig();
  }
  
  /**
   * Initialize the database and load sql.js
   */
  async initialize(): Promise<void> {
    console.log('=== RAG Service initialize() called ===');
    console.log('Starting initialization process...');
    
    try {
      console.log('Loading sql.js library...');
      this.sqlJsLib = await initSqlJs();
      console.log('[✓] sql.js library loaded successfully');
      
      console.log('=== RAG Service Initialization ===');
      console.log('Initializing RAG service...');
      console.log('Database path:', this.dbPath);
      
      // Ensure userData directory exists
      const userDataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(userDataDir)) {
        console.log('Creating userData directory:', userDataDir);
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      
      console.log('Loading or creating database...');
      
      // Load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new this.sqlJsLib.Database(buffer);
        console.log('[✓] Database loaded from file');
      } else {
        this.db = new this.sqlJsLib.Database();
        console.log('[✓] New database created');
      }
      
      // Create tables
      console.log('Creating database tables...');
      this.createTables();
      console.log('Database tables created');
      
      // Initialize embedding model
      console.log('Loading embedding model...');
      await this.initializeEmbeddingModel();
      console.log('[✓] Embedding model loaded');
      
      console.log('=== RAG Service Initialization Complete ===');
      console.log('RAG service initialized successfully - database ready');
    } catch (error: any) {
      console.error('=== RAG Service Initialization Failed ===');
      console.error('Failed to initialize RAG service:', error);
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
      // Don't throw - allow app to continue without RAG
      // Set db to null so methods can check and skip gracefully
      this.db = null;
      console.error('RAG operations will be skipped until initialization succeeds');
    }
  }
  
  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) {
      console.error('Cannot create tables: database not initialized');
      return;
    }
    
    // Create file_chunks table for indexing project files
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT,
        container_id TEXT,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        last_modified TEXT NOT NULL,
        embedding_dimension INTEGER
      );
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_project ON file_chunks(project_path);
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_container ON file_chunks(container_id);
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_file_path ON file_chunks(file_path);
    `);
    
    // Create file_chunk_embeddings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_chunk_embeddings (
        chunk_id INTEGER PRIMARY KEY,
        embedding TEXT NOT NULL,
        FOREIGN KEY(chunk_id) REFERENCES file_chunks(id)
      );
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_chunk_embedding_id ON file_chunk_embeddings(chunk_id);
    `);
    
    // Create file_tree table for storing project structure
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_tree (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT,
        project_path TEXT,
        file_path TEXT NOT NULL,
        is_directory INTEGER NOT NULL,
        parent_path TEXT,
        last_indexed TEXT NOT NULL,
        UNIQUE(container_id, project_path, file_path)
      );
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_tree_container ON file_tree(container_id);
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_tree_project ON file_tree(project_path);
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_tree_parent ON file_tree(parent_path);
    `);
    
    // Create github_repo_info table (updated to support containers)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS github_repo_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT,
        project_path TEXT,
        remote_url TEXT,
        branch TEXT,
        last_commit TEXT,
        last_commit_message TEXT,
        last_indexed TEXT NOT NULL,
        UNIQUE(container_id, project_path)
      );
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_repo_info_container ON github_repo_info(container_id);
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_repo_info_project ON github_repo_info(project_path);
    `);
    
    // Save database to disk
    this.saveDatabase();
  }
  
  /**
   * Initialize the embedding model using transformers
   * Uses Xenova/all-MiniLM-L6-v2 - a production-ready sentence transformer model
   * that provides high-quality semantic embeddings for code and text
   */
  private async initializeEmbeddingModel(): Promise<void> {
    try {
      // Configure transformers environment
      env.allowLocalModels = true;
      // Allow remote models to download on first use (will cache locally)
      env.allowRemoteModels = true;
      
      // Use a production-ready embedding model optimized for semantic search
      // 'Xenova/all-MiniLM-L6-v2' is a quantized version of sentence-transformers/all-MiniLM-L6-v2
      // It provides 384-dimensional embeddings with excellent semantic understanding
      console.log('Loading advanced embedding model: Xenova/all-MiniLM-L6-v2');
      console.log('This may take a moment on first run as the model downloads...');
      
      this.embeddingPipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { quantized: true }
      );
      this.embeddingModelLoaded = true;
      console.log('[✓] Advanced embedding model loaded successfully');
    } catch (error: any) {
      console.error('Failed to load embedding model:', error);
      console.error('Error details:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        name: error?.name || 'Unknown error type',
        toString: String(error)
      });
      console.warn('Falling back to simple embedding model');
      console.warn('Note: The advanced model may require internet connection on first use to download.');
      this.embeddingModelLoaded = false;
      // Continue with simple embedding model
    }
  }
  
  /**
   * Save database to disk
   */
  private saveDatabase(): void {
    if (!this.db) return;
    
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }
  
  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }
  
  /**
   * Generate embedding for text using transformers or fallback to simple model
   */
  private async generateEmbedding(text: string): Promise<Float32Array | null> {
    try {
      // Check cache first
      const cacheKey = text.substring(0, 500); // Use first 500 chars as cache key
      if (this.embeddingCache.has(cacheKey)) {
        return this.embeddingCache.get(cacheKey)!;
      }
      
      let embedding: Float32Array;
      
      // Use transformer model if available
      if (this.embeddingModelLoaded && this.embeddingPipeline) {
        try {
          const result = await this.embeddingPipeline(text, {
            pooling: 'mean',
            normalize: true,
          });
          
          // Convert to Float32Array
          const embeddingArray = Array.from(result.data) as number[];
          embedding = new Float32Array(embeddingArray);
        } catch (transformerError: any) {
          console.warn('Transformer embedding failed, using fallback:', transformerError.message);
          embedding = this.simpleTextEmbedding(text, 384);
        }
      } else {
        // Fallback to simple embedding
        embedding = this.simpleTextEmbedding(text, 384);
      }
      
      // Cache the embedding
      if (this.embeddingCache.size > 1000) {
        // Clear cache if too large
        const firstKey = this.embeddingCache.keys().next().value;
        if (firstKey !== undefined) {
          this.embeddingCache.delete(firstKey);
        }
      }
      this.embeddingCache.set(cacheKey, embedding);
      
      return embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return null;
    }
  }
  
  /**
   * Simple text embedding based on character frequencies and n-grams
   */
  private simpleTextEmbedding(text: string, dimensions: number): Float32Array {
    const embedding = new Float32Array(dimensions);
    const normalizedText = text.toLowerCase();
    
    // Character frequency features (first 26 dimensions for a-z)
    for (let i = 0; i < 26 && i < dimensions; i++) {
      const char = String.fromCharCode(97 + i); // a-z
      const count = (normalizedText.match(new RegExp(char, 'g')) || []).length;
      embedding[i] = count / normalizedText.length;
    }
    
    // Bigram features
    const words = normalizedText.split(/\s+/);
    for (let i = 0; i < words.length - 1 && 26 + i < dimensions; i++) {
      const bigram = words[i] + ' ' + words[i + 1];
      const hash = this.hashString(bigram);
      embedding[26 + (i % (dimensions - 26))] += hash;
    }
    
    // Word length features
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    if (dimensions > 50) {
      embedding[50] = avgWordLength / 10;
    }
    
    // Normalize the embedding vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }
  
  /**
   * Simple hash function for strings
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return (hash % 1000) / 1000; // Normalize to 0-1
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Build context from filesystem and git repo for RAG
   * Provides formatted, efficient context for AI agents
   */
  async buildRAGContext(
    queryText: string,
    agentId: string,
    projectPath: string | null,
    containerId?: string | null
  ): Promise<string> {
    if (!this.config.enabled || !this.db) return '';
    
    try {
      const contextParts: string[] = [];
      
      // 1. Get similar file chunks from filesystem (project files or container files)
      const similarFiles = await this.findSimilarFileChunks(
        queryText,
        projectPath,
        containerId || null,
        this.config.topK
      );
      
      console.log(`[RAG] Found ${similarFiles.length} similar file chunks for query: "${queryText.substring(0, 50)}..."`);
      
      if (similarFiles.length > 0) {
        contextParts.push('\n\n[RELEVANT PROJECT FILES]');
        contextParts.push('The following code excerpts from the project filesystem are semantically similar to your query and may help answer it:\n');
        
        let contextLength = contextParts.join('\n').length;
        for (let idx = 0; idx < similarFiles.length; idx++) {
          const chunk = similarFiles[idx];
          const relativePath = chunk.filePath.startsWith('/') 
            ? chunk.filePath.substring(1) 
            : chunk.filePath;
          
          // Calculate how much space this chunk would take
          const chunkPreview = `\n--- File: ${relativePath} (similarity: ${chunk.similarity.toFixed(2)}) ---\n${chunk.content.substring(0, 1200)}${chunk.content.length > 1200 ? '\n...' : ''}\n`;
          
          // Check if adding this chunk would exceed context limit
          if (contextLength + chunkPreview.length > this.MAX_CONTEXT_LENGTH) {
            contextParts.push(`\n... (${similarFiles.length - idx} more files available but truncated for context limit)`);
            break;
          }
          
          contextParts.push(chunkPreview);
          contextLength += chunkPreview.length;
        }
        
        contextParts.push('\n[END RELEVANT FILES]\n');
      }
      
      // 2. Get file tree structure if available
      const fileTree = await this.getFileTree(containerId || null, projectPath);
      if (fileTree && fileTree.length > 0) {
        contextParts.push('\n[PROJECT STRUCTURE]');
        contextParts.push('Directory structure of the project:\n');
        contextParts.push(this.formatFileTree(fileTree));
        contextParts.push('\n[END PROJECT STRUCTURE]\n');
      }
      
      // 3. Get comprehensive GitHub repo info if available
      const repoInfo = await this.getGitHubRepoInfo(containerId || null, projectPath);
      if (repoInfo) {
        contextParts.push('\n[GIT REPOSITORY INFORMATION]');
        if (repoInfo.remoteUrl) {
          contextParts.push(`Repository: ${repoInfo.remoteUrl}`);
        }
        if (repoInfo.branch) {
          contextParts.push(`Branch: ${repoInfo.branch}`);
        }
        if (repoInfo.lastCommit && repoInfo.lastCommitMessage) {
          contextParts.push(`Latest Commit: ${repoInfo.lastCommit.substring(0, 8)} - ${repoInfo.lastCommitMessage}`);
        }
        contextParts.push('\n[END GIT INFO]\n');
      }
      
      const finalContext = contextParts.join('\n');
      
      // Log context summary
      if (finalContext.length > 0) {
        console.log(`[RAG] Context built: ${similarFiles.length} files, ${fileTree?.length || 0} tree entries, ${finalContext.length} chars`);
      }
      
      return finalContext;
    } catch (error) {
      console.error('[RAG] Failed to build RAG context:', error);
      return '';
    }
  }
  
  /**
   * Format file tree for display
   */
  private formatFileTree(tree: FileTreeNode[], indent: string = ''): string {
    const lines: string[] = [];
    for (const node of tree) {
      const prefix = node.isDirectory ? '📁' : '📄';
      lines.push(`${indent}${prefix} ${node.path}`);
      if (node.isDirectory && node.children && node.children.length > 0) {
        lines.push(this.formatFileTree(node.children, indent + '  '));
      }
    }
    return lines.join('\n');
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
  }
  
  /**
   * Get current configuration
   */
  getConfig(): RAGConfig {
    return { ...this.config };
  }
  
  /**
   * Load configuration from file
   */
  private loadConfig(): void {
    try {
      const configPath = path.join(app.getPath('userData'), 'rag-config.json');
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        this.config = { ...this.config, ...JSON.parse(data) };
        console.log('RAG config loaded:', this.config);
      }
    } catch (error) {
      console.error('Failed to load RAG config:', error);
    }
  }
  
  /**
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      const configPath = path.join(app.getPath('userData'), 'rag-config.json');
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save RAG config:', error);
    }
  }
  
  /**
   * Get statistics about stored data
   */
  getStats(): any {
    if (!this.db) return null;
    
    try {
      const chunkCount = this.db.exec('SELECT COUNT(*) as count FROM file_chunks');
      const embeddingCount = this.db.exec('SELECT COUNT(*) as count FROM file_chunk_embeddings');
      const treeCount = this.db.exec('SELECT COUNT(*) as count FROM file_tree');
      const repoCount = this.db.exec('SELECT COUNT(*) as count FROM github_repo_info');
      
      return {
        totalChunks: chunkCount[0]?.values?.[0]?.[0] || 0,
        totalEmbeddings: embeddingCount[0]?.values?.[0]?.[0] || 0,
        totalTreeEntries: treeCount[0]?.values?.[0]?.[0] || 0,
        totalRepos: repoCount[0]?.values?.[0]?.[0] || 0,
        config: this.config
      };
    } catch (error) {
      console.error('Failed to get stats:', error);
      return null;
    }
  }
  
  /**
   * Check if files have been indexed for a project or container
   */
  private async hasIndexedFiles(projectPath: string | null, containerId: string | null): Promise<boolean> {
    if (!this.db) return false;
    
    try {
      let whereClause = '1=1';
      if (projectPath) {
        const projectPathEscaped = `'${projectPath.replace(/'/g, "''")}'`;
        whereClause += ` AND project_path = ${projectPathEscaped}`;
      } else {
        whereClause += ` AND project_path IS NULL`;
      }
      if (containerId) {
        const containerIdEscaped = `'${containerId.replace(/'/g, "''")}'`;
        whereClause += ` AND container_id = ${containerIdEscaped}`;
      } else {
        whereClause += ` AND container_id IS NULL`;
      }
      
      const results = this.db.exec(`
        SELECT COUNT(*) as count FROM file_chunks WHERE ${whereClause}
      `);
      
      if (results && results.length > 0 && results[0].values) {
        const count = results[0].values[0]?.[0] as number;
        return count > 0;
      }
      return false;
    } catch (error) {
      console.error('Failed to check indexed files:', error);
      return false;
    }
  }
  
  /**
   * Find similar file chunks using vector similarity search
   */
  async findSimilarFileChunks(
    queryText: string,
    projectPath: string | null,
    containerId: string | null,
    limit: number = 5
  ): Promise<SimilarFileChunk[]> {
    if (!this.db || !this.config.enabled) return [];
    
    try {
      // Generate embedding for query
      const queryEmbedding = await this.generateEmbedding(queryText);
      if (!queryEmbedding) return [];
      
      // Build WHERE clause
      let whereClause = '1=1';
      if (projectPath) {
        whereClause += ` AND project_path = '${projectPath.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND project_path IS NULL`;
      }
      if (containerId) {
        whereClause += ` AND container_id = '${containerId.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND container_id IS NULL`;
      }
      
      const results = this.db.exec(`
        SELECT 
          c.id,
          c.file_path,
          c.content,
          c.chunk_index,
          e.embedding
        FROM file_chunks c
        JOIN file_chunk_embeddings e ON c.id = e.chunk_id
        WHERE ${whereClause}
      `);
      
      if (!results || results.length === 0 || !results[0].values) {
        return [];
      }
      
      // Calculate similarity for each chunk
      const similarities: Array<SimilarFileChunk & { similarity: number }> = [];
      
      for (const row of results[0].values) {
        const chunkId = row[0] as number;
        const filePath = row[1] as string;
        const content = row[2] as string;
        const chunkIndex = row[3] as number;
        const embeddingStr = row[4] as string;
        
        try {
          const embeddingArray = JSON.parse(embeddingStr) as number[];
          const embedding = new Float32Array(embeddingArray);
          
          const similarity = this.cosineSimilarity(queryEmbedding, embedding);
          
          similarities.push({
            id: chunkId,
            filePath,
            content,
            similarity,
            chunkIndex
          });
        } catch (e) {
          // Skip invalid embeddings
          continue;
        }
      }
      
      // Sort by similarity and filter by threshold
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      return similarities
        .filter(chunk => chunk.similarity >= this.config.similarityThreshold)
        .slice(0, limit);
    } catch (error) {
      console.error('[RAG] Failed to find similar file chunks:', error);
      return [];
    }
  }
  
  /**
   * Split text into chunks with overlap
   */
  private splitIntoChunks(text: string): string[] {
    // Check file size - skip files that are too large
    if (text.length > this.MAX_FILE_SIZE) {
      console.warn(`[RAG] File too large to index (${text.length} bytes), skipping chunks`);
      return [];
    }
    
    // If text is smaller than chunk size, return as single chunk
    if (text.length <= this.CHUNK_SIZE) {
      return [text];
    }
    
    const chunks: string[] = [];
    let start = 0;
    let iterations = 0;
    
    while (start < text.length && iterations < this.MAX_CHUNKS) {
      const end = Math.min(start + this.CHUNK_SIZE, text.length);
      chunks.push(text.substring(start, end));
      
      // If we've reached the end, break
      if (end >= text.length) {
        break;
      }
      
      // Calculate next start position with overlap
      // Ensure we always make progress (nextStart > start)
      let nextStart = end - this.CHUNK_OVERLAP;
      
      // Safety check: ensure we always make progress
      // If overlap would cause us to go backwards or stay the same, just move forward
      if (nextStart <= start) {
        nextStart = start + 1; // Move forward by at least 1 character
      }
      
      // Ensure we don't exceed text length
      if (nextStart >= text.length) {
        break;
      }
      
      start = nextStart;
      iterations++;
    }
    
    if (iterations >= this.MAX_CHUNKS) {
      console.warn(`[RAG] File exceeded maximum chunks (${this.MAX_CHUNKS}), truncating`);
    }
    
    return chunks;
  }
  
  /**
   * Index files from a Docker container using git ls-files for proper .gitignore handling
   */
  async indexContainerFiles(containerId: string, workingDir: string = '/', statusCallback?: RAGStatusCallback): Promise<number> {
    if (!this.db) return 0;
    
    // Reset abort flag at start of indexing
    this.resetAbortFlag();
    
    const docker = new Docker();
    let indexedCount = 0;
    let processedCount = 0;
    const startTime = Date.now();
    
    try {
      const container = docker.getContainer(containerId);
      const containerInfo = await container.inspect();
      
      if (!containerInfo.State.Running) {
        console.warn(`[RAG] Container ${containerId} is not running, cannot index files`);
        return 0;
      }
      
      const logStatus = (message: string) => {
        console.log(`[RAG] ${message}`);
        if (statusCallback) {
          statusCallback(message);
        }
      };
      
      const clearStatus = () => {
        if (statusCallback) {
          statusCallback(null);
        }
      };
      
      logStatus(`Starting to index container files: ${containerId} (workingDir: ${workingDir})`);
      
      // Normalize working directory
      const normalizedWorkingDir = workingDir.endsWith('/') ? workingDir.slice(0, -1) : workingDir;
      
      // First, check if it's a git repository and get files using git ls-files
      // This properly respects .gitignore
      let files: string[] = [];
      let isGitRepo = false;
      
      try {
        // Check if git is available and if workingDir is a git repo
        const gitCheckExec = await container.exec({
          Cmd: ['git', '-C', normalizedWorkingDir, 'rev-parse', '--git-dir'],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: normalizedWorkingDir,
        });
        
        const gitCheckStream = await gitCheckExec.start({ hijack: true, stdin: false });
        let gitCheckOutput = '';
        
        gitCheckStream.on('data', (chunk: Buffer) => {
          const data = chunk.slice(8);
          gitCheckOutput += data.toString('utf8');
        });
        
        await new Promise<void>((resolve, reject) => {
          gitCheckStream.on('end', resolve);
          gitCheckStream.on('error', reject);
          setTimeout(() => reject(new Error('Timeout')), 5000);
        });
        
          if (gitCheckOutput.trim()) {
          isGitRepo = true;
          logStatus(`Detected git repository in container, using git ls-files`);
          
          // Use git ls-files to get all tracked files (respects .gitignore automatically)
          const gitLsExec = await container.exec({
            Cmd: ['git', '-C', normalizedWorkingDir, 'ls-files'],
            AttachStdout: true,
            AttachStderr: true,
            WorkingDir: normalizedWorkingDir,
          });
          
          const gitLsStream = await gitLsExec.start({ hijack: true, stdin: false });
          let gitLsOutput = '';
          
          gitLsStream.on('data', (chunk: Buffer) => {
            const data = chunk.slice(8);
            gitLsOutput += data.toString('utf8');
          });
          
          await new Promise<void>((resolve, reject) => {
            gitLsStream.on('end', resolve);
            gitLsStream.on('error', reject);
          });
          
          // Process git ls-files output
          files = gitLsOutput
            .split('\n')
            .map(line => {
              const trimmed = line.trim();
              if (!trimmed) return null;
              // Convert relative paths to absolute paths
              return trimmed.startsWith('/') 
                ? trimmed 
                : `${normalizedWorkingDir}/${trimmed}`;
            })
            .filter((f): f is string => f !== null && f.length > 0);
          
          logStatus(`git ls-files found ${files.length} files`);
        }
      } catch (err) {
        logStatus(`Not a git repository or git not available, using find fallback`);
        isGitRepo = false;
      }
      
      // Fallback: use find if not a git repo
      if (!isGitRepo || files.length === 0) {
        logStatus(`Using find command fallback`);
        
        const findExec = await container.exec({
          Cmd: ['find', normalizedWorkingDir, '-type', 'f'],
          AttachStdout: true,
          AttachStderr: true,
        });
        
        const findStream = await findExec.start({ hijack: true, stdin: false });
        let findOutput = '';
        
        findStream.on('data', (chunk: Buffer) => {
          const data = chunk.slice(8);
          findOutput += data.toString('utf8');
        });
        
        await new Promise<void>((resolve, reject) => {
          findStream.on('end', resolve);
          findStream.on('error', reject);
        });
        
        files = findOutput
          .split('\n')
          .map(line => line.trim())
          .filter(f => {
            if (!f || f.length === 0) return false;
            if (f.includes('\x00')) return false;
            if (!f.startsWith('/') && !f.startsWith('./') && !f.startsWith('.')) return false;
            // Always check common ignore patterns
            if (this.shouldIgnoreCommonPath(f)) return false;
            // Check if it's a text file
            return this.isTextFile(f);
          });
      }
      
      // Filter files to only include text files
      files = files.filter(filePath => {
        // Always check common ignore patterns
        if (this.shouldIgnoreCommonPath(filePath)) {
          return false;
        }
        // Check if it's a text file
        return this.isTextFile(filePath);
      });
      
      logStatus(`Found ${files.length} files to index in container`);
      
      // Index git repo info if it's a git repo
      if (isGitRepo) {
        await this.indexGitHubRepoInfoFromContainer(container, containerId, normalizedWorkingDir);
      }
      
      // Build file tree
      await this.buildFileTree(containerId, null, files, normalizedWorkingDir);
      
      // Read and index each file sequentially with rate limiting
      for (const filePath of files) {
        // Check if indexing should be aborted
        if (this.checkShouldAbort()) {
          logStatus('Indexing aborted by user');
          clearStatus();
          throw new Error('Indexing aborted');
        }
        
        try {
          const readExec = await container.exec({
            Cmd: ['cat', filePath],
            AttachStdout: true,
            AttachStderr: true,
          });
          
          const readStream = await readExec.start({ hijack: true, stdin: false });
          let content = '';
          let contentLength = 0;
          
          readStream.on('data', (chunk: Buffer) => {
            const data = chunk.slice(8);
            
            // Check for binary content (null bytes or excessive non-printable characters)
            const nullByteCount = (data.toString('binary').match(/\x00/g) || []).length;
            if (nullByteCount > data.length * 0.05) {
              // More than 5% null bytes - likely binary file
              readStream.destroy();
              throw new Error('Binary file detected (null bytes), skipping');
            }
            
            content += data.toString('utf8');
            contentLength += data.length;
            
            // Safety check: stop reading if file is too large
            if (contentLength > this.MAX_FILE_SIZE) {
              readStream.destroy();
              throw new Error(`File too large (${contentLength} bytes), skipping`);
            }
          });
          
          await new Promise<void>((resolve, reject) => {
            readStream.on('end', resolve);
            readStream.on('error', reject);
          });
          
          // Skip if content is empty or too large
          if (content.length === 0) {
            continue;
          }
          
          if (content.length > this.MAX_FILE_SIZE) {
            console.log(`[RAG] Skipping file too large (${(content.length / 1024 / 1024).toFixed(2)}MB): ${filePath}`);
            continue;
          }
          
          // Check if content is binary after reading
          if (this.isBinaryContent(content)) {
            console.log(`[RAG] Skipping binary file: ${filePath}`);
            continue;
          }
          
          // Use current time as last modified (we can't easily get file stats from container)
          await this.indexFileChunks(null, containerId, filePath, content, new Date(), statusCallback);
          indexedCount++;
          processedCount++;
          
          // Log progress every 10 files
          if (processedCount % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const rate = (processedCount / (Date.now() - startTime) * 1000).toFixed(1);
            logStatus(`Progress: ${processedCount}/${files.length} files indexed (${rate} files/sec, ${elapsed}s elapsed)`);
          }
          
          // Small delay every 50 files to prevent CPU overload
          if (processedCount % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms pause
          }
        } catch (err) {
          console.warn(`[RAG] Failed to index container file ${filePath}:`, err);
        }
      }
      
      logStatus(`Completed indexing ${indexedCount} files from container in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      
      this.saveDatabase();
      clearStatus();
      return indexedCount;
    } catch (error: any) {
      console.error('[RAG] Failed to index container files:', error);
      
      // Clear status on error
      const clearStatus = () => {
        if (statusCallback) {
          statusCallback(null);
        }
      };
      
      // If aborted, don't log as error
      if (error.message === 'Indexing aborted') {
        console.log('[RAG] Indexing aborted by user');
        clearStatus();
        throw error; // Re-throw to propagate abort status
      }
      
      clearStatus();
      return indexedCount;
    }
  }
  
  /**
   * Index GitHub repository information from container using git commands
   */
  private async indexGitHubRepoInfoFromContainer(
    container: Docker.Container,
    containerId: string,
    workingDir: string
  ): Promise<void> {
    if (!this.db) return;
    
    try {
      // Get remote URL
      let remoteUrl: string | null = null;
      try {
        const remoteExec = await container.exec({
          Cmd: ['git', '-C', workingDir, 'config', '--get', 'remote.origin.url'],
          AttachStdout: true,
          AttachStderr: true,
        });
        
        const remoteStream = await remoteExec.start({ hijack: true, stdin: false });
        let remoteOutput = '';
        
        remoteStream.on('data', (chunk: Buffer) => {
          const data = chunk.slice(8);
          remoteOutput += data.toString('utf8');
        });
        
        await new Promise<void>((resolve, reject) => {
          remoteStream.on('end', resolve);
          remoteStream.on('error', reject);
        });
        
        if (remoteOutput.trim()) {
          remoteUrl = remoteOutput.trim();
        }
      } catch (err) {
        // No remote configured
      }
      
      // Get current branch
      let branch: string | null = null;
      try {
        const branchExec = await container.exec({
          Cmd: ['git', '-C', workingDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
          AttachStdout: true,
          AttachStderr: true,
        });
        
        const branchStream = await branchExec.start({ hijack: true, stdin: false });
        let branchOutput = '';
        
        branchStream.on('data', (chunk: Buffer) => {
          const data = chunk.slice(8);
          branchOutput += data.toString('utf8');
        });
        
        await new Promise<void>((resolve, reject) => {
          branchStream.on('end', resolve);
          branchStream.on('error', reject);
        });
        
        if (branchOutput.trim()) {
          branch = branchOutput.trim();
        }
      } catch (err) {
        // No branch info
      }
      
      // Get last commit
      let lastCommit: string | null = null;
      let lastCommitMessage: string | null = null;
      try {
        const commitExec = await container.exec({
          Cmd: ['git', '-C', workingDir, 'log', '-1', '--pretty=format:%H|%s'],
          AttachStdout: true,
          AttachStderr: true,
        });
        
        const commitStream = await commitExec.start({ hijack: true, stdin: false });
        let commitOutput = '';
        
        commitStream.on('data', (chunk: Buffer) => {
          const data = chunk.slice(8);
          commitOutput += data.toString('utf8');
        });
        
        await new Promise<void>((resolve, reject) => {
          commitStream.on('end', resolve);
          commitStream.on('error', reject);
        });
        
        if (commitOutput.trim()) {
          const parts = commitOutput.trim().split('|');
          if (parts.length >= 1) {
            lastCommit = parts[0];
          }
          if (parts.length >= 2) {
            lastCommitMessage = parts.slice(1).join('|');
          }
        }
      } catch (err) {
        // No commits
      }
      
      // Insert or update repo info
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO github_repo_info 
        (container_id, project_path, remote_url, branch, last_commit, last_commit_message, last_indexed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        containerId,
        null, // projectPath is null for container-based repos
        remoteUrl,
        branch,
        lastCommit,
        lastCommitMessage,
        new Date().toISOString()
      ]);
      
      stmt.free();
      this.saveDatabase();
      
      console.log(`[RAG] Indexed git repo info for container ${containerId}: ${branch || 'unknown branch'}`);
    } catch (error) {
      console.error('[RAG] Failed to index GitHub repo info from container:', error);
    }
  }
  
  /**
   * Build file tree structure from list of file paths
   */
  private async buildFileTree(
    containerId: string | null,
    projectPath: string | null,
    files: string[],
    basePath: string
  ): Promise<void> {
    if (!this.db) return;
    
    try {
      // Clear existing tree entries for this container/project
      let whereClause = '1=1';
      if (containerId) {
        whereClause += ` AND container_id = '${containerId.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND container_id IS NULL`;
      }
      if (projectPath) {
        whereClause += ` AND project_path = '${projectPath.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND project_path IS NULL`;
      }
      
      this.db.exec(`DELETE FROM file_tree WHERE ${whereClause}`);
      
      // Build tree structure
      const treeMap = new Map<string, FileTreeNode>();
      const directories = new Set<string>();
      
      // Normalize base path
      const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
      
      for (const filePath of files) {
        // Normalize path relative to base
        const relativePath = filePath.startsWith(normalizedBase)
          ? filePath.substring(normalizedBase.length + 1)
          : filePath.startsWith('/')
            ? filePath.substring(1)
            : filePath;
        
        const parts = relativePath.split('/').filter(Boolean);
        
        // Build directory structure
        let currentPath = '';
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const parentPath = currentPath;
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          
          if (i < parts.length - 1) {
            // Directory
            directories.add(currentPath);
            if (!treeMap.has(currentPath)) {
              treeMap.set(currentPath, {
                path: part,
                isDirectory: true,
                children: []
              });
            }
          } else {
            // File
            const parent = parentPath ? treeMap.get(parentPath) : null;
            if (parent && parent.children) {
              // Check if file already added
              if (!parent.children.find(c => c.path === part && !c.isDirectory)) {
                parent.children.push({
                  path: part,
                  isDirectory: false
                });
              }
            } else {
              // Root level file
              if (!treeMap.has(part)) {
                treeMap.set(part, {
                  path: part,
                  isDirectory: false
                });
              }
            }
          }
        }
      }
      
      // Insert into database
      const timestamp = new Date().toISOString();
      const insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO file_tree (container_id, project_path, file_path, is_directory, parent_path, last_indexed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      // Insert directories
      for (const dirPath of directories) {
        const parts = dirPath.split('/');
        const dirName = parts[parts.length - 1];
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
        
        insertStmt.run([
          containerId || null,
          projectPath || null,
          dirPath,
          1, // is_directory = true
          parentPath || null,
          timestamp
        ]);
      }
      
      // Insert files
      for (const filePath of files) {
        const relativePath = filePath.startsWith(normalizedBase)
          ? filePath.substring(normalizedBase.length + 1)
          : filePath.startsWith('/')
            ? filePath.substring(1)
            : filePath;
        
        const parts = relativePath.split('/').filter(Boolean);
        const fileName = parts[parts.length - 1];
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
        
        insertStmt.run([
          containerId || null,
          projectPath || null,
          relativePath,
          0, // is_directory = false
          parentPath || null,
          timestamp
        ]);
      }
      
      insertStmt.free();
      this.saveDatabase();
      
      console.log(`[RAG] Built file tree: ${directories.size} directories, ${files.length} files`);
    } catch (error) {
      console.error('[RAG] Failed to build file tree:', error);
    }
  }
  
  /**
   * Get file tree structure
   */
  private async getFileTree(containerId: string | null, projectPath: string | null): Promise<FileTreeNode[] | null> {
    if (!this.db) return null;
    
    try {
      let whereClause = '1=1';
      if (containerId) {
        whereClause += ` AND container_id = '${containerId.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND container_id IS NULL`;
      }
      if (projectPath) {
        whereClause += ` AND project_path = '${projectPath.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND project_path IS NULL`;
      }
      
      const results = this.db.exec(`
        SELECT file_path, is_directory, parent_path
        FROM file_tree
        WHERE ${whereClause}
        ORDER BY file_path
      `);
      
      if (!results || results.length === 0 || !results[0].values) {
        return null;
      }
      
      // Build tree structure
      const treeMap = new Map<string, FileTreeNode>();
      const rootNodes: FileTreeNode[] = [];
      
      for (const row of results[0].values) {
        const filePath = row[0] as string;
        const isDirectory = (row[1] as number) === 1;
        const parentPath = row[2] as string | null;
        
        const parts = filePath.split('/').filter(Boolean);
        const name = parts[parts.length - 1];
        
        const node: FileTreeNode = {
          path: name,
          isDirectory,
          children: isDirectory ? [] : undefined
        };
        
        treeMap.set(filePath, node);
        
        if (!parentPath) {
          rootNodes.push(node);
        } else {
          const parent = treeMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(node);
          } else {
            rootNodes.push(node);
          }
        }
      }
      
      return rootNodes.length > 0 ? rootNodes : null;
    } catch (error) {
      console.error('[RAG] Failed to get file tree:', error);
      return null;
    }
  }
  
  /**
   * Abort current indexing operation
   */
  abortIndexing(): void {
    this.shouldAbortIndexing = true;
    console.log('[RAG] Abort signal received, indexing will stop after current file');
  }
  
  /**
   * Reset abort flag (called at start of indexing)
   */
  private resetAbortFlag(): void {
    this.shouldAbortIndexing = false;
  }
  
  /**
   * Check if indexing should be aborted
   */
  private checkShouldAbort(): boolean {
    return this.shouldAbortIndexing;
  }
  
  /**
   * Check if a file should be indexed based on extension
   */
  private isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    
    // Check if it's a binary/image extension
    if (this.BINARY_EXTENSIONS.includes(ext)) {
      return false;
    }
    
    // Check if it's a known text extension
    if (this.TEXT_EXTENSIONS.includes(ext)) {
      return true;
    }
    
    // Files without extensions might be text (like README, LICENSE, etc.)
    // But we'll be conservative and only index them if they're common text files
    const basename = path.basename(filePath).toLowerCase();
    const commonTextFiles = ['readme', 'license', 'changelog', 'authors', 'contributors', 'makefile', 'dockerfile'];
    if (commonTextFiles.some(name => basename.includes(name))) {
      return true;
    }
    
    // If no extension and not a common text file, skip it
    if (!ext) {
      return false;
    }
    
    // Unknown extensions - assume binary for safety
    return false;
  }
  
  /**
   * Check if content appears to be binary
   */
  private isBinaryContent(content: string, sampleSize: number = 8192): boolean {
    // Check for null bytes
    if (content.includes('\x00')) {
      return true;
    }
    
    // Sample the content to check for binary patterns
    const sample = content.substring(0, Math.min(sampleSize, content.length));
    
    // Count non-printable characters (excluding common whitespace)
    const nonPrintable = /[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g;
    const matches = sample.match(nonPrintable);
    
    // If more than 5% of characters are non-printable, it's likely binary
    if (matches && matches.length > sample.length * 0.05) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if a path should be ignored based on common patterns (always applied)
   */
  private shouldIgnoreCommonPath(relativePath: string): boolean {
    const parts = relativePath.split(/[/\\]/);
    
    // Always ignore common build/dependency directories
    const alwaysIgnore = [
      'node_modules',
      'dist',
      'build',
      '.next',
      '.git',
      '.DS_Store',
      'coverage',
      '.nyc_output',
      '.cache',
      '.parcel-cache',
      '.turbo',
      '.vercel',
      'vendor',
      '__pycache__',
      '.pytest_cache',
      '.mypy_cache',
      '.venv',
      'venv',
      'env',
      '.env',
      'target', // Rust
      'out', // Various build outputs
      '.idea', // JetBrains IDEs
      '.vscode', // VS Code
      '.sublime-project',
      '.sublime-workspace',
    ];

    return parts.some(part => alwaysIgnore.includes(part));
  }
  
  /**
   * Index file chunks and their embeddings
   */
  private async indexFileChunks(
    projectPath: string | null,
    containerId: string | null,
    filePath: string,
    content: string,
    lastModified: Date,
    statusCallback?: RAGStatusCallback
  ): Promise<void> {
    if (!this.db) return;
    
    try {
      // Clean file path - remove any null bytes or control characters that might cause SQL issues
      const cleanFilePath = filePath.replace(/\x00/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '');
      
      // Escape values for SQL (sql.js doesn't support parameterized queries in exec)
      const projectPathEscaped = projectPath ? `'${projectPath.replace(/'/g, "''")}'` : 'NULL';
      const containerIdEscaped = containerId ? `'${containerId.replace(/'/g, "''")}'` : 'NULL';
      // Escape file path properly - replace single quotes
      const filePathEscaped = `'${cleanFilePath.replace(/'/g, "''")}'`;
      
      // Get existing chunk IDs using exec (sql.js pattern)
      const existingChunks = this.db.exec(`
        SELECT id FROM file_chunks
        WHERE (project_path = ${projectPathEscaped} OR (${projectPathEscaped} IS NULL AND project_path IS NULL))
          AND (container_id = ${containerIdEscaped} OR (${containerIdEscaped} IS NULL AND container_id IS NULL))
          AND file_path = ${filePathEscaped}
      `);
      
      // Get existing chunk IDs
      const chunkIds: number[] = [];
      if (existingChunks && existingChunks.length > 0 && existingChunks[0].values) {
        for (const row of existingChunks[0].values) {
          const chunkId = row[0] as number;
          if (chunkId) chunkIds.push(chunkId);
        }
      }
      
      // Delete existing embeddings and chunks
      if (chunkIds.length > 0) {
        const deleteEmbedStmt = this.db.prepare('DELETE FROM file_chunk_embeddings WHERE chunk_id = ?');
        const deleteChunkStmt = this.db.prepare('DELETE FROM file_chunks WHERE id = ?');
        
        for (const chunkId of chunkIds) {
          deleteEmbedStmt.run([chunkId]);
          deleteChunkStmt.run([chunkId]);
        }
        
        deleteEmbedStmt.free();
        deleteChunkStmt.free();
      }
      
      // Split content into chunks
      const chunks = this.splitIntoChunks(content);
      
      if (chunks.length > 10) {
        const statusMsg = `Processing file with ${chunks.length} chunks: ${cleanFilePath}`;
        console.log(`[RAG] ${statusMsg}`);
        if (statusCallback) {
          statusCallback(statusMsg);
        }
      }
      
      // Insert chunks and generate embeddings sequentially
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const timestamp = lastModified.toISOString();
        
        // Insert chunk using prepared statement
        const insertStmt = this.db.prepare(`
          INSERT INTO file_chunks (project_path, container_id, file_path, content, chunk_index, last_modified, embedding_dimension)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        insertStmt.run([
          projectPath || null,
          containerId || null,
          cleanFilePath,
          chunk,
          i,
          timestamp,
          384
        ]);
        
        insertStmt.free();
        
        // Get the inserted chunk ID
        const result = this.db.exec('SELECT last_insert_rowid() as id;');
        const chunkId = result[0]?.values[0]?.[0] as number;
        
        // Generate and store embedding (this is CPU-intensive)
        const embeddingStartTime = Date.now();
        const embedding = await this.generateEmbedding(chunk);
        const embeddingTime = Date.now() - embeddingStartTime;
        
        if (embeddingTime > 1000 && chunks.length > 1) {
          const statusMsg = `Slow embedding generation: ${embeddingTime}ms for chunk ${i + 1}/${chunks.length} of ${cleanFilePath}`;
          console.log(`[RAG] ${statusMsg}`);
          if (statusCallback) {
            statusCallback(statusMsg);
          }
        }
        
        if (embedding) {
          const embeddingArray = Array.from(embedding);
          const embeddingStr = JSON.stringify(embeddingArray);
          
          const embedStmt = this.db.prepare(`
            INSERT INTO file_chunk_embeddings (chunk_id, embedding)
            VALUES (?, ?)
          `);
          
          embedStmt.run([chunkId, embeddingStr]);
          embedStmt.free();
        }
      }
      
      // Don't save database here - let caller save after batches to improve performance
    } catch (error) {
      console.error('[RAG] Failed to index file chunks:', error);
      console.error('[RAG] Error details:', {
        filePath,
        projectPath,
        containerId,
        contentLength: content.length,
        message: (error as any)?.message || 'Unknown error',
        stack: (error as any)?.stack || 'No stack trace'
      });
    }
  }
  
  /**
   * Index GitHub repository information (for local projects)
   */
  async indexGitHubRepoInfo(projectPath: string): Promise<void> {
    if (!this.db || !fs.existsSync(projectPath)) return;
    
    try {
      const git = simpleGit(projectPath);
      
      // Check if it's a git repository
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return;
      
      // Get remote URL
      let remoteUrl: string | null = null;
      try {
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        if (origin) {
          remoteUrl = origin.refs.fetch || origin.refs.push || null;
        }
      } catch (err) {
        // No remote configured
      }
      
      // Get current branch
      let branch: string | null = null;
      try {
        const branchSummary = await git.branchLocal();
        branch = branchSummary.current || null;
      } catch (err) {
        // No branch info
      }
      
      // Get last commit
      let lastCommit: string | null = null;
      let lastCommitMessage: string | null = null;
      try {
        const log = await git.log({ maxCount: 1 });
        if (log.latest) {
          lastCommit = log.latest.hash;
          lastCommitMessage = log.latest.message;
        }
      } catch (err) {
        // No commits
      }
      
      // Insert or update repo info
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO github_repo_info 
        (container_id, project_path, remote_url, branch, last_commit, last_commit_message, last_indexed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        null, // containerId is null for local projects
        projectPath,
        remoteUrl,
        branch,
        lastCommit,
        lastCommitMessage,
        new Date().toISOString()
      ]);
      
      stmt.free();
      this.saveDatabase();
    } catch (error) {
      console.error('[RAG] Failed to index GitHub repo info:', error);
    }
  }
  
  /**
   * Get GitHub repository information
   */
  async getGitHubRepoInfo(containerId: string | null, projectPath: string | null): Promise<GitHubRepoInfo | null> {
    if (!this.db) return null;
    
    try {
      let whereClause = '1=1';
      if (containerId) {
        whereClause += ` AND container_id = '${containerId.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND container_id IS NULL`;
      }
      if (projectPath) {
        whereClause += ` AND project_path = '${projectPath.replace(/'/g, "''")}'`;
      } else {
        whereClause += ` AND project_path IS NULL`;
      }
      
      const results = this.db.exec(`
        SELECT container_id, project_path, remote_url, branch, last_commit, last_commit_message, last_indexed
        FROM github_repo_info
        WHERE ${whereClause}
        LIMIT 1
      `);
      
      if (!results || results.length === 0 || !results[0].values) {
        return null;
      }
      
      const row = results[0].values[0];
      return {
        containerId: row[0] as string | null,
        projectPath: row[1] as string | null,
        remoteUrl: row[2] as string | null,
        branch: row[3] as string | null,
        lastCommit: row[4] as string | null,
        lastCommitMessage: row[5] as string | null,
        lastIndexed: new Date(row[6] as string)
      };
    } catch (error) {
      console.error('[RAG] Failed to get GitHub repo info:', error);
      return null;
    }
  }
  
  /**
   * Index files from a project directory (for local filesystem projects)
   */
  async indexProjectFiles(projectPath: string, fileExtensions?: string[], statusCallback?: RAGStatusCallback): Promise<number> {
    if (!this.db || !fs.existsSync(projectPath)) return 0;
    
    // Reset abort flag at start of indexing
    this.resetAbortFlag();
    
    // Note: fileExtensions parameter is kept for API compatibility but we use TEXT_EXTENSIONS instead
    let indexedCount = 0;
    let processedCount = 0;
    const startTime = Date.now();
    
    try {
      const logStatus = (message: string) => {
        console.log(`[RAG] ${message}`);
        if (statusCallback) {
          statusCallback(message);
        }
      };
      
      const clearStatus = () => {
        if (statusCallback) {
          statusCallback(null);
        }
      };
      
      // Use git ls-files if it's a git repo (respects .gitignore automatically)
      let files: string[] = [];
      let isGitRepo = false;
      
      try {
        const git = simpleGit(projectPath);
        const isRepo = await git.checkIsRepo();
        
        if (isRepo) {
          isGitRepo = true;
          logStatus(`Detected git repository, using git ls-files`);
          
          const gitFiles = await git.raw(['ls-files']);
          files = gitFiles
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => path.join(projectPath, line));
          
          logStatus(`git ls-files found ${files.length} files`);
        }
      } catch (err) {
        logStatus(`Not a git repository or git not available, using filesystem walk`);
      }
      
      // Fallback: walk filesystem
      if (!isGitRepo || files.length === 0) {
        const filesToIndex: Array<{ path: string; relativePath: string; mtime: Date }> = [];
        
        const walkDir = (dir: string): void => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(projectPath, fullPath);
            
            // Always check common ignore patterns first
            if (this.shouldIgnoreCommonPath(relativePath)) {
              continue;
            }
            
            if (entry.isDirectory()) {
              walkDir(fullPath);
            } else if (entry.isFile()) {
              // Check if it's a text file
              if (this.isTextFile(fullPath)) {
                try {
                  const stats = fs.statSync(fullPath);
                  // Check file size before adding to list
                  if (stats.size <= this.MAX_FILE_SIZE) {
                    filesToIndex.push({ path: fullPath, relativePath, mtime: stats.mtime });
                  }
                } catch (err) {
                  console.warn(`[RAG] Failed to stat file ${fullPath}:`, err);
                }
              }
            }
          }
        };
        
        walkDir(projectPath);
        files = filesToIndex.map(f => f.path);
      } else {
        // Filter git files to only include text files and check size
        files = files.filter(filePath => {
          if (!this.isTextFile(filePath)) {
            return false;
          }
          try {
            const stats = fs.statSync(filePath);
            return stats.size <= this.MAX_FILE_SIZE;
          } catch {
            return false;
          }
        });
      }
      
      logStatus(`Found ${files.length} files to index`);
      
      // Build file tree
      await this.buildFileTree(null, projectPath, files, projectPath);
      
      // Process files sequentially with rate limiting to avoid CPU spikes
      for (const filePath of files) {
        // Check if indexing should be aborted
        if (this.checkShouldAbort()) {
          logStatus('Indexing aborted by user');
          const clearStatus = () => {
            if (statusCallback) {
              statusCallback(null);
            }
          };
          clearStatus();
          throw new Error('Indexing aborted');
        }
        
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Skip if file is too large
          if (content.length > this.MAX_FILE_SIZE) {
            console.log(`[RAG] Skipping large file (${(content.length / 1024 / 1024).toFixed(2)}MB): ${filePath}`);
            continue;
          }
          
          // Check if content is binary
          if (this.isBinaryContent(content)) {
            console.log(`[RAG] Skipping binary file: ${filePath}`);
            continue;
          }
          
          // Process file with await to ensure sequential processing
          const stats = fs.statSync(filePath);
          await this.indexFileChunks(projectPath, null, filePath, content, stats.mtime, statusCallback);
          indexedCount++;
          processedCount++;
          
          // Log progress every 10 files
          if (processedCount % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const rate = (processedCount / (Date.now() - startTime) * 1000).toFixed(1);
            logStatus(`Progress: ${processedCount}/${files.length} files indexed (${rate} files/sec, ${elapsed}s elapsed)`);
          }
          
          // Small delay every 50 files to prevent CPU overload
          if (processedCount % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms pause
          }
        } catch (err) {
          console.warn(`[RAG] Failed to index file ${filePath}:`, err);
        }
      }
      
      logStatus(`Completed indexing ${indexedCount} files in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      
      // Also index GitHub repo info
      if (isGitRepo) {
        await this.indexGitHubRepoInfo(projectPath);
      }
      
      this.saveDatabase();
      clearStatus();
      return indexedCount;
    } catch (error: any) {
      console.error('[RAG] Failed to index project files:', error);
      
      // Clear status on error
      const clearStatus = () => {
        if (statusCallback) {
          statusCallback(null);
        }
      };
      
      // If aborted, don't log as error
      if (error.message === 'Indexing aborted') {
        console.log('[RAG] Indexing aborted by user');
        clearStatus();
        throw error; // Re-throw to propagate abort status
      }
      
      clearStatus();
      return indexedCount;
    }
  }
  
  /**
   * Clear all RAG data
   */
  clearAll(): void {
    if (!this.db) return;
    
    try {
      console.log('[RAG] Clearing all RAG data...');
      
      // Clear all file chunk embeddings
      this.db.exec('DELETE FROM file_chunk_embeddings');
      
      // Clear all file chunks
      this.db.exec('DELETE FROM file_chunks');
      
      // Clear file tree
      this.db.exec('DELETE FROM file_tree');
      
      // Clear all GitHub repo info
      this.db.exec('DELETE FROM github_repo_info');
      
      // Clear embedding cache
      this.embeddingCache.clear();
      
      // Save database to disk
      this.saveDatabase();
      
      console.log('[RAG] [✓] All RAG data cleared successfully');
    } catch (error) {
      console.error('[RAG] Failed to clear all RAG data:', error);
      throw error;
    }
  }
  
  /**
   * Clear file chunks for a project or container
   */
  clearFileChunks(projectPath?: string | null, containerId?: string | null): void {
    if (!this.db) return;
    
    try {
      let whereClause = '1=1';
      if (projectPath !== undefined) {
        const projectPathEscaped = projectPath ? `'${projectPath.replace(/'/g, "''")}'` : 'NULL';
        whereClause += ` AND project_path = ${projectPathEscaped}`;
      }
      if (containerId !== undefined) {
        const containerIdEscaped = containerId ? `'${containerId.replace(/'/g, "''")}'` : 'NULL';
        whereClause += ` AND container_id = ${containerIdEscaped}`;
      }
      
      // Get chunk IDs to delete embeddings
      const chunkIds = this.db.exec(`
        SELECT id FROM file_chunks WHERE ${whereClause}
      `);
      
      if (chunkIds && chunkIds.length > 0 && chunkIds[0].values) {
        const deleteStmt = this.db.prepare('DELETE FROM file_chunk_embeddings WHERE chunk_id = ?');
        for (const row of chunkIds[0].values) {
          const chunkId = row[0] as number;
          deleteStmt.run([chunkId]);
        }
        deleteStmt.free();
      }
      
      // Delete chunks
      this.db.exec(`DELETE FROM file_chunks WHERE ${whereClause}`);
      
      // Delete file tree entries
      this.db.exec(`DELETE FROM file_tree WHERE ${whereClause.replace('project_path', 'project_path').replace('container_id', 'container_id')}`);
      
      this.saveDatabase();
    } catch (error) {
      console.error('[RAG] Failed to clear file chunks:', error);
    }
  }
  
  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.saveDatabase();
      this.db.close();
      this.db = null;
    }
  }
}
