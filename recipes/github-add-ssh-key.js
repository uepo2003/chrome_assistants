// recipes/github-add-ssh-key.js
// Quickstart Copilot Recipe — Register an SSH public key with GitHub.
// We never read the user's clipboard or private key material; the human pastes
// the .pub contents themselves at the appropriate handoff.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'github-add-ssh-key',
  category: 'connect',
  targetHost: 'github.com',
  applicableUrlPatterns: [
    'https://github.com/settings/keys*',
    'https://github.com/settings/ssh*',
  ],
  title: {
    en: 'Add an SSH key to GitHub',
    ja: 'GitHub に SSH 鍵を登録',
  },
  description: {
    en: "Opens GitHub's SSH keys page and guides you through pasting your public key.",
    ja: 'GitHub の SSH 鍵設定ページを開き、公開鍵の貼り付けを案内します。',
  },
  estimatedSteps: 5,
  estimatedSeconds: 120,
  difficulty: 'intermediate',
  prerequisites: ['requires-account'],
  humanHandoffPoints: [
    {
      when: 'paste-public-key',
      why: {
        en: "Paste your public SSH key (the .pub file) into the form. We won't read your clipboard.",
        ja: '公開鍵 (.pub ファイル) を自分でフォームに貼り付けてください。クリップボードは読みません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: '^https://github\\.com/settings/keys' },
    { kind: 'text', pattern: '(SSH key added|SSH 鍵を追加しました|登録しました)' },
  ],
  expectedSteps: [
    'Open github.com/settings/keys',
    'Click "New SSH key"',
    'Give the key a title',
    'Wait for user to paste public key',
    'Click "Add SSH key"',
  ],
  tokenEstimate: { min: 1500, max: 5000 },
  willTouch: [
    'settings/keys page',
    'New SSH key form',
  ],
  willNotTouch: [
    'Your private key',
    'Other settings',
    'Your clipboard',
  ],
  lastVerifiedAt: '2026-05-14',
};
