// recipes/github-create-account.js
// Quickstart Copilot Recipe — GitHub account creation walkthrough.
//
// Note: signing IN to GitHub remains a manual step; this recipe operates in
// the rules+nudge style, helping users fill the signup form and stopping at
// every legitimate human-in-the-loop point (CAPTCHA, email verification).

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'github-create-account',
  category: 'account',
  targetHost: 'github.com',
  applicableUrlPatterns: [
    'https://github.com/signup*',
    'https://github.com/join*',
  ],
  title: {
    en: 'Create a GitHub account',
    ja: 'GitHub アカウントを作る',
  },
  description: {
    en: "Walks you through GitHub's signup, helps you pick a username, and gets you to the email-verification step.",
    ja: 'GitHub のサインアップを補助し、ユーザー名選択を提案、メール認証のステップまで案内します。',
  },
  estimatedSteps: 7,
  estimatedSeconds: 180,
  difficulty: 'beginner',
  prerequisites: [],
  humanHandoffPoints: [
    {
      when: 'email-verification',
      why: {
        en: "You'll need to click the verification link GitHub emails you.",
        ja: 'GitHub から届くメールの認証リンクをクリックする必要があります。',
      },
    },
    {
      when: 'captcha',
      why: {
        en: 'Solve the human-check puzzle if shown.',
        ja: '人間確認パズルが出たら、自分で解いてください。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: '^https://github\\.com/$' },
    { kind: 'url', pattern: '^https://github\\.com/dashboard' },
  ],
  expectedSteps: [
    'Open github.com/signup',
    'Enter email',
    'Create password',
    'Pick a username',
    'Solve the puzzle if shown',
    'Wait for email-verification',
    'Land on github.com home',
  ],
  tokenEstimate: { min: 2000, max: 8000 },
  willTouch: [
    'github.com signup form fields',
    'submit / next buttons',
  ],
  willNotTouch: [
    'Your email inbox',
    'GitHub repos',
    'Billing',
  ],
  lastVerifiedAt: '2026-05-14',
};
