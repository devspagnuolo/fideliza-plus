import { describe,expect,it } from 'vitest';
import { ERP_PROVIDER_CATALOG,erpProvider,isErpProviderCode,publicErpCatalog } from './catalog.js';

describe('catálogo multi-ERP',()=>{
  it('mantém apenas o Bling como disponível até a homologação dos demais',()=>{
    expect(ERP_PROVIDER_CATALOG.filter(item=>item.status==='available').map(item=>item.code)).toEqual(['bling']);
    expect(erpProvider('omie')?.status).toBe('in_development');
    expect(erpProvider('linx')?.status).toBe('partner_required');
    expect(erpProvider('totvs')?.status).toBe('product_specific');
  });
  it('expõe metadados operacionais sem segredos',()=>{
    const result=publicErpCatalog();
    expect(result.length).toBeGreaterThanOrEqual(7);
    for(const item of result)expect(Object.keys(item)).not.toEqual(expect.arrayContaining(['credentials','accessToken','refreshToken','clientId','clientSecret']));
    expect(isErpProviderCode('bling')).toBe(true);
    expect(isErpProviderCode('erp-inventado')).toBe(false);
  });
});
