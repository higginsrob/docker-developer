import React, { useState } from 'react';

interface JSONExplorerProps {
  data: any;
  level?: number;
  path?: string;
}

const JSONExplorer: React.FC<JSONExplorerProps> = ({ data, level = 0, path = 'root' }) => {
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});

  const toggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderValue = (value: any, currentPath: string, currentLevel: number): React.ReactNode => {
    const indent = currentLevel * 20;
    
    if (value === null) {
      return <span className="json-null">null</span>;
    }
    
    if (value === undefined) {
      return <span className="json-undefined">undefined</span>;
    }
    
    if (typeof value === 'boolean') {
      return <span className="json-boolean">{value.toString()}</span>;
    }
    
    if (typeof value === 'number') {
      return <span className="json-number">{value}</span>;
    }
    
    if (typeof value === 'string') {
      return <span className="json-string">"{value}"</span>;
    }
    
    if (Array.isArray(value)) {
      const isExpanded = expanded[currentPath];
      
      return (
        <div className="json-array">
          <span 
            className="json-toggle"
            onClick={() => toggleExpand(currentPath)}
            style={{ cursor: 'pointer', marginLeft: `${indent}px` }}
          >
            {isExpanded ? '▼' : '▶'} [{value.length}]
          </span>
          {isExpanded && (
            <div style={{ marginLeft: `${indent + 20}px` }}>
              {value.map((item, index) => (
                <div key={`${currentPath}[${index}]`}>
                  {renderValue(item, `${currentPath}[${index}]`, currentLevel + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    
    if (typeof value === 'object') {
      const isExpanded = expanded[currentPath];
      const keys = Object.keys(value);
      
      return (
        <div className="json-object">
          <span 
            className="json-toggle"
            onClick={() => toggleExpand(currentPath)}
            style={{ cursor: 'pointer', marginLeft: `${indent}px` }}
          >
            {isExpanded ? '▼' : '▶'} {'{'} {keys.length} key{keys.length !== 1 ? 's' : ''} {'}'}
          </span>
          {isExpanded && (
            <div style={{ marginLeft: `${indent + 20}px` }}>
              {keys.map(k => {
                const childPath = `${currentPath}.${k}`;
                return (
                  <div key={childPath} className="json-entry">
                    <span className="json-key">{k}:</span>{' '}
                    {renderValue(value[k], childPath, currentLevel + 1)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    
    return <span>{String(value)}</span>;
  };

  return (
    <div className="json-explorer">
      {renderValue(data, path, level)}
    </div>
  );
};

export default JSONExplorer;

