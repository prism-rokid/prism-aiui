// Public questionnaire schema shared with the web Panel. Native request
// callbacks and metadata stay on the desktop; answers use surface.apply.
export function questionSurfaceFrom(value) {
  if (!value || value.kind !== 'questionnaire' || typeof value.surface_id !== 'string' || !value.surface_id || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 20 || !Array.isArray(value.actions)) return null;
  const ids = new Set();
  for (const q of value.questions) {
    if (!q || typeof q.id !== 'string' || !q.id || ids.has(q.id) || typeof q.question !== 'string' || !q.question || !Array.isArray(q.options) || q.options.length > 100) return null;
    ids.add(q.id);
    const options = new Set();
    for (const o of q.options) {
      if (!o || typeof o.id !== 'string' || !o.id || options.has(o.id) || typeof o.label !== 'string' || !o.label) return null;
      options.add(o.id);
    }
    if (!q.options.length && q.allow_custom !== true) return null;
  }
  const submits = value.actions.filter(a => a && a.purpose === 'submit_answers');
  const skips = value.actions.filter(a => a && a.purpose === 'skip_questions');
  const valid = a => a && typeof a.action_id === 'string' && a.action_id && typeof a.label === 'string' && a.label;
  if (submits.length !== 1 || skips.length > 1 || !valid(submits[0]) || (skips.length && (!valid(skips[0]) || skips[0].action_id === submits[0].action_id))) return null;
  return { id: value.surface_id, questions: value.questions.map(q => ({...q, options: q.options.map(o => ({id:o.id,label:o.label}))})), submit: submits[0], skip: skips[0] || null };
}
export function questionAnswersReady(surface, answers) {
  return !!surface && answers.length === surface.questions.length && surface.questions.every((q,i) => {
    const a=answers[i];
    return a && (a.skip || (Array.isArray(a.selectedOptionIds) && new Set(a.selectedOptionIds).size === a.selectedOptionIds.length && (q.multiple || a.selectedOptionIds.length <= 1) && a.selectedOptionIds.every(id=>q.options.some(o=>o.id===id)) && typeof a.freeformText === 'string' && a.freeformText.length <= 8192 && (!a.freeformText.trim() || q.allow_custom) && (a.selectedOptionIds.length || a.freeformText.trim())));
  });
}
