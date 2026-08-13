declare global { namespace Express { interface Request { auth?: { userId: string; tenantId: string; role: string; name: string } } } }
export {};
