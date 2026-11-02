import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePageConfig } from './helpers/page-loader.mjs';
import {questionSurfaceFrom} from '../lib/prism-question.js';
const surface=(id='s1',questions=[{id:'q1',question:'今晚吃什么？',options:[{id:'0',label:'火锅'},{id:'1',label:'日料'}],allow_custom:true}])=>({surface_id:id,kind:'questionnaire',questions,actions:[{action_id:id+':submit',label:'发送',purpose:'submit_answers'},{action_id:id+':skip',label:'跳过',purpose:'skip_questions'}]});
async function page(){const config=await evaluatePageConfig();const p=Object.create(config);p.data=structuredClone(config.data);Object.assign(p.data,{surface:'main',connected:true,selectedHostId:'host',selectedPluginId:'codex',selectedConversationId:'conv'});p.setData=patch=>Object.assign(p.data,patch);p.syncLoadingVisuals=()=>{};p.showToast=()=>{};p.calls=[];p.prepareQuestionSubmission=async()=>{};p._api={control:async(...args)=>{p.calls.push(args)}};return p;}
test('question opens like approval and emits structured answers once, never a chat message',async()=>{const p=await page();p.applyQuestionDetail(surface());assert.equal(p.data.surface,'question');await p.activateQuestionAction(p.data.questionActions[0]);await p.submitQuestion(false);await p.submitQuestion(false);assert.equal(p.calls.length,1);assert.equal(p.calls[0][3],'interactive.surface.apply');const target=p.calls[0][4];assert.equal(target.surface_id,'s1');assert.deepEqual(JSON.parse(target.input).answers[0].selectedOptionIds,['0']);assert.equal(p.data.questionPending,false);});
test('empty and offline replies cannot be submitted',async()=>{const p=await page();p.applyQuestionDetail(surface());await p.submitQuestion(false);assert.equal(p.calls.length,0);await p.activateQuestionAction(p.data.questionActions[0]);p.data.connected=false;await p.submitQuestion(false);assert.equal(p.calls.length,0);});
test('custom reply uses voice, returns to question for explicit send, and preserves identity',async()=>{const p=await page();p.startVoiceInput=()=>p.setData({surface:'voice'});p.applyQuestionDetail(surface());await p.activateQuestionAction({id:'custom'});assert.equal(p.data.surface,'voice');p.setData({surface:'menu',draftText:'清淡一点'});p.rebuildMenu();assert.equal(p.data.menuButtons[0].id,'questionVoiceDone');await p.sendDraft();assert.equal(p.data.surface,'question');assert.equal(p.calls.length,0);assert.equal(p.data.questionReply,'清淡一点');await p.submitQuestion(false);assert.equal(JSON.parse(p.calls[0][4].input).answers[0].freeformText,'清淡一点');});
test('request disappearing while recording aborts voice and invalidates the answer',async()=>{const p=await page();let aborted=0;p._recognition={abort(){aborted++}};p.startVoiceInput=()=>p.setData({surface:'voice',listening:true});p.applyQuestionDetail(surface());await p.activateQuestionAction({id:'custom'});p.applyQuestionDetail(null);assert.equal(aborted,1);assert.equal(p._questionVoice,null);assert.equal(p.data.draftText,'');await p.submitQuestion(false);assert.equal(p.calls.length,0);});
test('same request updates retain choices; new request resets them',async()=>{const p=await page();p.applyQuestionDetail(surface());await p.activateQuestionAction(p.data.questionActions[0]);p.applyQuestionDetail(surface());assert.deepEqual(p._questionAnswers[0].selectedOptionIds,['0']);p.applyQuestionDetail(surface('s2'));assert.deepEqual(p._questionAnswers[0].selectedOptionIds,[]);});
test('multi select and multiple questions retain answers and support skipping one',async()=>{const p=await page();const q=[{id:'a',question:'A',multiple:true,options:[{id:'0',label:'a'},{id:'1',label:'b'}]},{id:'b',question:'B',options:[],allow_custom:true}];p.applyQuestionDetail(surface('s',q));await p.activateQuestionAction({id:'option:0',optionId:'0'});await p.activateQuestionAction({id:'option:1',optionId:'1'});await p.activateQuestionAction({id:'next'});await p.activateQuestionAction({id:'skipOne'});await p.submitQuestion(false);const a=JSON.parse(p.calls[0][4].input).answers;assert.deepEqual(a[0].selectedOptionIds,['0','1']);assert.equal(a[1].skip,true);});
test('skip all sends only request and action identities',async()=>{const p=await page();p.applyQuestionDetail(surface());await p.submitQuestion(true);assert.deepEqual(p.calls[0][4],{surface_id:'s1',action_id:'s1:skip'});});
test('malformed question schemas fail closed',()=>{assert.equal(questionSurfaceFrom({...surface(),questions:[]}),null);assert.equal(questionSurfaceFrom(surface('s',[{id:'a',question:'A',options:[{id:'0',label:'a'},{id:'0',label:'b'}]}])),null);});

test('stale stream snapshots keep a pending question and its selected answer until live resolution',async()=>{
  const p=await page();
  const record={hostId:'host',pluginId:'codex',conversationId:'conv',streamId:'question-test',openedAt:Date.now()};
  p._convStream=record;
  p.scheduleEmptyConversationSettle=()=>{};
  const snapshot=detail=>p.handleStreamFrame(record,{type:'conversation.snapshot',detail});
  snapshot({desktop_foreground:true,detail_stale:false,interactive_surface:surface()});
  await p.activateQuestionAction(p.data.questionActions[1]);
  p.moveSurfaceFocus(1);
  for(const flags of [{desktop_foreground:false,detail_stale:true},{detail_stale:true},{desktop_foreground:false}]) {
    snapshot({...flags,interactive_surface:null});
    assert.equal(p.data.surface,'question');
    assert.equal(p.data.questionPending,true);
    assert.deepEqual(p._questionAnswers[0].selectedOptionIds,['1']);
    assert.equal(p.data.focusIndex,1);
  }
  snapshot({desktop_foreground:true,detail_stale:false,interactive_surface:surface()});
  assert.deepEqual(p._questionAnswers[0].selectedOptionIds,['1']);
  snapshot({desktop_foreground:true,detail_stale:false,interactive_surface:null});
  assert.equal(p.data.questionPending,false);
  assert.equal(p.data.surface,'main');
  assert.equal(p._question,null);
});

test('stale snapshots do not abort a dictated question reply; switching conversations clears it',async()=>{
  const p=await page();let aborted=0;
  p._recognition={abort(){aborted++}};
  p.startVoiceInput=()=>p.setData({surface:'voice',listening:true});
  p.applyDetail({desktop_foreground:true,detail_stale:false,interactive_surface:surface()});
  await p.activateQuestionAction({id:'custom'});
  p.applyDetail({desktop_foreground:false,detail_stale:true,interactive_surface:null});
  assert.equal(p.data.surface,'voice');
  assert.equal(aborted,0);
  assert.ok(p._questionVoice);
  p.resetQuestionState();
  assert.equal(aborted,1);
  assert.equal(p._question,null);
  assert.equal(p.data.questionPending,false);
});

test('HTTP 202 waits for live resolution and blocks duplicate answer submissions',async()=>{
  const p=await page(),toasts=[];p.showToast=text=>toasts.push(text);
  p._api.control=async(...args)=>{p.calls.push(args);return {accepted:true,request_id:'req1'}};
  p.applyQuestionDetail(surface());
  await p.activateQuestionAction(p.data.questionActions[0]);
  await p.submitQuestion(false);
  await p.submitQuestion(false);
  assert.equal(p.calls.length,1);
  assert.equal(p.data.surface,'question');
  assert.equal(p.data.questionPending,true);
  assert.equal(toasts.includes('答案已提交'),false);
  assert.ok(p.data.questionActions.every(action=>action.disabled));
  p.applyQuestionDetail(surface());
  assert.ok(p._questionBusy,'an unchanged snapshot does not confirm submission');
  p.applyQuestionDetail(null);
  assert.equal(p.data.surface,'main');
  assert.equal(p._questionBusy,false);
  assert.equal(toasts.at(-1),'答案已提交');
});

test('async rejection restores choices, matches request id, and refreshes a stale target',async()=>{
  const p=await page(),toasts=[];p.showToast=text=>toasts.push(text);
  p._api.control=async()=>({accepted:true,request_id:'req1'});
  p.applyQuestionDetail(surface());
  await p.activateQuestionAction(p.data.questionActions[1]);
  await p.submitQuestion(false);
  const record={hostId:'host',pluginId:'codex',conversationId:'conv',streamId:'question-test',openedAt:Date.now()};
  p._convStream=record;let refreshes=0;p.openConversationStream=()=>{refreshes++};
  const failure={type:'conversation.control_failed',action:'interactive.surface.apply',code:'control_target_stale',message:'pluginbridge plugin adapter.controlSession failed',request_id:'req1'};
  assert.equal(p.handleQuestionControlFailed({...failure,request_id:'other'}),false);
  assert.ok(p._questionBusy);
  p.handleStreamFrame(record,failure);
  assert.equal(p._questionBusy,false);
  assert.equal(p.data.surface,'question');
  assert.equal(p.data.questionPending,true);
  assert.deepEqual(p._questionAnswers[0].selectedOptionIds,['1']);
  assert.ok(p.data.questionActions.every(action=>!action.disabled));
  assert.equal(refreshes,1);
  assert.equal(toasts.at(-1),'问题状态已变化，答案未提交，请确认后重试');
  assert.equal(toasts.some(text=>text.includes('pluginbridge')),false);
});

test('a rejection arriving before HTTP 202 cannot be overwritten by acceptance',async()=>{
  const p=await page(),toasts=[];p.showToast=text=>toasts.push(text);let accept;
  p._api.control=()=>new Promise(resolve=>{accept=resolve});
  p.applyQuestionDetail(surface());
  await p.activateQuestionAction(p.data.questionActions[0]);
  const submission=p.submitQuestion(false);
  await Promise.resolve();
  p.handleQuestionControlFailed({action:'interactive.surface.apply',request_id:'early',code:'control_target_stale'});
  accept({accepted:true,request_id:'early'});await submission;
  assert.equal(p._questionBusy,false);
  assert.equal(p.data.questionPending,true);
  assert.equal(toasts.includes('答案已提交'),false);
  assert.equal(toasts.includes('正在提交答案'),false);
});

test('answer activation waits for a fresh matching question before the control request',async()=>{
  const p=await page(),steps=[];
  delete p.prepareQuestionSubmission;
  const live=value=>p.applyDetail({desktop_foreground:true,detail_stale:false,interactive_surface:value});
  live(surface());await p.activateQuestionAction(p.data.questionActions[1]);
  p._api.setSelection=async selection=>{
    steps.push('activate');assert.equal(selection.activate_desktop,true);
    assert.equal(selection.selected_conversation_id,'conv');
    live(surface()); // An earlier snapshot while activation is in flight cannot settle readiness.
  };
  p.openConversationStream=()=>{
    steps.push('fresh-stream');
    p.applyDetail({desktop_foreground:false,detail_stale:true,interactive_surface:null});
    live(null); // Canonical projection can briefly lag behind activation.
    assert.deepEqual(p._questionAnswers[0].selectedOptionIds,['1']);
    assert.equal(p.calls.length,0);
    live(surface());
  };
  p._api.control=async(...args)=>{steps.push('control');p.calls.push(args);return {accepted:true,request_id:'req-ready'}};
  await p.submitQuestion(false);
  assert.deepEqual(steps,['activate','fresh-stream','control']);
  assert.deepEqual(JSON.parse(p.calls[0][4].input).answers[0].selectedOptionIds,['1']);
  assert.equal(p._questionPreparation,null);
  live(null);
});

test('a different question after activation never receives the old answer or a success toast',async()=>{
  const p=await page(),toasts=[];p.showToast=text=>toasts.push(text);
  delete p.prepareQuestionSubmission;
  p.applyQuestionDetail(surface());await p.activateQuestionAction(p.data.questionActions[0]);
  p._api.setSelection=async()=>({});
  p.openConversationStream=()=>p.applyDetail({desktop_foreground:true,detail_stale:false,interactive_surface:surface('new-question')});
  await p.submitQuestion(false);
  assert.equal(p.calls.length,0);
  assert.equal(p._question.id,'new-question');
  assert.equal(p._questionBusy,false);
  assert.ok(p.data.questionActions.every(action=>!action.disabled));
  assert.equal(toasts.includes('答案已提交'),false);
});

test('failed activation cannot send a question control',async()=>{
  const p=await page();p.applyQuestionDetail(surface());await p.activateQuestionAction(p.data.questionActions[0]);
  delete p.prepareQuestionSubmission;
  p._api.setSelection=async()=>{throw new Error('activation_failed')};
  await p.submitQuestion(false);
  assert.equal(p.calls.length,0);
  assert.equal(p._questionPreparation,null);
  assert.equal(p._questionBusy,false);
  assert.deepEqual(p._questionAnswers[0].selectedOptionIds,['0']);
});

test('switching conversation while activation is pending cancels submission',async()=>{
  const p=await page();p.applyQuestionDetail(surface());await p.activateQuestionAction(p.data.questionActions[0]);
  delete p.prepareQuestionSubmission;
  let activated;p._api.setSelection=()=>new Promise(resolve=>{activated=resolve});
  const pending=p.submitQuestion(false);
  p.resetQuestionState();p.data.selectedConversationId='another';
  activated({});await pending;
  assert.equal(p.calls.length,0);
  assert.equal(p._questionPreparation,null);
  assert.equal(p._questionBusy,false);
});
