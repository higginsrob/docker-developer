import React from 'react';
import { Squares2X2Icon, TableCellsIcon } from '@heroicons/react/24/outline';

interface ViewToggleProps {
  viewMode: 'table' | 'card';
  onViewModeChange: (mode: 'table' | 'card') => void;
}

const ViewToggle: React.FC<ViewToggleProps> = ({ viewMode, onViewModeChange }) => {
  return (
    <div className="flex items-center bg-gray-700 rounded-lg p-1 space-x-1">
      <button
        onClick={() => onViewModeChange('table')}
        className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-all duration-200 ${
          viewMode === 'table'
            ? 'bg-docker-blue text-white shadow-md'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-600'
        }`}
        title="Table View"
      >
        <TableCellsIcon className="w-5 h-5" />
        <span className="text-sm font-medium hidden sm:inline">Table</span>
      </button>
      <button
        onClick={() => onViewModeChange('card')}
        className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-all duration-200 ${
          viewMode === 'card'
            ? 'bg-docker-blue text-white shadow-md'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-600'
        }`}
        title="Card View"
      >
        <Squares2X2Icon className="w-5 h-5" />
        <span className="text-sm font-medium hidden sm:inline">Cards</span>
      </button>
    </div>
  );
};

export default ViewToggle;





