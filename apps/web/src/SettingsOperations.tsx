import { OperationsPanel as HealthPanel } from './OperationsPanel';
import { BlingIntegration } from './BlingIntegration';
import { BlingReconciliation } from './BlingReconciliation';
import { SecurityPanel } from './SecurityPanel';

export function OperationsPanel(){return <><HealthPanel/><SecurityPanel/><BlingIntegration/><BlingReconciliation/></>;}
