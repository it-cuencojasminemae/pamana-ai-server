'use strict';

// Formatting/validation only. Routing, prices, ranks and transfer counts remain
// owned by the deterministic planner, not the explanation provider.
const FORBIDDEN = /RCH-|PILOT-|\b[a-f\d]{24,64}\b|\b[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\b|\b(?:FIELD_VERIFIED|MANUAL_VERIFIED|DEMO_ESTIMATE|SYSTEM_CALCULATED|UNKNOWN_SERVICE_PATTERN|FARE_DISTANCE_UNAVAILABLE|PUJ_TRADITIONAL|PUJ_MODERN|STORED_ROUTE_STOP_DISTANCE|STORED_ROAD_GEOMETRY|SIMULATED_DEMO)\b|geometry_source|verification_status|data_mode|planning_enabled|sourceType|roadDistanceSource|transferCount|totalFare|payableFare|\b(?:headway|variant|provenance|cumulative distance|fare policy|planning eligibility|database|API key)\b/i;
const INTERNAL_FIELDS = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|sourceSummary|verificationStatus|dataQuality|geometrySource|availabilitySummary|durationSummary|originLabel|destinationLabel|nodeId|routeId|variantId|estimatedFare|estimatedWaitMinutes|walkingInstructions|\b(?:confidence|JSON)\b/;
const label = (value, fallback = '') => typeof value === 'string' && !FORBIDDEN.test(value) && !INTERNAL_FIELDS.test(value) ? value : fallback;
const mode = value => ({ PUJ_TRADITIONAL: 'Jeep', PUJ_MODERN: 'Jeep', TRICYCLE: 'Tricycle', BUS: 'Bus', UV_EXPRESS: 'UV Express' })[value]
  || (['Jeep', 'Tricycle', 'Bus', 'UV Express', 'Public transport'].includes(value) ? value : 'Public transport');

function passengerGuideFacts(sanitized) {
  const facts = {
    origin: label(sanitized.origin, 'Your pickup point'),
    destination: label(sanitized.destination, 'Your destination'),
    rides: sanitized.legs.filter(leg => leg.type === 'TRANSIT').map(leg => ({
      mode: mode(leg.transportMode), pickup: label(leg.boardAt, 'the pickup point'),
      dropoff: label(leg.alightAt, 'the drop-off point'),
      ...(label(leg.signboard) ? { signboard: label(leg.signboard) } : {}),
    })),
    transfers: sanitized.transferCount,
  };
  const fare = sanitized.fareSummary;
  if (fare.totalStatus === 'KNOWN' && Number.isFinite(fare.totalFare)) {
    try { facts.estimatedFare = new Intl.NumberFormat('en-PH', { style: 'currency', currency: fare.currency || 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(fare.totalFare); }
    catch { /* Unsupported currency is omitted, never invented. */ }
  }
  const walking = sanitized.legs.filter(leg => leg.type === 'WALK').flatMap(leg => leg.instructions.slice(0, 2).map(instruction => label(instruction.text)).filter(Boolean));
  if (walking.length) facts.walkingInstructions = walking;
  // Service interval/headway and walking duration are not waiting time or ETA.
  const wait = sanitized.legs.find(leg => leg.type === 'TRANSIT')?.availability?.wait;
  if (wait?.status === 'ESTIMATED_WINDOW' && Number.isFinite(wait.lowMinutes) && Number.isFinite(wait.highMinutes) && wait.lowMinutes >= 0 && wait.highMinutes >= wait.lowMinutes) {
    facts.estimatedWaitMinutes = { low: wait.lowMinutes, high: wait.highMinutes };
  }
  if (['AVAILABLE', 'UNAVAILABLE'].includes(sanitized.availabilitySummary.status)) {
    facts.service = sanitized.availabilitySummary.status === 'AVAILABLE' ? 'Service available' : 'Service unavailable at this time';
  }
  return facts;
}

function safePassengerGuide(text, facts) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1200 || text.trim().split(/\s+/).length > 120 || FORBIDDEN.test(text) || INTERNAL_FIELDS.test(text) || /[<>`]|https?:\/\//i.test(text)) return false;
  const sentences = text.trim().replace(/\b(Sta|St|Dr|Mr|Mrs|Ms|Jr|Sr)\./gi, '$1').split(/[.!?]+(?:\s+|$)/).filter(Boolean);
  if (sentences.length < 2 || sentences.length > 4) return false;
  // No complete journey time exists in the current contract.
  if (/\b(?:ETA|hours?|days?|duration|travel time|trip takes|journey takes|schedule|every)\b/i.test(text)) return false;
  if (!facts.estimatedWaitMinutes && /\b(?:minutes?|wait(?:ing)?\s+(?:time|for|\d)|arrives? (?:in|soon|shortly))\b/i.test(text)) return false;
  if (!facts.service && /\b(?:availability|service (?:is )?available|reliable service)\b/i.test(text)) return false;
  const amounts = [...text.matchAll(/(?:₱|PHP\s*|pesos?\s*)([\d,]+(?:\.\d+)?)/gi)].map(match => match[1].replaceAll(',', ''));
  amounts.push(...[...text.matchAll(/\b([\d,]+(?:\.\d+)?)\s*pesos?\b/gi)].map(match => match[1].replaceAll(',', '')));
  const expected = facts.estimatedFare?.match(/[\d,]+(?:\.\d+)?/)?.[0].replaceAll(',', '');
  if (expected ? !amounts.length || amounts.some(amount => amount !== expected) : amounts.length) return false;
  const count = facts.transfers;
  if (count === 0 && !/\b(?:(?:no|zero|0) transfers?|without (?:any )?transfers?)\b/i.test(text)) return false;
  if (count > 0 && !new RegExp(`\\b(?:${count}|${['zero', 'one', 'two'][count] || count}) transfers?\\b`, 'i').test(text)) return false;
  const numericTransfers = [...text.matchAll(/\b(\d+) transfers?\b/gi)];
  if (numericTransfers.some(match => Number(match[1]) !== count)) return false;
  if (count > 0 && /\b(?:no|zero) transfers?\b/i.test(text)) return false;
  const countWords = ['no', 'zero', 'one', 'two', 'three', 'four'];
  if ([...text.matchAll(/\b(no|zero|one|two|three|four) transfers?\b/gi)].some(match => Math.max(0, countWords.indexOf(match[1].toLowerCase()) - 1) !== count)) return false;
  const allowedNumbers = new Set(JSON.stringify(facts).match(/\d+(?:\.\d+)?/g) || []);
  if ((text.match(/\d+(?:\.\d+)?/g) || []).some(number => !allowedNumbers.has(number))) return false;
  // Ride types and supplied signboards must survive wording; no substitute service.
  if (facts.rides.some(ride => !text.toLowerCase().includes(ride.mode.toLowerCase()))) return false;
  if (facts.rides.some(ride => ride.signboard && !text.toLowerCase().includes(ride.signboard.toLowerCase()))) return false;
  let position = 0;
  for (const ride of facts.rides) { const next = text.toLowerCase().indexOf(ride.mode.toLowerCase(), position); if (next < 0) return false; position = next + ride.mode.length; }
  return true;
}

module.exports = { passengerGuideFacts, safePassengerGuide, FORBIDDEN };
