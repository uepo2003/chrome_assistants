// recipes/lstep-scenario-walkthrough.js
// Quickstart Copilot Recipe — Locate and edit a delivered scenario/step in Lステップ.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'lstep-scenario-walkthrough',
  category: 'first-setup',
  targetHost: 'manager.linestep.net',
  applicableUrlPatterns: [
    'https://manager.linestep.net/*',
  ],
  title: {
    en: 'Find and edit a scenario in Lステップ',
    ja: 'Lステップでシナリオを探して編集する',
  },
  description: {
    en: 'Guides an Lステップ client through logging in, locating a delivered scenario in the scenario list, opening it in the editor, and making a simple text edit — reducing "how do I operate this?" support requests.',
    ja: 'Lステップにログインし、代行業者から納品されたシナリオを一覧から探してエディタで開き、テキストを編集するまでを案内します。「操作方法がわからない」というサポート問い合わせを削減します。',
  },
  estimatedSteps: 8,
  estimatedSeconds: 360,
  difficulty: 'beginner',
  prerequisites: ['requires-lstep-account'],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Log in with your Lステップ account credentials — the extension does not handle passwords.',
        ja: 'Lステップのアカウント情報でログインしてください。拡張機能はパスワードを扱いません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'manager\\.linestep\\.net/(scenario|step|message)' },
    { kind: 'text', pattern: '(シナリオ|保存しました|Scenario|編集|Edit|ステップ)' },
  ],
  expectedSteps: [
    'Open manager.linestep.net and wait for user to log in',
    'Navigate to the Scenario list (シナリオ) from the left sidebar menu',
    'Identify the delivered scenario by name in the list',
    'Click the scenario to open its step list',
    'Click the first step to open the step editor',
    'Point out the message text field and other editable elements',
    'Make a small sample text edit to demonstrate saving',
    'Click Save (保存) and confirm the change is reflected',
  ],
  tokenEstimate: { min: 2000, max: 7000 },
  willTouch: [
    'Lステップ scenario list page',
    'Step editor (message text and timing fields)',
    'Save button',
  ],
  willNotTouch: [
    'LINE Official Account settings',
    'Friend list or user data',
    'Billing or contract information',
    'Automation trigger conditions',
  ],
  lastVerifiedAt: '2026-05-17',
};
