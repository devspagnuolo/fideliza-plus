import type { NextFunction, Request, Response } from 'express';
import { db } from './database/db.js';

/**
 * Papéis da equipe interna da plataforma (tabela platform_admins). O super_admin tem acesso total e não pode
 * ser restringido, para que ninguém se tranque fora do painel. Os demais papéis partem dos padrões abaixo e podem
 * ser ajustados em platform_permissions pela tela "Permissões"; a gestão da equipe nunca é delegável.
 */
export const PLATFORM_ROLES={
  super_admin:'Super Admin',
  finance:'Financeiro',
  support:'Suporte',
  operations:'Operações',
  viewer:'Somente leitura',
}as const;
export type PlatformRole=keyof typeof PLATFORM_ROLES;
export const platformRoleKeys=Object.keys(PLATFORM_ROLES)as[PlatformRole,...PlatformRole[]];

export const PLATFORM_PERMISSIONS={
  'platform.read':'Visualizar dashboards, empresas, finanças, planos, suporte e monitoramento',
  'companies.manage':'Cadastrar e editar empresas, usuários das empresas, acesso e portal do consumidor',
  'companies.reset':'Reiniciar a base de uma empresa em homologação (apaga dados operacionais)',
  'billing.manage':'Gerenciar assinaturas, faturas, ciclo de cobrança, cupons e Asaas',
  'plans.manage':'Gerenciar planos, add-ons, trial, regras comerciais e pedidos de troca de plano',
  'support.manage':'Atender e responder chamados de suporte',
  'loyalty.manage':'Ajustar pontos, reprocessar vendas e reconciliar saldos de fidelidade',
  'analytics.manage':'Criar e editar relatórios personalizados',
  'data.export':'Exportar dados da plataforma em CSV',
  'operations.manage':'Gerenciar jobs, filas, agendamentos, integrações, monitoramento e incidentes',
  'security.read':'Visualizar sessões, chaves de API, auditoria e eventos de segurança',
  'security.manage':'Tratar eventos de segurança, encerrar sessões, chaves de API e configurações globais',
  'admins.manage':'Gerenciar a equipe da plataforma e as permissões por papel',
}as const;
export type PlatformPermission=keyof typeof PLATFORM_PERMISSIONS;

/** Permissões reservadas ao super_admin: não aparecem na matriz editável e não podem ser concedidas. */
const RESERVED:PlatformPermission[]=['admins.manage'];

export const DEFAULT_ROLE_PERMISSIONS:Record<Exclude<PlatformRole,'super_admin'>,PlatformPermission[]>={
  finance:['platform.read','billing.manage','plans.manage','analytics.manage','data.export'],
  support:['platform.read','companies.manage','support.manage','loyalty.manage'],
  operations:['platform.read','operations.manage','security.read'],
  viewer:['platform.read'],
};

export function isPlatformRole(role:unknown):role is PlatformRole{return typeof role==='string'&&role in PLATFORM_ROLES}
export function isDelegablePermission(role:string,permission:string){return role!=='super_admin'&&isPlatformRole(role)&&permission in PLATFORM_PERMISSIONS&&!RESERVED.includes(permission as PlatformPermission)}

/** Garante uma linha por papel delegável e permissão, sem sobrescrever ajustes já feitos. */
export function seedPlatformPermissions(){
  const insert=db.prepare('INSERT OR IGNORE INTO platform_permissions(role,permission,enabled,description) VALUES(?,?,?,?)');
  db.transaction(()=>{
    // Linhas antigas do super_admin eram apenas descritivas; o acesso dele é sempre total.
    db.prepare("DELETE FROM platform_permissions WHERE role='super_admin'").run();
    for(const [role,granted] of Object.entries(DEFAULT_ROLE_PERMISSIONS))
      for(const [permission,description] of Object.entries(PLATFORM_PERMISSIONS))
        if(isDelegablePermission(role,permission))insert.run(role,permission,granted.includes(permission as PlatformPermission)?1:0,description);
  })();
}

export function platformPermissionsFor(role:string):PlatformPermission[]{
  if(role==='super_admin')return Object.keys(PLATFORM_PERMISSIONS)as PlatformPermission[];
  if(!isPlatformRole(role))return [];
  const rows=db.prepare('SELECT permission FROM platform_permissions WHERE role=? AND enabled=1').all(role)as{permission:string}[];
  return rows.map(r=>r.permission).filter(p=>isDelegablePermission(role,p))as PlatformPermission[];
}

export function platformCan(role:string,permission:PlatformPermission){return platformPermissionsFor(role).includes(permission)}

type PermissionResolver=PlatformPermission|((req:Request)=>PlatformPermission);
export type PlatformPermissionMiddleware=((req:Request,res:Response,next:NextFunction)=>void)&{platformPermission:PermissionResolver};

/** Usar depois do middleware de sessão da plataforma, que preenche req.platformAuth. */
export function requirePlatformPermission(permission:PermissionResolver):PlatformPermissionMiddleware{
  const middleware=((req:Request,res:Response,next:NextFunction)=>{
    const role=String((req as any).platformAuth?.role||''),needed=typeof permission==='function'?permission(req):permission;
    if(!platformCan(role,needed))return void res.status(403).json({error:'Seu perfil não tem permissão para esta ação.',code:'PLATFORM_PERMISSION_DENIED',permission:needed});
    next();
  })as PlatformPermissionMiddleware;
  middleware.platformPermission=permission;
  return middleware;
}

/** Os registros genéricos de /platform/modules/:module seguem a permissão da área do menu. */
const MODULE_PERMISSIONS:Record<string,PlatformPermission>={
  companies:'companies.manage',users:'companies.manage',finance:'billing.manage',plans:'plans.manage',analytics:'analytics.manage',
  integrations:'operations.manage',operations:'operations.manage',monitoring:'operations.manage',security:'security.manage',settings:'security.manage',support:'support.manage',
};
export function modulePermission(req:Request):PlatformPermission{return MODULE_PERMISSIONS[String(req.params.module)]??'admins.manage'}
