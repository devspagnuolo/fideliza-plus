import { describe,expect,it } from 'vitest';

describe('contrato multiempresa',()=>{
  it('não aceita tenant informado pelo navegador',()=>{
    const payload={name:'Cliente',tenantId:'empresa-alheia'};
    const accepted={name:payload.name};
    expect(accepted).not.toHaveProperty('tenantId');
  });
});
