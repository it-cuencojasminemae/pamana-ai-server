'use strict';

const { unwrapRecord } = require('./graph-builder');
const { LEG_TYPE } = require('./types');
const {
  finiteNumber,
  identity,
  ruleEligibilityFor,
  sourceSummary,
  text,
} = require('./rule-utils');

const SERVICE_STATUS = Object.freeze({
  KNOWN: 'KNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
});

const WINDOW_STATUS = Object.freeze({
  WITHIN: 'WITHIN_SERVICE_WINDOW',
  OUTSIDE: 'OUTSIDE_SERVICE_WINDOW',
  UNKNOWN: 'UNKNOWN',
});

const DAY_ALIASES = Object.freeze({
  MON: 'MONDAY', MONDAY: 'MONDAY',
  TUE: 'TUESDAY', TUES: 'TUESDAY', TUESDAY: 'TUESDAY',
  WED: 'WEDNESDAY', WEDNESDAY: 'WEDNESDAY',
  THU: 'THURSDAY', THUR: 'THURSDAY', THURS: 'THURSDAY', THURSDAY: 'THURSDAY',
  FRI: 'FRIDAY', FRIDAY: 'FRIDAY',
  SAT: 'SATURDAY', SATURDAY: 'SATURDAY',
  SUN: 'SUNDAY', SUNDAY: 'SUNDAY',
});

const DISPATCH_MODE = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  HEADWAY: 'FREQUENCY_BASED',
  LEAVE_WHEN_FULL: 'LEAVE_WHEN_FULL',
  CONTINUOUS_UNSCHEDULED: 'CONTINUOUS_UNSCHEDULED',
});

function variantStatus(leg) {
  const operatingStatus = text(leg?.operatingStatus);
  return {
    variantOperatingStatus: operatingStatus,
    limitedService: operatingStatus ? operatingStatus === 'LIMITED' : null,
  };
}

function emptyService(
  status = SERVICE_STATUS.UNKNOWN,
  warnings = ['NO_ELIGIBLE_SERVICE_PATTERN'],
  leg = null
) {
  return Object.freeze({
    status,
    operatingMode: null,
    serviceStart: null,
    serviceEnd: null,
    headwayMinutes: null,
    scheduledDepartures: Object.freeze([]),
    leaveWhenFull: null,
    ...variantStatus(leg),
    daysOfWeek: Object.freeze([]),
    windowStatus: WINDOW_STATUS.UNKNOWN,
    sourceSummary: null,
    verificationStatus: null,
    appliedPatternId: null,
    warnings: Object.freeze(warnings),
  });
}

const notApplicableService = () => emptyService(SERVICE_STATUS.NOT_APPLICABLE, []);

function localDeparture(value) {
  if (!value) return null;
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') {
    const trimmed = value.trim();
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    const localValue = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00`
      : trimmed;
    date = new Date(hasZone ? localValue : `${localValue}+08:00`);
  } else date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return Object.freeze({
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: parts.weekday.toUpperCase(),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  });
}

function previousDay(day) {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const index = days.indexOf(day);
  return index < 0 ? null : days[(index + 6) % 7];
}

function normalizedDays(value) {
  if (!Array.isArray(value) || value.length === 0) return { days: [], known: false };
  const days = [];
  for (const item of value) {
    const normalized = DAY_ALIASES[String(item).trim().toUpperCase()];
    if (!normalized) return { days: [], known: false };
    if (!days.includes(normalized)) days.push(normalized);
  }
  return { days, known: true };
}

function timeMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function normalizedTime(value) {
  const minutes = timeMinutes(value);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function evaluateWindow(pattern, departure) {
  const local = localDeparture(departure);
  const days = normalizedDays(pattern.days_of_week);
  const start = timeMinutes(pattern.first_trip_time);
  const end = timeMinutes(pattern.last_trip_time);
  if (!local || !days.known || start === null || end === null) return WINDOW_STATUS.UNKNOWN;
  if (start <= end) {
    return days.days.includes(local.day) && local.minutes >= start && local.minutes <= end
      ? WINDOW_STATUS.WITHIN
      : WINDOW_STATUS.OUTSIDE;
  }
  const serviceDay = local.minutes >= start ? local.day : previousDay(local.day);
  const insideTime = local.minutes >= start || local.minutes <= end;
  return insideTime && days.days.includes(serviceDay)
    ? WINDOW_STATUS.WITHIN
    : WINDOW_STATUS.OUTSIDE;
}

function variantMatches(pattern, leg) {
  const variant = unwrapRecord(pattern.route_variant);
  if (!variant) return false;
  return [identity(variant), text(variant.variant_code)]
    .filter(Boolean)
    .some((candidate) => candidate === leg.routeVariantId || candidate === leg.variantCode);
}

function normalizePattern(pattern, departure, leg) {
  const dispatchType = text(pattern.dispatch_type);
  const operatingMode = DISPATCH_MODE[dispatchType] || null;
  const days = normalizedDays(pattern.days_of_week);
  const serviceStart = normalizedTime(pattern.first_trip_time);
  const serviceEnd = normalizedTime(pattern.last_trip_time);
  const warnings = [];
  if (!days.known) warnings.push('SERVICE_DAYS_UNKNOWN');
  if (!serviceStart || !serviceEnd) warnings.push('SERVICE_WINDOW_INCOMPLETE');

  let headwayMinutes = null;
  if (dispatchType === 'HEADWAY') {
    const minimum = finiteNumber(pattern.headway_min_minutes);
    const maximum = finiteNumber(pattern.headway_max_minutes);
    if (minimum !== null && maximum !== null && minimum >= 1 && maximum >= minimum) {
      headwayMinutes = Object.freeze({ minimum, maximum });
    } else warnings.push('HEADWAY_RANGE_INCOMPLETE');
  }
  if (dispatchType === 'SCHEDULED') warnings.push('SCHEDULED_DEPARTURES_NOT_MODELED');
  if (!operatingMode) warnings.push('DISPATCH_TYPE_UNKNOWN');

  const completeWindow = days.known && serviceStart && serviceEnd;
  const completeMode = operatingMode
    && dispatchType !== 'SCHEDULED'
    && (dispatchType !== 'HEADWAY' || headwayMinutes !== null);
  const hasKnownFact = Boolean(operatingMode || completeWindow || headwayMinutes);
  const status = completeMode && completeWindow
    ? SERVICE_STATUS.KNOWN
    : (hasKnownFact ? SERVICE_STATUS.PARTIAL : SERVICE_STATUS.UNKNOWN);
  return Object.freeze({
    status,
    operatingMode,
    serviceStart,
    serviceEnd,
    headwayMinutes,
    scheduledDepartures: Object.freeze([]),
    leaveWhenFull: operatingMode ? dispatchType === 'LEAVE_WHEN_FULL' : null,
    ...variantStatus(leg),
    daysOfWeek: Object.freeze(days.days),
    windowStatus: evaluateWindow(pattern, departure),
    sourceSummary: sourceSummary(pattern),
    verificationStatus: pattern.verification_status || null,
    appliedPatternId: identity(pattern),
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

function evaluateServiceForLeg(leg, {
  servicePatterns = [],
  requestedDeparture,
  allowSimulated = false,
} = {}) {
  if (leg?.type !== LEG_TYPE.TRANSIT) return notApplicableService();
  const local = localDeparture(requestedDeparture);
  if (!local) return emptyService(SERVICE_STATUS.UNKNOWN, ['REQUESTED_DEPARTURE_REQUIRED'], leg);
  const candidates = [];
  for (const rawPattern of Array.isArray(servicePatterns) ? servicePatterns : []) {
    const pattern = unwrapRecord(rawPattern);
    const variant = unwrapRecord(pattern?.route_variant);
    if (!pattern || !variantMatches(pattern, leg)) continue;
    const eligibility = ruleEligibilityFor(pattern, {
      requestedDate: local.date,
      allowSimulated,
      effectiveRecord: variant,
    });
    if (!eligibility.eligible) continue;
    candidates.push(normalizePattern(pattern, requestedDeparture, leg));
  }
  if (!candidates.length) return emptyService(SERVICE_STATUS.UNKNOWN, ['NO_ELIGIBLE_SERVICE_PATTERN'], leg);
  const windowRank = {
    [WINDOW_STATUS.WITHIN]: 3,
    [WINDOW_STATUS.UNKNOWN]: 2,
    [WINDOW_STATUS.OUTSIDE]: 1,
  };
  candidates.sort((first, second) =>
    windowRank[second.windowStatus] - windowRank[first.windowStatus]
    || String(first.appliedPatternId || '').localeCompare(String(second.appliedPatternId || ''))
  );
  return candidates[0];
}

module.exports = {
  DISPATCH_MODE,
  SERVICE_STATUS,
  WINDOW_STATUS,
  evaluateServiceForLeg,
  evaluateWindow,
  localDeparture,
  normalizedDays,
  notApplicableService,
};
