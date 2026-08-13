import './database/migrate.js';
import { app } from './app.js';
import { config } from './config.js';
app.listen(config.port,()=>console.log(`Fideliza+ API em http://localhost:${config.port}`));
