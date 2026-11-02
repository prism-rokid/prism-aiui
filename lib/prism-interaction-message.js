import { t } from './prism-i18n.js';

// Only unwrap standalone native reply envelopes. Ordinary chat, JSON/code
// examples and the raw transport message remain unchanged.
export function interactionMessageFrom(message) {
  if (message.role !== 'user') return null;
  const raw=String(message.content||'').trim();
  const match=raw.match(/^<(send_user_message_question_reply|approval_response|user_approval_response)>\s*([\s\S]*?)\s*<\/\1>$/);
  if (!match) {
    const pending=raw.match(/^<(send_user_message_question_reply|approval_response|user_approval_response)>/);
    return pending && !raw.includes('</'+pending[1]+'>') ? {title:t(pending[1]==='send_user_message_question_reply'?'interaction.questionReply':'interaction.approvalReply'),body:t('interaction.recorded')} : null;
  }
  const question=match[1]==='send_user_message_question_reply';
  const title=t(question?'interaction.questionReply':'interaction.approvalReply');
  let payload;
  try {payload=JSON.parse(match[2]);} catch {return {title,body:t('interaction.recorded')};}
  const rows=Array.isArray(payload)?payload:[payload];
  const safeText=value=>typeof value==='string'?value.trim():'';
  const parts=[];
  for (const row of rows.slice(0,20)) {
    if (!row || typeof row!=='object') continue;
    const prompt=safeText(row.question);
    const answer=safeText(row.answer);
    if (question) {
      if(prompt)parts.push(t('interaction.question',{text:prompt}));
      parts.push(t('interaction.answer',{text:answer||t('interaction.skipped')}));
    } else {
      const decisions={approved:'interaction.approved',approve:'interaction.approved',accepted:'interaction.approved',denied:'interaction.denied',deny:'interaction.denied',rejected:'interaction.denied',cancelled:'interaction.cancelled',canceled:'interaction.cancelled'};
      const decision=decisions[row.decision];
      // Action labels and prose are rendered as text, never as a JSON dump.
      parts.push(decision?t(decision):answer||t('interaction.recorded'));
    }
  }
  return {title,body:parts.join('\n')||t('interaction.recorded')};
}
