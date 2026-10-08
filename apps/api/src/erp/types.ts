export type ErpProviderCode='bling'|'omie'|'conta_azul'|'olist_tiny'|'vhsys'|'linx'|'totvs';
export type ErpProviderStatus='available'|'in_development'|'planned'|'partner_required'|'product_specific';
export type ErpAuthType='oauth2'|'app_key_secret'|'api_token'|'contracted_api'|'product_specific';
export type ErpCapability='customers'|'sales'|'cancellations'|'products'|'inventory'|'webhooks'|'scheduled_sync'|'automatic_token_refresh';

export type ErpProviderDefinition={
  code:ErpProviderCode;
  name:string;
  status:ErpProviderStatus;
  priority:1|2|3;
  authType:ErpAuthType;
  capabilities:ErpCapability[];
  description:string;
  requirements:string[];
  documentationUrl:string;
  productScope?:string;
};

export type CanonicalErpCustomer={
  externalId:string;
  name:string;
  document?:string;
  email?:string;
  phone?:string;
  updatedAt?:string;
};

export type CanonicalErpSale={
  externalId:string;
  orderNumber?:string;
  customerExternalId?:string;
  totalCents:number;
  status:string;
  occurredAt:string;
  updatedAt?:string;
};

export type ErpSyncResult={
  customers:{read:number;created:number;updated:number;skipped:number};
  sales:{read:number;created:number;updated:number;reversed:number;skipped:number};
  nextCursor?:string;
};

export interface ErpAdapter{
  readonly provider:ErpProviderCode;
  testConnection(tenantId:string):Promise<{ok:boolean;externalAccountId?:string;message:string}>;
  syncCustomers(tenantId:string,cursor?:string):Promise<{items:CanonicalErpCustomer[];nextCursor?:string}>;
  syncSales(tenantId:string,cursor?:string):Promise<{items:CanonicalErpSale[];nextCursor?:string}>;
}
