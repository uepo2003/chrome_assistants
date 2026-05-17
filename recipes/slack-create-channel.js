// recipes/slack-create-channel.js
// Quickstart Copilot Recipe — Create a Slack channel and invite people (Slack web app).

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'slack-create-channel',
  category: 'btob-tool',
  targetHost: '*.slack.com',
  applicableUrlPatterns: [
    'https://app.slack.com/*',
  ],
  title: {
    en: 'Create a channel and invite people in Slack',
    ja: 'Slack でチャンネルを作ってメンバーを招待する',
  },
  description: {
    en: 'Guides a non-IT user through creating a new Slack channel (public or private), writing a purpose, and inviting teammates — using the Slack web app at app.slack.com. Note: your workspace, sidebar, and member list depend on your own Slack workspace, so the screen may differ from this recipe — record your own version if it does not match.',
    ja: 'IT に不慣れなユーザーが Slack の Web アプリで新しいチャンネル（公開または非公開）を作成し、目的を記入してメンバーを招待するまでを案内します。注意: ワークスペース・サイドバー・メンバー一覧はご利用の Slack ワークスペースに依存するため、画面はこのレシピと異なる場合があります。合わない場合は録画機能で自社専用版を作成してください。',
  },
  estimatedSteps: 8,
  estimatedSeconds: 300,
  difficulty: 'beginner',
  prerequisites: ['requires-slack-workspace-account'],
  humanHandoffPoints: [
    {
      when: 'oauth-popup',
      why: {
        en: 'Sign in to your Slack workspace, including any SSO / Google login flow — the extension does not handle credentials.',
        ja: 'SSO や Google ログインを含む Slack ワークスペースへのサインインは手動で行ってください。拡張機能は認証情報を扱いません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'app\\.slack\\.com/client/[A-Z0-9]+/[A-Z0-9]+' },
    { kind: 'text', pattern: '(Channel created|チャンネルを作成しました|招待しました|invited to|メンバーを追加)' },
  ],
  expectedSteps: [
    'Open app.slack.com and wait for user to sign in to their workspace',
    'Click "Add channels" or the "+" next to Channels in the left sidebar',
    'Select "Create a new channel" from the menu',
    'Enter a channel name (lowercase, no spaces)',
    'Set visibility to Public or Private as appropriate',
    'Write a short channel purpose/description',
    'Click Create, then use the Add Members dialog to invite teammates by name or email',
    'Confirm the new channel appears in the sidebar and members have been added',
  ],
  tokenEstimate: { min: 2000, max: 7000 },
  willTouch: [
    'Slack sidebar (Add channels / + button)',
    'Channel creation dialog (name, visibility, purpose)',
    'Add Members dialog',
  ],
  willNotTouch: [
    'Existing channels or their messages',
    'Workspace admin settings',
    'Billing or subscription',
    'Integrations or app settings',
  ],
  lastVerifiedAt: '2026-05-17',
};
