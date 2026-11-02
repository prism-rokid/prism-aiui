import { questionSurfaceFrom, questionAnswersReady } from './prism-question.js';
import { decorate } from './prism-chat-model.js';
import { t } from './prism-i18n.js';
import { MENU_CLASS_VISIBLE, MENU_CLASS_HIDDEN, chatLayoutClass } from './prism-surfaces.js';

export const questionMethods = {
  resetQuestionState() {
    this.cancelQuestionVoice();
    this._question = null;
    this._questionAnswers = [];
    this._questionSubmitted = '';
    this._questionBusy = false;
    this.setData({ questionActions: [], questionText: '', questionReply: '', questionPending: false });
  },
  cancelQuestionVoice() {
    if (!this._questionVoice) return;
    this._questionVoice = null;
    if (this.cancelPendingRecognitionStart) this.cancelPendingRecognitionStart('question_changed');
    // Leave voice before abort; late ASR events must not restore its menu.
    this.setData({ surface: 'main', menuVisible: false, menuClass: MENU_CLASS_HIDDEN, listening: false, recognizing: false, draftText: '', restoredDraft: '', voiceHint: '' });
    if (this._recognition) this._recognition.abort();
    this._voiceBaseDraft = '';
    this._lastSessionTranscript = '';
    this._draftHistory = [];
    this._draftFuture = [];
  },
  applyQuestionDetail(value) {
    const next = questionSurfaceFrom(value);
    const changed = (next && next.id || '') !== (this._question && this._question.id || '');
    if (changed) {
      this.cancelQuestionVoice();
      this._questionAnswers = next ? next.questions.map(() => ({selectedOptionIds:[],freeformText:'',skip:false})) : [];
      this._questionIndex = 0;
      this._questionSubmitted = '';
      if (this.data.surface === 'question') this.setData({surface:'main',menuVisible:false,menuClass:MENU_CLASS_HIDDEN});
    }
    this._question = next;
    this.setData({questionPending: !!next && this._questionSubmitted !== next.id});
    if (changed && next && !this._approval && ['main','menu','quick'].includes(this.data.surface)) this.presentQuestionPanel();
    else if (next && this.data.surface === 'question') this.renderQuestionPanel();
  },
  presentQuestionPanel() {
    if (!this._question || this._approval || this._questionSubmitted === this._question.id) return;
    this._questionVoice = null;
    this.setData({surface:'question',menuVisible:true,menuClass:MENU_CLASS_VISIBLE,focusIndex:0,chatClass:chatLayoutClass(this.data.planVisible,false,true)});
    this.renderQuestionPanel();
    this.syncLoadingVisuals();
  },
  renderQuestionPanel() {
    const s=this._question;
    if (!s) return;
    const i=this._questionIndex || 0, q=s.questions[i], answer=this._questionAnswers[i];
    const actions=q.options.map(o=>({id:'option:'+o.id,optionId:o.id,label:(answer.selectedOptionIds.includes(o.id)?'✓ ':'')+o.label}));
    if(q.allow_custom) actions.push({id:'custom',label:t('question.voiceReply')});
    if(i>0) actions.push({id:'previous',label:t('question.previous')});
    if(i<s.questions.length-1) actions.push({id:'next',label:t('question.next')});
    if(s.questions.length>1) actions.push({id:'skipOne',label:t('question.skipOne')});
    actions.push({id:'submit',label:s.submit.label});
    if(s.skip) actions.push({id:'skip',label:s.skip.label});
    const focusIndex=Math.min(this.data.focusIndex||0,actions.length-1);
    this.setData({questionText:(s.questions.length>1?`${i+1}/${s.questions.length} `:'')+q.question,questionReply:answer.freeformText,questionActions:decorate(actions,focusIndex,'prism-menu-button'),focusIndex});
  },
  async activateQuestionAction(item) {
    if (!this._question || this._questionBusy || this._questionSubmitted === this._question.id || !this.data.connected || this._approval) return;
    const i=this._questionIndex||0,q=this._question.questions[i],a=this._questionAnswers[i];
    if(item.id.startsWith('option:')) {
      a.selectedOptionIds=q.multiple ? a.selectedOptionIds.includes(item.optionId)?a.selectedOptionIds.filter(id=>id!==item.optionId):[...a.selectedOptionIds,item.optionId] : [item.optionId];
      if(!q.multiple) a.freeformText='';
      a.skip=false;
    } else if(item.id==='custom') {
      this._questionVoice={surfaceId:this._question.id,conversationId:this.data.selectedConversationId,index:i};
      this._questionSavedDraft=this.data.draftText||'';
      this.setData({draftText:a.freeformText,restoredDraft:''});
      this._draftHistory=[];this._draftFuture=[];
      this.startVoiceInput({ignoreInitialStop:true});
      if (this.data.surface !== 'voice') { this._questionVoice=null; this.setData({draftText:this._questionSavedDraft||''}); }
      return;
    } else if(item.id==='previous') this._questionIndex=Math.max(0,i-1);
    else if(item.id==='next') this._questionIndex=Math.min(this._question.questions.length-1,i+1);
    else if(item.id==='skipOne') { a.skip=!a.skip; if(i<this._question.questions.length-1)this._questionIndex=i+1; }
    else if(item.id==='submit'||item.id==='skip') {await this.submitQuestion(item.id==='skip');return;}
    this.renderQuestionPanel();
  },
  finishQuestionVoice() {
    const context=this._questionVoice;
    if (!context) return false;
    if (!this._question || context.surfaceId!==this._question.id || context.conversationId!==this.data.selectedConversationId) {this.cancelQuestionVoice();return true;}
    const text=String(this.data.draftText||'').trim();
    if(!text || text.length>8192) {this.showToast(t('question.answerRequired'),5);return true;}
    const q=this._question.questions[context.index],a=this._questionAnswers[context.index];
    a.freeformText=text;a.skip=false;if(!q.multiple)a.selectedOptionIds=[];
    this._questionVoice=null;
    this.setData({draftText:this._questionSavedDraft||'',restoredDraft:''});
    this._voiceBaseDraft='';this._draftHistory=[];this._draftFuture=[];
    this.presentQuestionPanel();
    return true;
  },
  async submitQuestion(skip) {
    const s=this._question, conversationId=this.data.selectedConversationId;
    if(!s || !conversationId || !this.data.connected || this._approval || this._questionBusy || this._questionSubmitted===s.id) return;
    const action=skip?s.skip:s.submit;
    if(!action || action.available===false) return;
    if(!skip && !questionAnswersReady(s,this._questionAnswers)) {this.showToast(t('question.answerRequired'),5);return;}
    const operation = {};
    this._questionBusy=operation;
    try {
      const target={surface_id:s.id,action_id:action.action_id};
      if(!skip)target.input=JSON.stringify({answers:this._questionAnswers});
      await this._api.control(this.data.selectedHostId,this.data.selectedPluginId,conversationId,'interactive.surface.apply',target,'',this.data.taskId);
      if(this.data.selectedConversationId!==conversationId || this._question?.id!==s.id)return;
      this._questionSubmitted=s.id;
      this.setData({questionPending:false,surface:'main',menuVisible:false,menuClass:MENU_CLASS_HIDDEN});
      this.rebuildMenu();
      this.showToast(t('question.submitted'),5);
    } catch(error) {
      if(this.data.selectedConversationId===conversationId && this._question?.id===s.id)this.showToast(t('question.failed'),7);
    } finally {if(this._questionBusy===operation)this._questionBusy=false;}
  },
  handleQuestionTap(event) {
    if(this.data.surface!=='question')return;
    const index=Number(event.currentTarget?.dataset?.index||0);
    this.setData({focusIndex:index});
    const item=this.data.questionActions[index];
    if(item)this.activateQuestionAction(item);
  }
};
