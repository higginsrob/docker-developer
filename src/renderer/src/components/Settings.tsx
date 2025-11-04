import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

const socket = io('http://localhost:3002');

interface UserProfile {
  email: string;
  name: string;
  avatar: string;
}

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

interface RAGConfig {
  enabled: boolean;
  topK: number;
  similarityThreshold: number;
  embeddingModel: string;
}

interface RAGStats {
  totalMessages: number;
  totalEmbeddings: number;
  totalAgents: number;
  config: RAGConfig;
}

const Settings: React.FC<{ userProfile: UserProfile; onRefresh?: () => void }> = ({ userProfile, onRefresh }) => {
  const [settings, setSettings] = useState<UserSettings>({
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

  const [ragConfig, setRagConfig] = useState<RAGConfig>({
    enabled: true,
    topK: 5,
    similarityThreshold: 0.7,
    embeddingModel: 'all-minilm'
  });

  const [ragStats, setRagStats] = useState<RAGStats | null>(null);

  // Load user settings on mount
  useEffect(() => {
    socket.emit('getUserSettings');
    
    socket.on('userSettings', (loadedSettings: UserSettings) => {
      setSettings(loadedSettings);
    });

    socket.on('userSettingsSaved', () => {
      // Settings saved successfully
    });

    return () => {
      socket.off('userSettings');
      socket.off('userSettingsSaved');
    };
  }, []);

  // Load RAG config and stats on mount
  useEffect(() => {
    socket.emit('getRAGConfig');
    socket.emit('getRAGStats');

    socket.on('ragConfig', (config: RAGConfig) => {
      setRagConfig(config);
    });

    socket.on('ragStats', (stats: RAGStats) => {
      setRagStats(stats);
    });

    socket.on('ragConfigUpdated', (config: RAGConfig) => {
      setRagConfig(config);
      // Refresh stats after config update
      socket.emit('getRAGStats');
    });

    return () => {
      socket.off('ragConfig');
      socket.off('ragStats');
      socket.off('ragConfigUpdated');
    };
  }, []);

  const handleRAGConfigChange = (field: keyof RAGConfig, value: boolean | number | string) => {
    const newConfig = {
      ...ragConfig,
      [field]: value,
    };
    setRagConfig(newConfig);
    socket.emit('updateRAGConfig', newConfig);
  };

  const handleSettingChange = (field: keyof UserSettings, value: boolean | string) => {
    const newSettings = {
      ...settings,
      [field]: value,
    };
    setSettings(newSettings);
    // Save to file immediately
    socket.emit('saveUserSettings', newSettings);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-gray-900">Settings</h2>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              title="Refresh all data"
            >
              <ArrowPathIcon className="w-5 h-5" />
              <span className="font-medium">Refresh</span>
            </button>
          )}
        </div>

        {/* Profile Section */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Profile</h3>
          <div className="bg-gray-50 rounded-lg p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Git User Name
              </label>
              <p className="text-gray-900 bg-white px-4 py-2 rounded-lg border border-gray-300">
                {settings.gitName || userProfile.name || 'Not configured'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Git Email Address
              </label>
              <p className="text-gray-900 bg-white px-4 py-2 rounded-lg border border-gray-300">
                {settings.gitEmail || userProfile.email || 'Not configured'}
              </p>
            </div>
          </div>
        </div>

        {/* User Attributes Section */}
        <div>
          <h3 className="text-xl font-bold text-gray-900 mb-4">User Attributes</h3>
          <div className="bg-gray-50 rounded-lg p-6 space-y-6">
            {/* Checkboxes for git info */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={settings.allowUseGitName}
                  onChange={(e) => handleSettingChange('allowUseGitName', e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  id="allowUseGitName"
                />
                <label htmlFor="allowUseGitName" className="text-sm font-medium text-gray-700">
                  Allow agents to use git user name
                </label>
              </div>
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={settings.allowUseGitEmail}
                  onChange={(e) => handleSettingChange('allowUseGitEmail', e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  id="allowUseGitEmail"
                />
                <label htmlFor="allowUseGitEmail" className="text-sm font-medium text-gray-700">
                  Allow agents to use git email address
                </label>
              </div>
            </div>

            {/* Text inputs for user attributes */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nickname
                </label>
                <input
                  type="text"
                  value={settings.nickname}
                  onChange={(e) => handleSettingChange('nickname', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your nickname"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Language
                </label>
                <input
                  type="text"
                  value={settings.language}
                  onChange={(e) => handleSettingChange('language', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., English"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Age
                </label>
                <input
                  type="text"
                  value={settings.age}
                  onChange={(e) => handleSettingChange('age', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your age"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender Identity
                </label>
                <input
                  type="text"
                  list="gender-identity-options"
                  value={settings.gender}
                  onChange={(e) => handleSettingChange('gender', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your gender identity"
                />
                <datalist id="gender-identity-options">
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-Binary">Non-Binary</option>
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender Orientation
                </label>
                <input
                  type="text"
                  list="gender-orientation-options"
                  value={settings.orientation}
                  onChange={(e) => handleSettingChange('orientation', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your gender orientation"
                />
                <datalist id="gender-orientation-options">
                  <option value="Agender">Agender</option>
                  <option value="Bigender">Bigender</option>
                  <option value="Cisgender">Cisgender</option>
                  <option value="Genderfluid">Genderfluid</option>
                  <option value="Bisexual">Bisexual</option>
                  <option value="Genderqueer">Genderqueer</option>
                  <option value="Questioning">Questioning</option>
                  <option value="Binary">Binary</option>
                  <option value="Butch">Butch</option>
                  <option value="Coming out">Coming out</option>
                  <option value="Gender dysphoria">Gender dysphoria</option>
                  <option value="Gender expression">Gender expression</option>
                  <option value="Nonbinary">Nonbinary</option>
                  <option value="Androgyne">Androgyne</option>
                  <option value="Aromantic">Aromantic</option>
                  <option value="Asexual">Asexual</option>
                  <option value="Cis woman">Cis woman</option>
                  <option value="Cisnormativity">Cisnormativity</option>
                  <option value="Cissexism">Cissexism</option>
                  <option value="Closeted">Closeted</option>
                  <option value="FTM">FTM</option>
                  <option value="Gay">Gay</option>
                  <option value="Heterosexual">Heterosexual</option>
                  <option value="Lesbian">Lesbian</option>
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Race
                </label>
                <input
                  type="text"
                  list="race-options"
                  value={settings.race}
                  onChange={(e) => handleSettingChange('race', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your race"
                />
                <datalist id="race-options">
                  <option value="American Indian or Alaska Native">American Indian or Alaska Native</option>
                  <option value="Asian">Asian</option>
                  <option value="Black or African American">Black or African American</option>
                  <option value="Native Hawaiian or Other Pacific Islander">Native Hawaiian or Other Pacific Islander</option>
                  <option value="White">White</option>
                  <option value="Two or More Races">Two or More Races</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ethnicity
                </label>
                <select
                  value={settings.ethnicity}
                  onChange={(e) => handleSettingChange('ethnicity', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Prefer not to say</option>
                  <option value="Hispanic or Latino">Hispanic or Latino</option>
                  <option value="Not Hispanic or Latino">Not Hispanic or Latino</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Job Title
                </label>
                <input
                  type="text"
                  value={settings.jobTitle}
                  onChange={(e) => handleSettingChange('jobTitle', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Software Engineer"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Employer
                </label>
                <input
                  type="text"
                  value={settings.employer}
                  onChange={(e) => handleSettingChange('employer', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Acme Corporation"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Income Level
                </label>
                <select
                  value={settings.incomeLevel}
                  onChange={(e) => handleSettingChange('incomeLevel', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Prefer not to say</option>
                  <option value="Under $25,000">Under $25,000</option>
                  <option value="$25,000 - $49,999">$25,000 - $49,999</option>
                  <option value="$50,000 - $74,999">$50,000 - $74,999</option>
                  <option value="$75,000 - $99,999">$75,000 - $99,999</option>
                  <option value="$100,000 - $149,999">$100,000 - $149,999</option>
                  <option value="$150,000 - $199,999">$150,000 - $199,999</option>
                  <option value="$200,000 - $299,999">$200,000 - $299,999</option>
                  <option value="$300,000 - $499,999">$300,000 - $499,999</option>
                  <option value="$500,000+">$500,000+</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Education Level
                </label>
                <select
                  value={settings.educationLevel}
                  onChange={(e) => handleSettingChange('educationLevel', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">None</option>
                  <option value="Primary education">Primary education</option>
                  <option value="High School Diploma">High School Diploma</option>
                  <option value="Postsecondary education">Postsecondary education</option>
                  <option value="Associate degree">Associate degree</option>
                  <option value="Bachelor's degree">Bachelor's degree</option>
                  <option value="Master's degree">Master's degree</option>
                  <option value="Doctoral degree">Doctoral degree</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Political Ideology
                </label>
                <select
                  value={settings.politicalIdeology}
                  onChange={(e) => handleSettingChange('politicalIdeology', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">None</option>
                  <option value="Left-wing">Left-wing</option>
                  <option value="Far-left">Far-left</option>
                  <option value="Centre-left">Centre-left</option>
                  <option value="Centre">Centre</option>
                  <option value="Centre-right">Centre-right</option>
                  <option value="Right-wing">Right-wing</option>
                  <option value="Far-right">Far-right</option>
                  <option value="Syncretic">Syncretic</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Marital Status
                </label>
                <select
                  value={settings.maritalStatus}
                  onChange={(e) => handleSettingChange('maritalStatus', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Prefer not to say</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Domestic Partnership">Domestic Partnership</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Separated">Separated</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Number of Children
                </label>
                <select
                  value={settings.numberOfChildren}
                  onChange={(e) => handleSettingChange('numberOfChildren', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Prefer not to say</option>
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5+">5+</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Housing
                </label>
                <select
                  value={settings.housing}
                  onChange={(e) => handleSettingChange('housing', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Prefer not to say</option>
                  <option value="Own">Own</option>
                  <option value="Rent">Rent</option>
                  <option value="Living with family">Living with family</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Head of Household
                </label>
                <select
                  value={settings.headOfHousehold}
                  onChange={(e) => handleSettingChange('headOfHousehold', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Prefer not to say</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Religion
                </label>
                <input
                  type="text"
                  list="religion-options"
                  value={settings.religion}
                  onChange={(e) => handleSettingChange('religion', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your religion"
                />
                <datalist id="religion-options">
                  <option value="Spiritual Not Religious">Spiritual, Not Religious</option>
                  <option value="Christianity">Christianity</option>
                  <option value="Islam">Islam</option>
                  <option value="Hinduism">Hinduism</option>
                  <option value="Buddhism">Buddhism</option>
                  <option value="Judaism">Judaism</option>
                  <option value="Sikhism">Sikhism</option>
                  <option value="Taoism">Taoism</option>
                  <option value="Baháʼí Faith">Baháʼí Faith</option>
                  <option value="Jainism">Jainism</option>
                  <option value="Confucianism">Confucianism</option>
                  <option value="Shinto">Shinto</option>
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Interests
                </label>
                <textarea
                  value={settings.interests}
                  onChange={(e) => handleSettingChange('interests', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your interests"
                  rows={4}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Country
                </label>
                <input
                  type="text"
                  value={settings.country}
                  onChange={(e) => handleSettingChange('country', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., United States"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  State
                </label>
                <input
                  type="text"
                  value={settings.state}
                  onChange={(e) => handleSettingChange('state', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., California"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Zipcode
                </label>
                <input
                  type="text"
                  value={settings.zipcode}
                  onChange={(e) => handleSettingChange('zipcode', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., 90210"
                />
              </div>
            </div>
          </div>
        </div>

        {/* RAG Settings Section */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">RAG (Retrieval-Augmented Generation)</h3>
          <div className="bg-gray-50 rounded-lg p-6 space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> RAG is used to load context from filesystems, Git repositories, and document data. 
                Conversation history is handled automatically through stateful conversations.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={ragConfig.enabled}
                onChange={(e) => handleRAGConfigChange('enabled', e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                id="ragEnabled"
              />
              <label htmlFor="ragEnabled" className="text-sm font-medium text-gray-700">
                Enable RAG - Index and search project filesystems, Git repositories, and container files
              </label>
            </div>

            {ragConfig.enabled && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Top K Results: {ragConfig.topK}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={ragConfig.topK}
                    onChange={(e) => handleRAGConfigChange('topK', parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Number of similar file chunks to retrieve from filesystem and Git repositories (1-20)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Similarity Threshold: {ragConfig.similarityThreshold.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={ragConfig.similarityThreshold}
                    onChange={(e) => handleRAGConfigChange('similarityThreshold', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum similarity score for including file chunks (0.0-1.0). Higher values return more relevant results.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Embedding Model
                  </label>
                  <select
                    value={ragConfig.embeddingModel}
                    onChange={(e) => handleRAGConfigChange('embeddingModel', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="all-minilm">all-MiniLM-L6-v2 (Default)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Model used for generating semantic embeddings of files and code
                  </p>
                </div>

                {ragStats && (
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Indexing Statistics</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-2xl font-bold text-blue-600">{ragStats.totalMessages}</div>
                        <div className="text-xs text-gray-500">Stored Messages</div>
                        <div className="text-xs text-gray-400 mt-1">(for semantic search)</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-600">{ragStats.totalEmbeddings}</div>
                        <div className="text-xs text-gray-500">File Embeddings</div>
                        <div className="text-xs text-gray-400 mt-1">(indexed chunks)</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-purple-600">{ragStats.totalAgents}</div>
                        <div className="text-xs text-gray-500">Active Agents</div>
                        <div className="text-xs text-gray-400 mt-1">(with indexed data)</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

