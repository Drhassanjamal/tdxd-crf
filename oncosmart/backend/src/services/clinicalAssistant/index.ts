import { RuleBasedAssistant } from './ruleBased.provider';
import { ClinicalAssistantProvider } from './types';

let provider: ClinicalAssistantProvider | null = null;

/** INTEGRATION POINT: return a governed AI provider here in the future. */
export function getClinicalAssistant(): ClinicalAssistantProvider {
  if (!provider) provider = new RuleBasedAssistant();
  return provider;
}

export * from './types';
