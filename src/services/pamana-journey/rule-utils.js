'use strict';

const { planningEligibilityFor } = require('../transport-data/planning-eligibility');
const { unwrapRecord } = require('./graph-builder');

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

const identity = (record) => text(record?.documentId)
  || text(record?.document_id)
  || (record?.id !== undefined && record?.id !== null ? String(record.id) : null);

function calendarDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') {
    const trimmed = value.trim();
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    date = new Date(hasZone ? trimmed : `${trimmed}+08:00`);
  } else date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function effectiveDateReason(record, requestedDate) {
  const date = calendarDate(requestedDate);
  if (!date) return 'REQUESTED_DATE_INVALID';
  if (record?.effective_from && date < String(record.effective_from).slice(0, 10)) {
    return 'NOT_YET_EFFECTIVE';
  }
  if (record?.effective_to && date > String(record.effective_to).slice(0, 10)) {
    return 'EXPIRED';
  }
  return null;
}

function ruleEligibilityFor(rawRecord, {
  requestedDate,
  allowSimulated = false,
  effectiveRecord = rawRecord,
} = {}) {
  const record = unwrapRecord(rawRecord);
  const reasons = planningEligibilityFor(record, { allowSimulated }).reasons.slice();
  const dateReason = effectiveDateReason(unwrapRecord(effectiveRecord), requestedDate);
  if (dateReason) reasons.push(dateReason);
  return Object.freeze({ eligible: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function sourceSummary(record) {
  const source = text(record?.source_name);
  const reference = text(record?.source_reference) || text(record?.source_url);
  if (source && reference) return `${source} — ${reference}`;
  return source || reference;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  calendarDate,
  effectiveDateReason,
  finiteNumber,
  identity,
  ruleEligibilityFor,
  sourceSummary,
  text,
};
