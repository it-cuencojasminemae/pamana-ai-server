'use strict';

const { planningEligibilityFor } = require('../transport-data/planning-eligibility');
const MODES = Object.freeze(['OPERATIONAL', 'RESEARCH_PREVIEW']);
const RESEARCH_ID = 'SAN-JUAN-CSF-LOCAL-RESEARCH-2026-10-08';

function researchPreviewEnabled(environment = process.env) {
  return environment.PAMANA_DEMO_MODE_ENABLED === 'true' && environment.PAMANA_RESEARCH_PREVIEW_ENABLED === 'true';
}

function planningContext(mode = 'OPERATIONAL', environment = process.env) {
  if (!MODES.includes(mode)) throw new Error('INVALID_PLANNING_MODE');
  if (mode === 'RESEARCH_PREVIEW' && !researchPreviewEnabled(environment)) throw new Error('RESEARCH_PREVIEW_DISABLED');
  return Object.freeze({ mode, researchPreview: mode === 'RESEARCH_PREVIEW', researchId: RESEARCH_ID,
    allowSimulatedObservations: mode === 'RESEARCH_PREVIEW' && environment.PAMANA_RESEARCH_SIMULATED_OBSERVATIONS_ENABLED === 'true' });
}

// The existing operational trust rule remains authoritative. A local research
// record is admitted only through the explicit, server-authorized pilot context.
function eligibilityForContext(record, { context, ...options } = {}) {
  const ordinary = planningEligibilityFor(record, options);
  if (ordinary.eligible || !context?.researchPreview) return ordinary;
  const research = record?.researchEvidenceId === RESEARCH_ID
    && record.data_mode === 'REAL' && record.verification_status === 'RESEARCH_CANDIDATE'
    && record.evidenceClass === 'USER_REPORTED' && record.source_reference?.trim()
    && record.source_name?.trim() && record.previewReviewed === true;
  if (!research) return ordinary;
  if (options.requireActive && record.route_status !== 'active') return { eligible: false, reasons: ['NOT_ACTIVE'] };
  return { eligible: true, reasons: [], provenance: 'LOCAL_RESEARCH' };
}

function accessPolicy(environment = process.env) {
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const maximum = positive(environment.MAX_WALK_TO_TRANSIT_METERS, 1500);
  const preferred = positive(environment.PREFERRED_WALK_TO_TRANSIT_METERS, 500);
  if (preferred > maximum) throw new Error('PREFERRED_WALK_EXCEEDS_MAXIMUM');
  return Object.freeze({ preferredWalkMeters: preferred, maximumWalkMeters: maximum, candidateRadiusMeters: 1500 });
}

module.exports = { MODES, RESEARCH_ID, researchPreviewEnabled, planningContext, eligibilityForContext, accessPolicy };
