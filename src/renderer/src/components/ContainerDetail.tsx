import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:3002');

interface ContainerDetailProps {
  container: { Id: string; Names: string[] };
  onClose: () => void;
}

const ContainerDetail: React.FC<ContainerDetailProps> = ({ container, onClose }) => {
  const [details, setDetails] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    socket.emit('getContainerDetails', container.Id);
    socket.on('containerDetails', (data) => setDetails(data));

    socket.emit('streamContainerLogs', container.Id);
    socket.on('containerLog', (log) => {
      setLogs((prevLogs) => [...prevLogs.slice(-100), log]); // Keep the last 100 log lines
    });

    socket.emit('streamContainerStats', container.Id);
    socket.on('containerStats', (data) => setStats(data));

    return () => {
      socket.emit('stopStreamingLogs');
      socket.emit('stopStreamingStats');
      socket.off('containerDetails');
      socket.off('containerLog');
      socket.off('containerStats');
    };
  }, [container.Id]);

  return (
    <div className="container-detail">
      <button onClick={onClose}>Close</button>
      <h2>{container.Names[0]}</h2>
      {stats && (
        <div>
          <h4>Real-time Stats</h4>
          <p>CPU: {calculateCPUPercentage(stats)}%</p>
          <p>Memory: {(stats.memory_stats.usage / (1024 * 1024)).toFixed(2)} MB</p>
        </div>
      )}
      {details ? (
        <div>
          <h4>Metadata</h4>
          <pre>{JSON.stringify({
            ID: details.Id,
            Created: details.Created,
            State: details.State,
          }, null, 2)}</pre>

          <h4>Network Settings</h4>
          <pre>{JSON.stringify(details.NetworkSettings.Networks, null, 2)}</pre>

          <h4>Volumes</h4>
          <pre>{JSON.stringify(details.Mounts, null, 2)}</pre>
        </div>
      ) : (
        <p>Loading details...</p>
      )}

      <h4>Logs</h4>
      <div className="logs">
        {logs.map((log, index) => (
          <div key={index}>{log}</div>
        ))}
      </div>
    </div>
  );
};

const calculateCPUPercentage = (stats: any) => {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage.total_usage || 0);
  const systemCpuDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
  const cpuCores = stats.cpu_stats.online_cpus || 1;

  if (systemCpuDelta > 0 && cpuDelta > 0) {
    return ((cpuDelta / systemCpuDelta) * cpuCores * 100.0).toFixed(2);
  }
  return '0.00';
};

export default ContainerDetail;
