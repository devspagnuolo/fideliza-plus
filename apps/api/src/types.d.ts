declare global { namespace Express { interface Request { auth?: { userId: string; tenantId: string; role: string; name: string; planCode?:string; planName?:string; features?:string[]; limits?:{users:number;consumers:number;storageMb:number}; subscriptionStatus?:string; trialEndsAt?:string|null } } } }
export {};
