// recipes/supabase-create-project.js
// Quickstart Copilot Recipe — Create a new Supabase project from the dashboard.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'supabase-create-project',
  category: 'first-setup',
  targetHost: 'supabase.com',
  applicableUrlPatterns: [
    'https://supabase.com/dashboard*',
  ],
  title: {
    en: 'Create a Supabase project',
    ja: 'Supabase プロジェクトを作成',
  },
  description: {
    en: 'Opens supabase.com/dashboard, walks you through region & password, lands you on the project dashboard.',
    ja: 'supabase.com/dashboard を開き、リージョン・パスワード設定からダッシュボードまで案内します。',
  },
  estimatedSteps: 8,
  estimatedSeconds: 240,
  difficulty: 'intermediate',
  prerequisites: ['requires-account'],
  humanHandoffPoints: [
    {
      when: 'sign-in',
      why: {
        en: 'Sign in to Supabase yourself if the dashboard asks for credentials.',
        ja: 'Supabase のログイン画面が出たら、自分でサインインしてください。',
      },
    },
    {
      when: 'pick-password',
      why: {
        en: "Set a database password yourself — we won't generate or store one.",
        ja: 'データベースのパスワードは自分で設定してください。生成も保存も行いません。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'supabase\\.com/dashboard/project/[A-Za-z0-9]+' },
    { kind: 'text', pattern: '(Project is ready|プロジェクトの準備が完了)' },
  ],
  expectedSteps: [
    'Open supabase.com/dashboard',
    'Click "New project"',
    'Pick org',
    'Name the project',
    'Wait for user to set password',
    'Pick region',
    'Click create',
    'Wait for provision',
  ],
  tokenEstimate: { min: 2500, max: 8000 },
  willTouch: [
    'supabase.com dashboard',
    'New project form (name / region / org)',
  ],
  willNotTouch: [
    'Your database password',
    'Other Supabase projects',
    'Billing',
  ],
  lastVerifiedAt: '2026-05-14',
};
