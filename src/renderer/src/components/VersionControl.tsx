import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { StatusResult, FileStatusResult } from 'simple-git';

const socket = io('http://localhost:3002');

interface CustomFileStatusResult extends FileStatusResult {
  staged_insertions: number;
  staged_deletions: number;
  unstaged_insertions: number;
  unstaged_deletions: number;
}

interface Stash {
  hash: string;
  message: string;
}

interface CustomStatusResult extends StatusResult {
  files: CustomFileStatusResult[];
  branches: string[];
  stashes: Stash[];
}

interface VersionControlProps {
  projectPath: string;
}

const VersionControl: React.FC<VersionControlProps> = ({ projectPath }) => {
  const [status, setStatus] = useState<CustomStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showCommitUI, setShowCommitUI] = useState(false);

  useEffect(() => {
    socket.emit('getGitStatus', projectPath);

    socket.on('gitStatus', (data: CustomStatusResult) => {
      setStatus(data);
      setError(null);
    });

    socket.on('gitError', (errorMessage: string) => {
      setError(errorMessage);
    });
    
    socket.on('commitMessage', (message: string) => {
      setCommitMessage(message);
    });

    return () => {
      socket.off('gitStatus');
      socket.off('gitError');
      socket.off('commitMessage');
    };
  }, [projectPath]);

  const handleStageFile = (file: string) => socket.emit('stageFile', { projectPath, file });
  const handleUnstageFile = (file: string) => socket.emit('unstageFile', { projectPath, file });
  const handleStageAll = () => socket.emit('stageAll', projectPath);
  const handleUnstageAll = () => socket.emit('unstageAll', projectPath);
  const handleFetch = () => socket.emit('fetch', projectPath);
  const handleGenerateSummary = () => socket.emit('generateCommitMessage', projectPath);
  const handlePush = () => socket.emit('push', projectPath);
  const handleBranchChange = (branch: string) => socket.emit('checkoutBranch', { projectPath, branch });
  const handleStash = () => socket.emit('stash', projectPath);
  const handleApplyStash = (stashIndex: number) => socket.emit('applyStash', { projectPath, stash: `stash@{${stashIndex}}` });
  const handlePopStash = () => socket.emit('popStash', projectPath);
  const handleDropStash = (stashIndex: number) => socket.emit('dropStash', { projectPath, stash: `stash@{${stashIndex}}` });

  const handleCommit = () => {
    if (commitMessage.trim()) {
      socket.emit('commitChanges', { projectPath, message: commitMessage });
      setCommitMessage('');
    }
  };
  
  const handleCreateBranch = () => {
    if (newBranchName.trim()) {
      socket.emit('createBranch', { projectPath, branchName: newBranchName });
      setNewBranchName('');
      setShowNewBranchModal(false);
    }
  };

  const getFileStatus = (filePath: string) => {
    return status?.files.find(f => f.path === filePath);
  };

  const hasModifiedFiles = status && (status.modified.length > 0 || status.not_added.length > 0);
  const hasStagedFiles = status && status.staged.length > 0;
  const isAheadRemote = status && status.ahead > 0;
  const hasStashes = status && status.stashes.length > 0;

  return (
    <div className="bg-white rounded-xl p-6">
      <h2>Version Control</h2>
      <div>
        <select value={status?.current || ''} onChange={(e) => handleBranchChange(e.target.value)}>
          {status?.branches.map(branch => (
            <option key={branch} value={branch}>{branch}</option>
          ))}
        </select>
        <button onClick={handleFetch}>Fetch</button>
        {hasModifiedFiles && <button onClick={handleStageAll}>Stage All</button>}
        {hasStagedFiles && <button onClick={handleUnstageAll}>Unstage All</button>}
        {hasStagedFiles && <button onClick={handleStash}>Stash</button>}
        {hasStashes && <button onClick={handlePopStash}>Pop Stash</button>}
        {hasStagedFiles && <button onClick={() => setShowCommitUI(!showCommitUI)}>Commit</button>}
      </div>
      <div className="flex items-center space-x-2 p-6">
        <button onClick={() => setShowNewBranchModal(true)}>New Branch</button>
        <div>
          {showNewBranchModal && (
            <div>
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="New branch name"
              />
              <button onClick={handleCreateBranch}>Submit</button>
              <button onClick={() => setShowNewBranchModal(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {status && (
        <div>
          {showCommitUI && hasStagedFiles && (
            <div>
              <p>Commit changes to branch: {status.current}</p>
              <button onClick={handleGenerateSummary}>Generate Summary</button>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message"
              />
              <button onClick={handleCommit}>Submit</button>
              {isAheadRemote && <button onClick={handlePush}>Push</button>}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th colSpan={4} style={{ textAlign: 'left', padding: '8px', backgroundColor: '#f2f2f2' }}>Staged Files</th>
              </tr>
              <tr>
                <th></th>
                <th>Added</th>
                <th>Removed</th>
                <th></th>
              </tr>
              {status.staged.map((file) => {
                const fileStatus = getFileStatus(file);
                return (
                  <tr key={file}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{file}</td>
                    <td style={{ color: 'green', padding: '8px', borderBottom: '1px solid #ddd' }}>+{fileStatus?.staged_insertions}</td>
                    <td style={{ color: 'red', padding: '8px', borderBottom: '1px solid #ddd' }}>-{fileStatus?.staged_deletions}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><button onClick={() => handleUnstageFile(file)}>Unstage</button></td>
                  </tr>
                );
              })}
              <tr><td colSpan={4}>&nbsp;</td></tr>
              <tr>
                <th colSpan={4} style={{ textAlign: 'left', padding: '8px', backgroundColor: '#f2f2f2' }}>Modified Files</th>
              </tr>
              <tr>
                <th></th>
                <th>Added</th>
                <th>Removed</th>
                <th></th>
              </tr>
              {status.modified.map((file) => {
                const fileStatus = getFileStatus(file);
                if (fileStatus?.unstaged_insertions === 0 && fileStatus?.unstaged_deletions === 0) {
                  return null;
                }
                return (
                  <tr key={file}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{file}</td>
                    <td style={{ color: 'green', padding: '8px', borderBottom: '1px solid #ddd' }}>+{fileStatus?.unstaged_insertions}</td>
                    <td style={{ color: 'red', padding: '8px', borderBottom: '1px solid #ddd' }}>-{fileStatus?.unstaged_deletions}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><button onClick={() => handleStageFile(file)}>Stage</button></td>
                  </tr>
                );
              })}
              <tr><td colSpan={4}>&nbsp;</td></tr>
              <tr>
                <th colSpan={4} style={{ textAlign: 'left', padding: '8px', backgroundColor: '#f2f2f2' }}>Untracked Files</th>
              </tr>
              {status.not_added.map((file) => (
                <tr key={file}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{file}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}></td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}></td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><button onClick={() => handleStageFile(file)}>Stage</button></td>
                </tr>
              ))}
              <tr><td colSpan={4}>&nbsp;</td></tr>
              <tr>
                <th colSpan={4} style={{ textAlign: 'left', padding: '8px', backgroundColor: '#f2f2f2' }}>Stashed</th>
              </tr>
              {status.stashes.map((stash: Stash, index: number) => (
                <tr key={stash.hash}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{`stash@{${index}}`}: {stash.message}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}></td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><button onClick={() => handleApplyStash(index)}>Apply</button></td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><button onClick={() => handleDropStash(index)}>Drop</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default VersionControl;
