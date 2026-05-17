// recipes/kintone-create-app-record.js
// Quickstart Copilot Recipe — Open a kintone app and add a new record.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'kintone-create-app-record',
  category: 'btob-tool',
  targetHost: '*.cybozu.com',
  applicableUrlPatterns: [
    'https://*.cybozu.com/k/*',
    'https://*.kintone.com/k/*',
  ],
  title: {
    en: 'Add a new record in a kintone app',
    ja: 'kintone アプリに新しいレコードを追加する',
  },
  description: {
    en: 'Logs you into kintone, opens the target app, and guides you to create a new record — perfect for teaching new staff their first data entry. Note: kintone forms are customized per organization, so your fields and layout may differ from this recipe — record your own version if it does not match.',
    ja: 'kintone にログインし、対象アプリを開いて新しいレコードを登録するまでを案内します。新人スタッフへの操作説明にご活用ください。注意: kintone のフォームは組織ごとにカスタマイズされるため、項目や画面レイアウトはこのレシピと異なる場合があります。合わない場合は録画機能で自社専用版を作成してください。',
  },
  estimatedSteps: 8,
  estimatedSeconds: 240,
  difficulty: 'beginner',
  prerequisites: ['requires-kintone-account', 'requires-kintone-subdomain'],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Log in with your Cybozu account (username and password, or SSO) — the extension does not handle credentials.',
        ja: 'Cybozu アカウント（ユーザー名・パスワード、または SSO）でログインしてください。拡張機能は認証情報を扱いません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: '(cybozu\\.com|kintone\\.com)/k/\\d+/show' },
    { kind: 'text', pattern: '(保存しました|レコードを保存|Record saved|Save succeeded)' },
  ],
  expectedSteps: [
    'Open the kintone subdomain (e.g. yourcompany.cybozu.com)',
    'Wait for user to log in with Cybozu account / SSO',
    'Navigate to the target app from the app list or portal',
    'Click the "Add Record" button (レコードを追加 / 新規作成)',
    'Fill in required fields as directed by the user',
    'Click Save (保存) to submit the record',
    'Confirm the record appears in the list view',
    'Show the user the record detail URL',
  ],
  tokenEstimate: { min: 2000, max: 7000 },
  willTouch: [
    'kintone app list / portal page',
    'Record creation form (new record screen)',
    'Save button',
  ],
  willNotTouch: [
    'App settings or customization',
    'Other users\' records',
    'Cybozu Admin console',
    'Your account password',
  ],
  lastVerifiedAt: '2026-05-17',
};
