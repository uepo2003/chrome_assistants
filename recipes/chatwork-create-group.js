// recipes/chatwork-create-group.js
// Quickstart Copilot Recipe — Create a new group chat and add members in Chatwork.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'chatwork-create-group',
  category: 'first-setup',
  targetHost: '*.chatwork.com',
  applicableUrlPatterns: [
    'https://www.chatwork.com/*',
  ],
  title: {
    en: 'Create a group chat in Chatwork',
    ja: 'Chatwork でグループチャットを作る',
  },
  description: {
    en: 'Guides a non-IT user to create a new group chat room in Chatwork, name it, write a description, and add the right team members.',
    ja: 'IT に不慣れなユーザーが Chatwork で新しいグループチャットを作成し、ルーム名・説明を入力してメンバーを招待するまでを案内します。',
  },
  estimatedSteps: 7,
  estimatedSeconds: 300,
  difficulty: 'beginner',
  prerequisites: ['requires-chatwork-account'],
  humanHandoffPoints: [
    {
      when: 'email-verification',
      why: {
        en: 'If Chatwork prompts for email verification or re-login, complete that step manually.',
        ja: 'Chatwork からメール確認や再ログインを求められた場合は手動で対応してください。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'chatwork\\.com/#!rid\\d+' },
    { kind: 'text', pattern: '(グループチャットを作成しました|Group created|グループチャット|ルームを作成)' },
  ],
  expectedSteps: [
    'Open www.chatwork.com and confirm the user is logged in',
    'Click the "+" (new room) button near the top of the room list sidebar',
    'Select "グループチャットを作成" (Create group chat) from the menu',
    'Enter a room name in the name field',
    'Optionally enter a room description',
    'Search for and select team members to add to the room',
    'Click Create (作成) to finalize and open the new group chat',
  ],
  tokenEstimate: { min: 1800, max: 6000 },
  willTouch: [
    'Room creation dialog (room name, description, member selection)',
    'Room list sidebar',
  ],
  willNotTouch: [
    'Existing chat rooms or their messages',
    'Account or billing settings',
    'Files',
    'Task lists',
  ],
  lastVerifiedAt: '2026-05-17',
};
