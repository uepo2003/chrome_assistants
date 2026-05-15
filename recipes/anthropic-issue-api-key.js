// recipes/anthropic-issue-api-key.js
// Quickstart Copilot Recipe — Create an Anthropic Console workspace API key.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'anthropic-issue-api-key',
  category: 'key-issue',
  targetHost: 'console.anthropic.com',
  applicableUrlPatterns: [
    'https://console.anthropic.com/settings/keys*',
  ],
  title: {
    en: 'Get an Anthropic API key',
    ja: 'Anthropic API キーを発行',
  },
  description: {
    en: 'Opens the Anthropic Console and helps you create a workspace API key.',
    ja: 'Anthropic Console を開き、ワークスペース API キーの作成を案内します。',
  },
  estimatedSteps: 6,
  estimatedSeconds: 150,
  difficulty: 'beginner',
  prerequisites: ['requires-anthropic-account'],
  humanHandoffPoints: [
    {
      when: 'phone-verification',
      why: {
        en: 'Anthropic may ask for SMS verification — handle this yourself.',
        ja: 'SMS 認証を求められたら、自分で対応してください。',
      },
    },
    {
      when: 'copy-key',
      why: {
        en: 'Copy the API key shown only once. The extension does not read it for you.',
        ja: '1 度しか表示されない API キーは自分でコピーしてください。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'console\\.anthropic\\.com/settings/keys' },
    { kind: 'text', pattern: '(sk-ant-|API key created|API キーを作成しました)' },
  ],
  expectedSteps: [
    'Open console.anthropic.com/settings/keys',
    'Click "Create Key"',
    'Name the key',
    'Choose workspace',
    'Confirm',
    'Wait for user to copy the key',
  ],
  tokenEstimate: { min: 1500, max: 5000 },
  willTouch: [
    'Anthropic Console / settings / keys page',
  ],
  willNotTouch: [
    'Your billing settings',
    'Other workspaces',
    'Your clipboard',
  ],
  lastVerifiedAt: '2026-05-14',
};
