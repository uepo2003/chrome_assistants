// recipes/chatwork-add-task.js
// Quickstart Copilot Recipe — Add a task assigned to someone in a Chatwork room.

/** @type {import('./_types.js').Recipe} */
export const recipe = {
  id: 'chatwork-add-task',
  category: 'first-setup',
  targetHost: '*.chatwork.com',
  applicableUrlPatterns: [
    'https://www.chatwork.com/*',
  ],
  title: {
    en: 'Add a task in a Chatwork room',
    ja: 'Chatwork のルームにタスクを追加する',
  },
  description: {
    en: 'Guides a non-IT user to open a Chatwork room, open the Task panel, create a new task, set a due date, and assign it to a teammate.',
    ja: 'IT に不慣れなユーザーでも迷わないよう、Chatwork のルームを開いてタスクパネルからタスクを作成し、期限と担当者を設定するまでを丁寧に案内します。',
  },
  estimatedSteps: 7,
  estimatedSeconds: 240,
  difficulty: 'beginner',
  prerequisites: ['requires-chatwork-account'],
  humanHandoffPoints: [
    {
      when: 'email-verification',
      why: {
        en: 'If Chatwork asks you to verify your email or re-login, do so manually.',
        ja: 'Chatwork からメール確認や再ログインを求められた場合は手動で対応してください。',
      },
    },
  ],
  successCriteria: [
    { kind: 'url', pattern: 'chatwork\\.com/#!rid\\d+' },
    { kind: 'text', pattern: '(タスクを追加しました|Task added|タスク|Tasks)' },
  ],
  expectedSteps: [
    'Open www.chatwork.com and ensure the user is logged in',
    'Select the target room from the room list on the left',
    'Click the Task icon (or "タスク" tab) in the room header to open the Task panel',
    'Click "タスクを追加" (Add Task) button',
    'Type the task title in the text field',
    'Set a due date using the date picker',
    'Assign the task to the correct team member using the assignee dropdown, then click Save',
  ],
  tokenEstimate: { min: 1800, max: 6000 },
  willTouch: [
    'Chatwork room list (left sidebar)',
    'Task panel (タスクパネル)',
    'Add task form (title, due date, assignee)',
  ],
  willNotTouch: [
    'Chat messages',
    'Room settings or member management',
    'Files',
    'Account or billing settings',
  ],
  lastVerifiedAt: '2026-05-17',
};
