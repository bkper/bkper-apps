import { Hono, Context } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { logger } from 'hono/logger'

import { handleEvent } from './events/event-handler.js';

// Create a Hono app
const app = new Hono();
app.use(prettyJSON()); // With options: prettyJSON({ space: 4 })
app.use(logger());

// Health check endpoint
app.get('/', (c: Context) => {
  return c.json({ message: 'Bkper Parser App is running...' });
});

// Events webhook endpoint
app.post('/events', handleEvent);

export default app;
