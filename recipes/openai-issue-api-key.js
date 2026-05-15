// recipes/openai-issue-api-key.js
// Quickstart Copilot Recipe — Create an OpenAI Platform secret key.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'openai-issue-api-key',
  category: 'key-issue',
  targetHost: 'platform.openai.com',
  applicableUrlPatterns: [
    'https://platform.openai.com/api-keys*',
  ],
  title: {
    en: 'Get an OpenAI API key',
    ja: 'OpenAI API キーを発行',
  },
  description: {
    en: 'Opens the OpenAI Platform and helps you create a new secret API key.',
    ja: 'OpenAI Platform を開き、新しいシークレット API キーの作成を案内します。',
  },
  estimatedSteps: 6,
  estimatedSeconds: 150,
  difficulty: 'beginner',
  prerequisites: ['requires-openai-account'],
  humanHandoffPoints: [
    {
      when: 'phone-verification',
      why: {
        en: 'OpenAI may ask for SMS verification — handle this yourself.',
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
    { kind: 'url', pattern: 'platform\\.openai\\.com/api-keys' },
    { kind: 'text', pattern: '(sk-|API key|表示されません)' },
  ],
  expectedSteps: [
    'Open platform.openai.com/api-keys',
    'Click "Create new secret key"',
    'Name the key',
    'Confirm',
    'Wait for user to copy the key',
    'Done',
  ],
  tokenEstimate: { min: 1500, max: 5000 },
  willTouch: [
    'OpenAI Platform / api-keys page',
  ],
  willNotTouch: [
    'Your billing settings',
    'Other projects',
    'Your clipboard',
  ],
  lastVerifiedAt: '2026-05-14',
};
