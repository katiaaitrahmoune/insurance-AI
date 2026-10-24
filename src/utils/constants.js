
export const CLAIM_STATUSES = ['PENDING', 'APPROVED', 'MORE_INFO_REQUIRED'];


export const STAGES = ['intake', 'evidence_collection', 'ai_analysis', 'human_review', 'decided'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const INCIDENT_TYPES = [
  'front_end_collision',
  'rear_end_collision',
  'side_impact',
  'glass_damage',
  'theft',
  'other',
];


export const ANALYSIS_STATES = [
  'not_started',
  'running',
  'awaiting_review',
  'reviewing',
  'reviewed',
  'failed',
];

export const COVERAGE_VERDICTS = ['covered', 'not_covered', 'partial', 'unclear'];
export const RECOMMENDATIONS = ['approve', 'request_more_information'];
export const INCONSISTENCY_TYPES = [
  'date_mismatch',
  'location_mismatch',
  'damage_mismatch',
  'missing_document',
  'other',
];
export const SEVERITIES = ['low', 'medium', 'high'];
export const MEMORY_TYPES = ['outcome', 'inconsistency', 'coverage'];
export const AGENTS = ['vision', 'policy', 'decision'];
export const FILE_KINDS = ['image', 'report', 'policy', 'other'];

export const REVIEW_ACTION_TO_STATUS = {
  approve: 'APPROVED',
  request_info: 'MORE_INFO_REQUIRED',
};

export const DEFAULT_POLICY_ID = 'AT-MOT-2026-X99';
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
