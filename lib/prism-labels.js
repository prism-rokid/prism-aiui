// Display formatting: compact labels for the topbar, option/control item
// shaping for the settings panels, approval action shaping, and time labels.

import { t } from './prism-i18n.js';

export function processingLabel(message) {
  const duration = Number(message.duration_ms || 0) || Math.max(0, Number(message.updated_at || 0) - Number(message.created_at || 0));
  const seconds = Math.max(0, Math.floor(duration / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h${Math.floor(seconds % 3600 / 60)}m`;
}

export function optionIdentity(option) {
  if (!option) return '';
  const target = option.target && typeof option.target === 'object' ? option.target : {};
  return String(target.option_id || option.option_id || option.id || '');
}

export function optionLabel(option) {
  if (!option) return '';
  return String(option.display_name || option.displayName || option.label || option.title || option.id || optionIdentity(option) || '');
}

export function interactiveControlValue(controls, controlId) {
  if (!Array.isArray(controls)) return '';
  const control = controls.find((item) => item && (item.control_id || item.controlId || item.id) === controlId);
  if (!control) return '';
  return String(control.current_value || control.currentValue || control.value || '').trim();
}

export function displayOption(value, fallback) {
  if (!value) return fallback;
  return { id: value, label: value };
}

export function compactModelLabel(model) {
  return String(optionLabel(model) || '--');
}

export function compactReasoningLabel(reasoning) {
  const value = String(optionIdentity(reasoning) || optionLabel(reasoning) || '').toLowerCase();
  if (value.indexOf('high') >= 0) return t('label.reasoning.high');
  if (value.indexOf('medium') >= 0) return t('label.reasoning.medium');
  if (value.indexOf('low') >= 0) return t('label.reasoning.low');
  return value ? value.slice(0, 1) : '--';
}

function permissionValue(permission) {
  let rawValue = typeof permission === 'string'
    ? permission
    : permission && (permission.label || permission.name || permission.id) || '';
  const text = String(rawValue).trim();
  if (text.charAt(0) === '{') {
    try {
      const parsed = JSON.parse(text);
      rawValue = parsed.type || parsed.mode || parsed.id || parsed.name || text;
    } catch (error) {}
  }
  return String(rawValue).toLowerCase();
}

export function compactPermissionLabel(permission, approvalMode = '') {
  const value = `${permissionValue(permission)} ${String(approvalMode || '').toLowerCase()}`;
  if (value.indexOf('disabled') >= 0
    || value.indexOf('full') >= 0
    || value.indexOf('danger') >= 0
    || value.indexOf('unrestricted') >= 0) return t('label.permission.fullAccess');
  if (value.indexOf('untrusted') >= 0 || value.indexOf('on-failure') >= 0 || value.indexOf('auto') >= 0) return t('label.permission.autoApprove');
  if (value.indexOf('request') >= 0 || value.indexOf('read-only') >= 0 || value.indexOf('workspace-write') >= 0) return t('label.permission.requestApproval');
  if (value.indexOf('custom') >= 0) return t('label.permission.custom');
  const fallback = permissionValue(permission);
  return fallback ? fallback.slice(0, 4) : '--';
}

export function compactContextLabel(detail, run) {
  const context = detail && (detail.context || detail.context_window) || run && run.context || {};
  const percent = Number(context.percent !== undefined ? context.percent : context.usage_percent);
  if (Number.isFinite(percent)) return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  const used = Number(context.used_tokens !== undefined ? context.used_tokens : context.used);
  const limit = Number(context.max_tokens !== undefined ? context.max_tokens : (context.limit !== undefined ? context.limit : context.total));
  if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) return `${Math.max(0, Math.min(100, Math.round(used / limit * 100)))}%`;
  return '';
}

export function compactDisplayText(value, maxUnits) {
  const source = String(value || '');
  let units = 0;
  let result = '';
  for (const character of source) {
    const characterUnits = /[\u0000-\u00ff]/.test(character) ? 1 : 2;
    if (units + characterUnits > maxUnits - 3) return `${result}...`;
    result += character;
    units += characterUnits;
  }
  return result;
}

export function singleLineDisplayText(value, maxUnits) {
  return compactDisplayText(String(value || '').replace(/\s+/g, ' ').trim(), maxUnits);
}

export function projectDisplayName(cwd) {
  const normalized = String(cwd || '').replace(/[\\/]+$/, '');
  if (!normalized) return t('label.project.uncategorized');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return singleLineDisplayText(segments[segments.length - 1] || normalized, 42);
}

export function relativeTimeLabel(timestamp, now = Date.now()) {
  const time = Number(timestamp) || 0;
  if (!time) return '';
  const delta = Math.max(0, now - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return t('label.time.justNow');
  if (delta < hour) return t('label.time.minutesAgo', { n: Math.floor(delta / minute) });
  if (delta < day) return t('label.time.hoursAgo', { n: Math.floor(delta / hour) });
  const previousDayStart = new Date(now - day);
  previousDayStart.setHours(0, 0, 0, 0);
  if (time >= previousDayStart.getTime()) return t('label.time.yesterday');
  if (delta < 7 * day) return t('label.time.daysAgo', { n: Math.floor(delta / day) });
  const date = new Date(time);
  return t('label.time.date', { m: date.getMonth() + 1, d: date.getDate() });
}

export function approvalActionsFrom(approval) {
  return (approval && approval.actions || [])
    .map((action, index) => ({
      ...action,
      id: action && (action.id || action.action_id) || `approval-${index}`,
      label: action && (action.label || action.title || action.text || action.id || action.action_id) || ''
    }))
    .filter((action) => action.label && action.available !== false);
}

export function controlOptionItems(options, action, currentId) {
  return (options || [])
    .map((option) => {
      const optionId = optionIdentity(option);
      return {
        ...option,
        id: optionId,
        label: optionLabel(option),
        action,
        target: { option_id: optionId }
      };
    })
    .filter((item) => item.id && item.available !== false)
    .map((item) => ({ ...item, selected: item.id === currentId }));
}
