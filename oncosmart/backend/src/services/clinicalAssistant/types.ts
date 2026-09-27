/**
 * OncoSmart Clinical Assistant — ARCHITECTURE PLACEHOLDER.
 *
 * No autonomous clinical decision-making is implemented. A future provider
 * (e.g. an LLM service deployed under hospital governance) can implement
 * `ClinicalAssistantProvider`. Every output MUST carry the verification label.
 */
export const AI_LABEL = 'AI-generated clinical support — physician verification required.';

export interface AssistantSection {
  id:
    | 'TREATMENT_HISTORY'
    | 'MISSING_INFORMATION'
    | 'ABNORMAL_LABS'
    | 'CYCLE_COMPARISON'
    | 'DOCUMENTATION'
    | 'TOXICITY_HISTORY'
    | 'MDT_SUMMARY';
  title: string;
  items: string[];
}

export interface AssistantOutput {
  label: string;
  engine: string;
  generatedAt: string;
  disclaimer: string;
  sections: AssistantSection[];
}

export interface ClinicalAssistantProvider {
  readonly name: string;
  summarizePatient(patientId: string): Promise<AssistantOutput>;
}
