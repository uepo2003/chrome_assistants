// recipes/cursor-initial-signin.js
// Quickstart Copilot Recipe — Sign in to Cursor for the first time via the web.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'cursor-initial-signin',
  category: 'first-setup',
  targetHost: 'cursor.com',
  applicableUrlPatterns: [
    'https://cursor.com/*',
    'https://www.cursor.com/*',
  ],
  title: {
    en: 'Sign in to Cursor for the first time',
    ja: 'Cursor 初期サインイン',
  },
  description: {
    en: 'Opens cursor.com, walks you through the sign-in choice (Google / GitHub / email), and lands you on the dashboard.',
    ja: 'cursor.com を開き、サインイン方法 (Google / GitHub / メール) の選択からダッシュボード到達まで案内します。',
  },
  estimatedSteps: 5,
  estimatedSeconds: 120,
  difficulty: 'beginner',
  prerequisites: [],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Cursor uses a Google or GitHub popup — pick your identity and approve it yourself.',
        ja: 'Cursor は Google / GitHub の認証ポップアップを使います。自分でアカウントを選び承認してください。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'cursor\\.com/(dashboard|settings)' },
  ],
  expectedSteps: [
    'Open cursor.com',
    'Click the "Sign in" button',
    'Pick a sign-in method',
    'Hand off to the OAuth popup',
    'Land on cursor.com/dashboard',
  ],
  tokenEstimate: { min: 1200, max: 4000 },
  willTouch: [
    'cursor.com sign-in screen',
    'Sign-in method buttons',
  ],
  willNotTouch: [
    'Your Google / GitHub credentials',
    'Cursor billing or team settings',
    'Your clipboard',
  ],
  lastVerifiedAt: '2026-05-14',
};
