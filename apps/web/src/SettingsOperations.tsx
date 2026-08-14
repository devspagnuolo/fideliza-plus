import { OperationsPanel as HealthPanel } from './OperationsPanel';
import { BlingIntegration } from './BlingIntegration';
import { BlingReconciliation } from './BlingReconciliation';
import { SecurityPanel } from './SecurityPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { CompanyProfilePanel } from './CompanyProfilePanel';

export function OperationsPanel(){return <><CompanyProfilePanel/><HealthPanel/><SecurityPanel/><BlingIntegration/><BlingReconciliation/><ApiKeysPanel/></>;}
