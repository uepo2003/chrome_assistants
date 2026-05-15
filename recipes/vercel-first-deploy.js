// recipes/vercel-first-deploy.js
// Quickstart Copilot Recipe — Deploy your first project to Vercel from a
// GitHub repository. OAuth + env-var entry are the major human-in-the-loop
// moments and are declared as handoffs.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'vercel-first-deploy',
  category: 'deploy',
  targetHost: 'vercel.com',
  applicableUrlPatterns: [
    'https://vercel.com/new*',
    'https://vercel.com/dashboard*',
  ],
  title: {
    en: 'Deploy your first project to Vercel',
    ja: 'Vercel に初回デプロイ',
  },
  description: {
    en: 'Imports a GitHub repository into Vercel, walks you through framework detection and env vars, and waits for the first successful deployment.',
    ja: 'GitHub のリポジトリを Vercel にインポートし、フレームワーク検出と環境変数設定を案内、初回デプロイの成功まで待機します。',
  },
  estimatedSteps: 10,
  estimatedSeconds: 300,
  difficulty: 'intermediate',
  prerequisites: ['requires-account', 'requires-github-connected'],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Vercel opens a GitHub authorization popup — approve it yourself.',
        ja: 'Vercel が GitHub の認可ポップアップを開きます。自分で承認してください。',
      },
    },
    {
      when: 'env-vars',
      why: {
        en: 'Paste any environment variables your app needs. We will not read them or your clipboard.',
        ja: 'アプリに必要な環境変数を自分で貼り付けてください。クリップボードは読みません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'vercel\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+' },
    { kind: 'text', pattern: '(Deployment succeeded|デプロイ成功|Ready)' },
  ],
  expectedSteps: [
    'Open vercel.com/new',
    'Pick a GitHub repository to import',
    'Approve GitHub authorization popup',
    'Confirm detected framework',
    'Set the project name',
    'Wait for user to enter env vars',
    'Click "Deploy"',
    'Wait for build to finish',
    'Land on the deployment dashboard',
    'Confirm the success banner',
  ],
  tokenEstimate: { min: 3000, max: 12000 },
  willTouch: [
    'vercel.com/new and project settings',
    'Import form, framework preset, deploy button',
  ],
  willNotTouch: [
    'Your environment variable values',
    'Other Vercel projects',
    'Billing or team settings',
  ],
  lastVerifiedAt: '2026-05-14',
};
