import { OperationsPanel as HealthPanel } from './OperationsPanel';
import { BlingIntegration } from './BlingIntegration';
import { BlingReconciliation } from './BlingReconciliation';
import { SecurityPanel } from './SecurityPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { CompanyProfilePanel } from './CompanyProfilePanel';
import { CnpjLookup } from './CnpjLookup';
import { PlanManagement } from './PlanManagement';
import { LinkedInIntegration } from './LinkedInIntegration';

export function OperationsPanel({features=[]}:{features?:string[]}){return <><PlanManagement/><CnpjLookup/><CompanyProfilePanel/><HealthPanel/><SecurityPanel/><BlingIntegration/><BlingReconciliation/><LinkedInIntegration/>{features.includes('public_api')&&<ApiKeysPanel/>}</>;}
