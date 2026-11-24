import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMessage } from '../lib/prism-chat-model.js';
import { evaluatePageConfig } from './helpers/page-loader.mjs';

const planBody = '\n\n### 验收内容\n\n' + '完整的计划正文。'.repeat(150);
const markdown = '# 验收计划' + planBody;
const firstId = 'desktop-plan:' + '1'.repeat(64);
const secondId = 'desktop-plan:' + '2'.repeat(64);
const plan = (id = firstId, body = markdown) => ({
  kind: 'plan_review',
  surface_id: id,
  description: body,
  actions: [
    { action_id: id + ':implement', label: '实施此计划', available: true, requires_input: false, accepts_input: false },
    { action_id: id + ':revise', label: '提出修改', available: true, requires_input: true, accepts_input: true }
  ]
});

async function page() {
  const config = await evaluatePageConfig();
  const p = Object.create(config);
  p.data = { ...structuredClone(config.data), surface: 'main', connected: true,
    selectedHostId: 'host', selectedPluginId: 'codex', selectedConversationId: 'conv' };
  p.setData = patch => Object.assign(p.data, patch);
  p.syncLoadingVisuals = () => {};
  p.prepareQuestionSubmission = async () => {};
  p.calls = [];
  p.toasts = [];
  p.showToast = text => p.toasts.push(text);
  p._api = { control: async (...args) => {
    p.calls.push(args);
    return { accepted: true, request_id: 'request' };
  } };
  return p;
}

test('historical plan can be read without deriving actions from message text', async () => {
  const p = await page();
  p.applyMessages([normalizeMessage({ id: 'message', role: 'assistant', content: '<proposed_plan>\n' + markdown + '\n</proposed_plan>' }, 0)], false);
  assert.equal(p.data.planReviewAvailable, true);
  assert.equal(p.data.visibleChatItems.at(-1).kind, 'assistant_plan');
  assert.equal(p.data.visibleChatItems.at(-1).content, '');
  p.handleSurfaceTap('main', Date.now(), { code: 'Enter' });
  assert.equal(p.data.surface, 'quick');
  await p.activateMenuAction('planReview');
  assert.equal(p.data.planReviewMarkdown, '## 验收计划' + planBody);
  assert.equal(p._planReview.markdown, markdown);
  assert.equal(p.data.planReviewActions[0].id, 'back');
  await p.activateFocused();
  assert.equal(p.data.surface, 'main');
  assert.equal(p.calls.length, 0);
});

test('arriving plan leaves chat focused and the decision row opens on continue', async () => {
  const p = await page();
  p.applyDetail({ interactive_surface: plan() });
  assert.equal(p.data.surface, 'main');
  const confirm = { code: 'Enter', preventDefault() {} };
  p.onKeyDown(confirm);
  p.onKeyUp(confirm);
  assert.equal(p.data.surface, 'planReview');
  assert.equal(p.data.menuVisible, false);
  assert.equal(p.data.planReviewOptions, false);
  assert.ok(p.data.planReviewActions.every(action => !action.className.includes('is-focused')));
  p.movePlanReview(1);
  const position = p.data.planReviewTop;
  assert.ok(position > 0);
  await p.activateFocused();
  assert.equal(p.data.planReviewActions[p.data.focusIndex].id, 'continue');
  assert.match(p.data.planReviewActions[0].className, /is-focused/);
  p.movePlanReview(1);
  assert.equal(p.data.planReviewActions[p.data.focusIndex].id, 'implement');
  p.applyDetail({ interactive_surface: plan() });
  assert.equal(p.data.focusIndex, 1);
  p.backOneLevel();
  assert.equal(p.data.planReviewOptions, false);
  assert.equal(p.data.planReviewTop, position);
  await p.activateFocused();
  assert.equal(p.data.focusIndex, 0);
  await p.activateFocused();
  assert.equal(p.data.planReviewTop, position);
  assert.equal(p.calls.length, 0);
});

test('streaming a proposed plan leaves the transcript compact until its reader is opened', async () => {
  const p = await page();
  const message = content => normalizeMessage({ id: 'streaming-plan', role: 'assistant', content }, 0);
  p.applyMessages([message('<proposed_plan>\n' + markdown)], false);
  const item = p.data.visibleChatItems.at(-1);
  assert.equal(item.kind, 'assistant_plan');
  assert.equal(item.content, '');
  assert.equal(p.data.planReviewAvailable, false);

  p.applyMessages([message('<proposed_plan>\n' + markdown + '\n</proposed_plan>')], true);
  assert.equal(p.data.visibleChatItems.at(-1).anchorId, item.anchorId);
  assert.equal(p.data.visibleChatItems.at(-1).content, '');
  assert.equal(p.data.planReviewMarkdown, '## 验收计划' + planBody);
  assert.equal(p.data.surface, 'main');
});

test('explicit implementation uses the native action and waits for live resolution', async () => {
  const p = await page();
  p.applyQuestionDetail(plan());
  p.presentPlanReview();
  await p.activateFocused();
  p.movePlanReview(1);
  await p.activateFocused();
  await p.activateFocused();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0][3], 'interactive.surface.apply');
  assert.deepEqual(p.calls[0][4], { surface_id: firstId, action_id: firstId + ':implement' });
  p.applyDetail({ detail_stale: true, interactive_surface: null });
  assert.equal(p.data.planReviewPending, true);
  assert.ok(p.data.planReviewBusy);
  assert.equal(p.toasts.at(-1), '请求已发送，等待桌面处理');
  p.applyDetail({ interactive_surface: null });
  assert.equal(p.data.planReviewPending, false);
  assert.equal(p._questionBusy, false);
  assert.deepEqual(p.toasts, ['请求已发送，等待桌面处理']);
});

test('a plan replacement does not turn a pending HTTP rejection into success', async () => {
  const p = await page();
  p.applyQuestionDetail(plan());
  p.presentPlanReview({ showOptions: true });
  let reject;
  p._api.control = () => new Promise((resolve, fail) => { reject = fail; });
  const submitting = p.submitPlanReview('implement');
  await Promise.resolve();
  assert.ok(reject);

  p.applyQuestionDetail(plan(secondId, '# 新版计划'));
  assert.deepEqual(p.toasts, ['计划已更新']);
  assert.equal(p._questionBusy, false);
  reject(new Error('control_target_stale'));
  await submitting;
  assert.deepEqual(p.toasts, ['计划已更新', '上一份计划的决定提交失败']);
  assert.equal(p.data.planReviewMarkdown, '## 新版计划');
});

test('a rejection before the old HTTP receipt does not affect the newer plan submission', async () => {
  const p = await page();
  const responses = [];
  p._api.control = () => new Promise(resolve => { responses.push(resolve); });
  p.applyQuestionDetail(plan());
  p.presentPlanReview({ showOptions: true });
  const oldSubmission = p.submitPlanReview('implement');
  await Promise.resolve();
  p.applyQuestionDetail(plan(secondId, '# 新版计划'));
  p.presentPlanReview({ showOptions: true });
  const newSubmission = p.submitPlanReview('implement');
  await Promise.resolve();
  const current = p._questionSubmission;
  const failure = { action: 'interactive.surface.apply', request_id: 'old', code: 'control_target_stale' };
  assert.equal(p.handleQuestionControlFailed(failure), true);
  responses[1]({ accepted: true, request_id: 'new' });
  await newSubmission;
  assert.equal(p.toasts.at(-1), '请求已发送，等待桌面处理');
  responses[0]({ accepted: true, request_id: 'old' });
  await oldSubmission;
  assert.equal(p.toasts.at(-1), '上一份计划的决定提交失败');
  assert.equal(p._questionSubmission, current);
  assert.equal(p._questionBusy, current);
  assert.equal(p.data.planReviewPending, true);
});

test('a delayed refusal can still be matched after the plan disappears', async () => {
  const p = await page();
  p.applyQuestionDetail(plan());
  p.presentPlanReview({ showOptions: true });
  await p.submitPlanReview('implement');
  p.applyQuestionDetail(null);
  assert.equal(p.data.planReviewPending, false);
  assert.equal(p.handleQuestionControlFailed({
    action: 'interactive.surface.apply', request_id: 'request', code: 'control_target_stale'
  }), true);
  assert.deepEqual(p.toasts, ['请求已发送，等待桌面处理', '上一份计划的决定提交失败']);
  assert.equal(p.data.planReviewPending, false);
});

test('leaving plan review presents an approval that arrived while reading', async () => {
  const p = await page();
  p.applyMessages([normalizeMessage({
    role: 'assistant', content: '<proposed_plan>\n' + markdown + '\n</proposed_plan>'
  }, 0)], false);
  p.applyDetail({ interactive_surface: plan() });
  p.presentPlanReview();
  p.applyDetail({ approval: {
    approval_request_id: 'permission-request',
    description: '允许此操作？',
    actions: [{ action_id: 'allow', label: '允许' }]
  } });
  assert.equal(p.data.surface, 'planReview');
  assert.equal(p.data.planReviewPending, false);
  await p.activateFocused();
  assert.equal(p.data.surface, 'approval');
  assert.equal(p.data.approvalText, '允许此操作？');
  assert.equal(p.data.approvalActions[p.data.focusIndex].id, 'allow');
  p.closeMenu();
  p.openQuickMenu();
  assert.equal(p.data.menuButtons[p.data.focusIndex].id, 'approval');
});

test('a replacement resets the plan to reading and cannot receive an old implementation', async () => {
  const p = await page();
  p.applyQuestionDetail(plan());
  p.presentPlanReview();
  p.movePlanReview(1);
  await p.activateFocused();
  p.movePlanReview(1);
  p.prepareQuestionSubmission = async () => p.applyQuestionDetail(plan(secondId, '# 新版计划'));
  await p.activateFocused();
  assert.equal(p.calls.length, 0);
  assert.equal(p.data.planReviewMarkdown, '## 新版计划');
  assert.equal(p.data.planReviewOptions, false);
  assert.equal(p.data.planReviewTop, 0);
});

test('dictated revisions return to the same plan with an explicit separate send', async () => {
  const p = await page();
  p.applyQuestionDetail(plan());
  p.presentPlanReview();
  p.movePlanReview(1);
  const position = p.data.planReviewTop;
  p.startVoiceInput = () => p.setData({ surface: 'voice' });
  await p.activateFocused();
  p.movePlanReview(1);
  p.movePlanReview(1);
  await p.activateFocused();
  assert.equal(p.data.surface, 'voice');
  p.setData({ surface: 'menu', draftText: '加入离线验收' });
  p.finishQuestionVoice();
  assert.equal(p.data.surface, 'planReview');
  assert.equal(p.data.planReviewTop, position);
  assert.equal(p.data.planReviewFeedback, '加入离线验收');
  assert.equal(p.data.planReviewActions[0].id, 'continue');
  assert.equal(p.calls.length, 0);
  await p.activatePlanReview(p.data.planReviewActions.find(action => action.id === 'sendFeedback'));
  assert.deepEqual(p.calls[0][4], {
    surface_id: firstId, action_id: firstId + ':revise', input: '加入离线验收'
  });
});
