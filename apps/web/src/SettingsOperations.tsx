import { OperationsPanel as HealthPanel } from './OperationsPanel';
import { BlingIntegration } from './BlingIntegration';
import { BlingReconciliation } from './BlingReconciliation';
import { SecurityPanel } from './SecurityPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { CompanyProfilePanel } from './CompanyProfilePanel';
import { CnpjLookup } from './CnpjLookup';

export function OperationsPanel(){return <><CnpjLookup/><CompanyProfilePanel/><HealthPanel/><SecurityPanel/><BlingIntegration/><BlingReconciliation/><ApiKeysPanel/></>;}
