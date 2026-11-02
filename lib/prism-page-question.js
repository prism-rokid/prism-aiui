import { questionSurfaceFrom, questionAnswersReady } from './prism-question.js';
import { decorate } from './prism-chat-model.js';
import { t } from './prism-i18n.js';
import { MENU_CLASS_VISIBLE, MENU_CLASS_HIDDEN, chatLayoutClass } from './prism-surfaces.js';
import { trace } from './prism-trace.js';

export const questionMethods = {
  resetQuestionState() {
    if (this._questionPreparation) this._questionPreparation.finish(new Error('question_context_changed'));
    this.cancelQuestionVoice();
    this._question = null;
    this._questionAnswers = [];
    this._questionSubmitted = '';
    this._questionBusy = false;
    this._questionSubmission = null;
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
    const preparation = this._questionPreparation;
    if (preparation) {
      // Activation and the canonical watcher projection converge separately.
      // An interim empty projection cannot invalidate the preserved answer.
      if (!preparation.armed || !next) return;
      preparation.finish(next.id === preparation.surfaceId ? null : new Error('control_target_stale'));
    }
    const changed = (next && next.id || '') !== (this._question && this._question.id || '');
    if (changed) {
      const submission = this._questionSubmission;
      if (submission && submission.dispatched && submission.surfaceId === this._question?.id) {
        submission.completed = true;
        this._questionSubmission = null;
        this._questionBusy = false;
        this.showToast(t('question.submitted'), 5);
      }
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
    this.setData({questionText:(s.questions.length>1?`${i+1}/${s.questions.length} `:'')+q.question,questionReply:answer.freeformText,questionActions:decorate(actions.map(action=>({...action,disabled:!!this._questionBusy})),focusIndex,'prism-menu-button'),focusIndex});
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
    const operation = { surfaceId:s.id, conversationId, requestId:'' };
    this._questionBusy=operation;
    this._questionSubmission=operation;
    this.renderQuestionPanel();
    try {
      await this.prepareQuestionSubmission(operation);
      if(operation.failed || operation.completed || this._questionSubmission!==operation
        || this.data.selectedConversationId!==conversationId || this._question?.id!==s.id)return;
      if((skip?this._question.skip:this._question.submit)?.available===false)throw new Error('control_target_stale');
      const target={surface_id:s.id,action_id:action.action_id};
      if(!skip)target.input=JSON.stringify({answers:this._questionAnswers});
      operation.dispatched=true;
      trace('question.submit.dispatch',{conversationId,surfaceId:s.id});
      const result=await this._api.control(this.data.selectedHostId,this.data.selectedPluginId,conversationId,'interactive.surface.apply',target,'',this.data.taskId);
      if(operation.failed || operation.completed)return;
      if(this.data.selectedConversationId!==conversationId || this._question?.id!==s.id)return;
      operation.requestId=result && result.request_id || '';
      if(result && result.accepted===true) {
        // HTTP 202 queues the command. The live question lifecycle confirms
        // completion; control_failed must still be able to restore the reply.
        operation.accepted=true;
        this.showToast(t('question.submitting'),5);
        return;
      }
      this._questionSubmission=null;
      this._questionSubmitted=s.id;
      this.setData({questionPending:false,surface:'main',menuVisible:false,menuClass:MENU_CLASS_HIDDEN});
      this.rebuildMenu();
      this.showToast(t('question.submitted'),5);
    } catch(error) {
      trace('question.submit.failed',{conversationId,surfaceId:s.id,code:error && (error.code || error.message) || ''});
      if(this._questionSubmission===operation) {
        this.handleQuestionControlFailed({action:'interactive.surface.apply',code:error && (error.code || error.message) || ''});
      }
    } finally {
      if(this._questionBusy===operation && !operation.accepted) {
        this._questionBusy=false;
        if(this.data.surface==='question')this.renderQuestionPanel();
      }
    }
  },
  async prepareQuestionSubmission(operation) {
    // Controls require a live desktop target, even if a cached question is
    // still visible after desktop navigation. Activate before refreshing it.
    let finish, preparation;
    const ready = new Promise((resolve, reject) => {
      preparation = {surfaceId:operation.surfaceId, armed:false, finish:error=>{
        if(this._questionPreparation!==preparation)return;
        clearTimeout(preparation.timer);
        this._questionPreparation=null;
        if(error)reject(error);else resolve();
      }};
      preparation.timer=setTimeout(()=>preparation.finish(new Error('control_target_stale')),15000);
      this._questionPreparation=preparation;
      finish=preparation.finish;
    });
    // Attach the rejection handler before network I/O, since navigating away
    // can cancel preparation while activation is still awaiting its response.
    ready.catch(()=>{});
    try {
      trace('question.submit.activate',{conversationId:operation.conversationId,surfaceId:operation.surfaceId});
      await this._api.setSelection({
        selected_host_id:this.data.selectedHostId,
        selected_plugin_id:this.data.selectedPluginId,
        selected_conversation_id:operation.conversationId,
        activate_desktop:true
      });
      if(this._questionSubmission!==operation || this.data.selectedConversationId!==operation.conversationId)throw new Error('question_context_changed');
      preparation.armed=true;
      // Re-open read-only state after activation, so an unchanged question
      // still produces a snapshot even if the watcher signature is identical.
      this.openConversationStream();
      await ready;
      trace('question.submit.ready',{conversationId:operation.conversationId,surfaceId:operation.surfaceId});
    } catch(error) {
      finish(error);
      throw error;
    }
  },
  handleQuestionControlFailed(frame) {
    const operation=this._questionSubmission;
    if(frame.action!=='interactive.surface.apply' || !operation
      || (operation.requestId && frame.request_id && operation.requestId!==frame.request_id))return false;
    operation.failed=true;
    this._questionSubmission=null;
    this._questionBusy=false;
    if(this.data.selectedConversationId===operation.conversationId && this._question?.id===operation.surfaceId) {
      this._questionSubmitted='';
      this.setData({questionPending:true});
      this.presentQuestionPanel();
    } else if(this.data.surface==='question')this.renderQuestionPanel();
    this.showToast(t(frame.code==='control_target_stale'?'question.stale':'question.failed'),7);
    // Fetch the current request identity after an explicit rejection. Never
    // replay an accepted command automatically: its late outcome may be unknown.
    if(frame.code==='control_target_stale' && this._convStream)this.openConversationStream();
    return true;
  },
  handleQuestionTap(event) {
    if(this.data.surface!=='question')return;
    const index=Number(event.currentTarget?.dataset?.index||0);
    this.setData({focusIndex:index});
    const item=this.data.questionActions[index];
    if(item)this.activateQuestionAction(item);
  }
};
