// api/index.js
import app from '../src/app.js';
import { createServer } from '@vercel/node';

export default createServer(app);
