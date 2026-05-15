// recipes/lovable-connect-github.js
// Quickstart Copilot Recipe — Connect a Lovable workspace to GitHub.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'lovable-connect-github',
  category: 'connect',
  targetHost: 'lovable.dev',
  applicableUrlPatterns: [
    'https://lovable.dev/*',
    'https://*.lovable.dev/*',
  ],
  title: {
    en: 'Connect Lovable to GitHub',
    ja: 'Lovable と GitHub を接続',
  },
  description: {
    en: 'Opens your Lovable workspace, walks you through the GitHub OAuth handoff, and confirms the repo permissions are correct.',
    ja: 'Lovable ワークスペースを開き、GitHub OAuth による接続から、リポジトリ権限の確認まで案内します。',
  },
  estimatedSteps: 7,
  estimatedSeconds: 180,
  difficulty: 'intermediate',
  prerequisites: ['requires-lovable-account', 'requires-github-connected'],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Lovable opens a GitHub authorization popup — approve it yourself.',
        ja: 'Lovable が GitHub の認可ポップアップを開きます。自分で承認してください。',
      },
    },
    {
      when: 'repo-permission-scope',
      why: {
        en: 'Pick which repositories Lovable can access. We will not change this for you.',
        ja: 'Lovable がアクセスできるリポジトリの範囲を自分で選んでください。こちらでは変更しません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'lovable\\.dev/(projects|workspace|settings)' },
    { kind: 'text', pattern: '(Connected to GitHub|GitHub に接続しました|GitHub connected)' },
  ],
  expectedSteps: [
    'Open lovable.dev workspace',
    'Navigate to integrations / GitHub',
    'Click "Connect GitHub"',
    'Hand off to OAuth popup',
    'Wait for user to confirm repo-permission scope',
    'Return to Lovable',
    'Confirm the "Connected" indicator',
  ],
  tokenEstimate: { min: 2000, max: 6000 },
  willTouch: [
    'Lovable workspace settings / integrations page',
    'Connect GitHub button',
  ],
  willNotTouch: [
    'Your GitHub credentials',
    'Other Lovable projects',
    'Your repositories',
  ],
  lastVerifiedAt: '2026-05-14',
};
