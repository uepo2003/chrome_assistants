// recipes/kintone-app-navigation.js
// Quickstart Copilot Recipe — Orient a brand-new user around a customized kintone app.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'kintone-app-navigation',
  category: 'btob-tool',
  targetHost: '*.cybozu.com',
  applicableUrlPatterns: [
    'https://*.cybozu.com/k/*',
    'https://*.kintone.com/k/*',
  ],
  title: {
    en: 'Find your way around a kintone app',
    ja: 'kintone アプリの基本操作を覚える',
  },
  description: {
    en: 'Orients a first-time kintone user: locating an app on the portal, switching between list/calendar/chart views, and using the search bar to find records. Note: kintone screens are heavily customized per organization, so your layout may differ from this recipe — record your own version if it does not match.',
    ja: 'kintone を初めて使うユーザー向けに、ポータルからアプリを探す方法、一覧・カレンダー・グラフのビュー切り替え、レコード検索の使い方を案内します。注意: kintone の画面は組織ごとに大きくカスタマイズされるため、あなたの画面レイアウトはこのレシピと異なる場合があります。合わない場合は録画機能で自社専用版を作成してください。',
  },
  estimatedSteps: 7,
  estimatedSeconds: 300,
  difficulty: 'beginner',
  prerequisites: ['requires-kintone-account', 'requires-kintone-subdomain'],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Log in with your Cybozu account or SSO before the tour begins.',
        ja: 'ツアーを始める前に Cybozu アカウントまたは SSO でログインしてください。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: '(cybozu\\.com|kintone\\.com)/k/\\d+' },
    { kind: 'text', pattern: '(レコード一覧|一覧|List View|すべて|検索|Search)' },
  ],
  expectedSteps: [
    'Open the kintone portal (yourcompany.cybozu.com)',
    'Wait for user to log in',
    'Point out the app list / portal app icons',
    'Click the target app to open it',
    'Show the view switcher (list / calendar / chart) at the top of the app',
    'Switch to a second view to demonstrate toggling',
    'Use the search box to search for a sample keyword and show the results',
  ],
  tokenEstimate: { min: 1800, max: 6000 },
  willTouch: [
    'kintone portal page (app list)',
    'App view switcher tabs',
    'Record search box',
  ],
  willNotTouch: [
    'App settings or field configuration',
    'Record creation or editing',
    'Cybozu Admin console',
  ],
  lastVerifiedAt: '2026-05-17',
};
