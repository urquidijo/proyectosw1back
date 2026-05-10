export type SemanticRuleCandidateType =
  | 'COPY_FROM_REFERENCE'
  | 'REFERENCE_DATE_RELATION'
  | 'REFERENCE_BOUND';

export type SemanticRuleCandidate = {
  type: SemanticRuleCandidateType;

  targetTable: string;
  targetColumn: string;

  sourceTable: string;
  sourceColumn: string;
  viaForeignKey: string;

  dateRelation:
    | 'AFTER'
    | 'BEFORE'
    | 'ON_OR_AFTER'
    | 'ON_OR_BEFORE'
    | null;

  boundOperator: 'LTE' | 'GTE' | null;

  heuristicScore: number;
  reason: string;
};