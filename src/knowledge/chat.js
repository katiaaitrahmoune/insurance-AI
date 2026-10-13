// Static answers for the agent chat. Nothing here ever states a verdict about a claim.
export const HELP_TEXT =
  'I can analyze a claim and explain what the evidence shows. Try "Analyze CLM-1042", or ask about ' +
  'the damage, coverage, inconsistencies or recommendation of a claim you have analyzed.';

export const HUMAN_DECISION_TEXT =
  'InsuraLens never decides a claim. The AI reads the evidence and proposes a recommendation; ' +
  'only a claims officer can approve or request more information, and that action is the only thing ' +
  'that changes a claim\'s status.';

export const ACCUSATION_TEXT =
  'InsuraLens does not judge intent. It flags factual inconsistencies between submitted evidence ' +
  '(for example, two different accident dates) and shows both sources side by side so the officer can decide what they mean.';

export const GLOSSARY = {
  inconsistency: 'An inconsistency is a factual difference between two pieces of submitted evidence, such as the accident date in the customer statement versus the official report.',
  recommendation: 'The recommendation is the AI\'s proposed next step (approve or request more information). It is a suggestion for the officer, not a decision.',
  coverage: 'Coverage status comes from retrieving the relevant clauses of the actual policy, and always carries the section and quoted clause it is based on.',
};
