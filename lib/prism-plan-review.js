import { decorate, proposedPlanMarkdown } from './prism-chat-model.js';
import { t } from './prism-i18n.js';
import { chatLayoutClass, MENU_CLASS_HIDDEN } from './prism-surfaces.js';
import { trace } from './prism-trace.js';

export function planReviewSurfaceFrom(value) {
  // Use the canonical detail fields retained by the Hub for all surfaces.
  if (value?.kind !== 'plan_review' || !/^desktop-plan:[0-9a-f]{64}$/.test(value.surface_id || '') ||
    typeof value.description !== 'string' || !value.description.trim() ||
    !Array.isArray(value.actions)) return null;
  const implement = value.actions.filter(action => action?.action_id === value.surface_id + ':implement');
  const revise = value.actions.filter(action => action?.action_id === value.surface_id + ':revise');
  if (implement.length !== 1 || revise.length > 1 ||
    implement[0].requires_input === true || (revise[0] && revise[0].requires_input !== true)) return null;
  return {
    id: value.surface_id,
    plan: value.description.trim(),
    implement: implement[0],
    submit: revise[0] || null,
    questions: [{ options: [], allow_custom: true }]
  };
}

export function latestProposedPlan(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const markdown = proposedPlanMarkdown(message.content);
    if (markdown) return { id: message.id, markdown };
  }
  return null;
}

export const planReviewMethods = {
  syncPlanReview() {
    const pending = this.data.questionPending && this._question?.plan ? this._question : null;
    const current = pending
      ? { id: pending.id, markdown: pending.plan, pending: true }
      : this._latestProposedPlan;
    const previous = this._planReview;
    const changed = previous?.id !== current?.id || previous?.markdown !== current?.markdown;
    const displayed = this.data.surface === 'planReview';
    this._planReview = current;
    if (changed && current) {
      const newVersion = previous?.markdown !== current.markdown ||
        (previous?.pending && current.pending && previous.id !== current.id);
      if (newVersion) this.setData({ planReviewTop: 0 });
      if (displayed) {
        this.setData({ planReviewOptions: false, focusIndex: 0 });
        if (previous && newVersion) this.showToast(t('review.updated'), 5);
      }
    } else if (!current && displayed) {
      this.closePlanReview();
    }
    const patch = {
      planReviewAvailable: Boolean(current),
      planReviewPending: Boolean(pending),
      planReviewShortcut: Boolean(pending && !this._approval),
      // Streamdown fixes heading sizes by level. Render the plan title at 24px.
      planReviewMarkdown: current?.markdown.replace(/^( {0,3})#(?=[ \t])/, '$1##') || ''
    };
    if (Object.keys(patch).some(key => patch[key] !== this.data[key])) this.setData(patch);
    if (this.data.surface === 'planReview') this.renderPlanReviewActions();
  },

  presentPlanReview({ showOptions = false } = {}) {
    if (!this._planReview || this._approval) return;
    this.setData({
      surface: 'planReview',
      menuVisible: false,
      menuClass: MENU_CLASS_HIDDEN,
      planReviewOptions: Boolean(showOptions && this.data.planReviewPending),
      focusIndex: 0
    });
    this.renderPlanReviewActions();
    this.syncLoadingVisuals();
    trace('plan.review.open', { actionable: this.data.planReviewPending, top: this.data.planReviewTop });
    return true;
  },

  closePlanReview() {
    this.setData({
      surface: 'main', planReviewOptions: false,
      menuVisible: false, menuClass: MENU_CLASS_HIDDEN, chatClass: chatLayoutClass(this.data.planVisible)
    });
    if (this._approval && this.data.approvalActions.length) {
      this.presentApprovalPanel();
      return;
    }
    this.rebuildMenu();
    this.syncLoadingVisuals();
  },

  backFromPlanReview() {
    if (!this.data.planReviewOptions) return this.closePlanReview();
    this.setData({ planReviewOptions: false, focusIndex: 0 });
    this.renderPlanReviewActions();
    trace('plan.review.resume', { top: this.data.planReviewTop });
  },

  movePlanReview(direction) {
    if (this.data.planReviewOptions) return this.moveSurfaceFocus(direction);
    const entity = typeof this.querySelector === 'function' && this.querySelector('.prism-plan-review-body');
    const top = this.data.planReviewTop;
    const height = entity?.clientHeight || 210;
    const max = Number.isFinite(entity?.scrollHeight)
      ? Math.max(0, entity.scrollHeight - height)
      : Math.max(0, Math.ceil(this.data.planReviewMarkdown.length / 26) * 22 - height);
    const next = Math.max(0, Math.min(max, top + direction * Math.round(height * 0.8)));
    if (next !== top) this.setData({ planReviewTop: next });
    trace('plan.review.scroll', { top: next });
    return true;
  },

  renderPlanReviewActions() {
    const actions = [];
    if (!this.data.planReviewOptions) {
      actions.push(this.data.planReviewPending
        ? { id: 'options', label: t('review.options') }
        : { id: 'back', label: t('review.back') });
    } else {
      actions.push({ id: 'continue', label: t('review.continue') });
      const busy = Boolean(this._questionBusy) || !this.data.connected || Boolean(this._approval);
      if (this._question?.implement) actions.push({
        id: 'implement', label: t('review.implement'), disabled: busy || this._question.implement.available === false
      });
      if (this._question?.submit) actions.push({
        id: 'revise',
        label: t(this._questionAnswers[0]?.freeformText ? 'review.editFeedback' : 'review.revise'),
        disabled: busy || this._question.submit.available === false
      });
      if (this._question?.submit && this._questionAnswers[0]?.freeformText) actions.push({
        id: 'sendFeedback', label: t('review.sendFeedback'), disabled: busy || this._question.submit.available === false
      });
    }
    const focusIndex = Math.min(this.data.focusIndex, actions.length - 1);
    const decorated = decorate(actions.map(action => ({ disabled: false, ...action })),
      this.data.planReviewOptions ? focusIndex : -1, 'prism-menu-button');
    const patch = {
      focusIndex,
      planReviewFeedback: this.data.planReviewOptions ? this._questionAnswers?.[0]?.freeformText || '' : '',
      planReviewBusy: Boolean(this._questionBusy) && this.data.planReviewPending
    };
    const previous = this.data.planReviewActions;
    if (previous.length !== decorated.length || decorated.some((action, index) =>
      action.id !== previous[index].id || action.label !== previous[index].label || action.className !== previous[index].className)) {
      patch.planReviewActions = decorated;
    }
    if (Object.keys(patch).some(key => patch[key] !== this.data[key])) this.setData(patch);
  },

  async activatePlanReview(item) {
    if (!item || item.disabled || this.data.surface !== 'planReview') return;
    if (item.id === 'back' || item.id === 'continue') return this.backFromPlanReview();
    if (this._approval) return;
    if (item.id === 'options') {
      if (!this.data.planReviewPending) return;
      this.setData({ planReviewOptions: true, focusIndex: 0 });
      this.renderPlanReviewActions();
      trace('plan.review.options', { focus: 'continue', top: this.data.planReviewTop });
      return;
    }
    if (!this.data.planReviewOptions || !this.data.planReviewPending) return;
    if (item.id === 'revise') return this.startQuestionVoice();
    return this.submitPlanReview(item.id);
  },

  handlePlanReviewTap(event) {
    if (this.data.surface !== 'planReview') return;
    const index = Number(event.currentTarget?.dataset?.index);
    const item = this.data.planReviewActions[index];
    if (!item) return;
    this.setData({ focusIndex: index });
    return this.activatePlanReview(item);
  }
};
