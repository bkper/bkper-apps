import 'source-map-support/register.js'
import { HttpFunction } from '@google-cloud/functions-framework/build/src/functions';
import { Bkper } from 'bkper-js';
import { Request, Response } from 'express';
import express from 'express';
import httpContext from 'express-http-context';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { AppContext } from './AppContext.js';
import { EventHandlerTransactionPosted } from './EventHandlerTransactionPosted.js';
import { EventHandlerTransactionChecked } from './EventHandlerTransactionChecked.js';
import { EventHandlerTransactionUnchecked } from './EventHandlerTransactionUnchecked.js';
import { EventHandlerTransactionUpdated } from './EventHandlerTransactionUpdated.js';
import { EventHandlerTransactionDeleted } from './EventHandlerTransactionDeleted.js';
import { EventHandlerTransactionRestored } from './EventHandlerTransactionRestored.js';
import { EventHandlerAccountCreatedOrUpdated } from './EventHandlerAccountCreatedOrUpdated.js';
import { EventHandlerAccountDeleted } from './EventHandlerAccountDeleted.js';
import { EventHandlerGroupCreatedOrUpdated } from './EventHandlerGroupCreatedOrUpdated.js';
import { EventHandlerGroupDeleted } from './EventHandlerGroupDeleted.js';
import { EventHandlerBookUpdated } from './EventHandlerBookUpdated.js';

// Ensure env at right location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });


const app = express();
app.use(httpContext.middleware);
app.use('/', handleEvent);
export const doPost: HttpFunction = app;

export type Result = {
  result?: string[] | string | boolean,
  error?: string,
  warning?: string
}

function init(req: Request, res: Response): AppContext {

  res.setHeader('Content-Type', 'application/json');

  const apiKey = process.env.BKPER_API_KEY;

  const bkper = new Bkper({
    oauthTokenProvider: async () => req.headers['bkper-oauth-token'] as string,
    apiKeyProvider: apiKey ? async () => apiKey : undefined,
    agentIdProvider: async () => req.headers['bkper-agent-id'] as string
  })

  return new AppContext(httpContext, bkper);

}

async function handleEvent(req: Request, res: Response) {

  const context = init(req, res);

  try {

    let event: bkper.Event = req.body
    let result: Result = { result: false };


    switch (event.type) {

      case 'TRANSACTION_POSTED':
        result = await new EventHandlerTransactionPosted(context).handleEvent(event);
        break;
      case 'TRANSACTION_CHECKED':
        result = await new EventHandlerTransactionChecked(context).handleEvent(event);
        break;
      case 'TRANSACTION_UNCHECKED':
        result = await new EventHandlerTransactionUnchecked(context).handleEvent(event);
        break;
      case 'TRANSACTION_UPDATED':
        result = await new EventHandlerTransactionUpdated(context).handleEvent(event);
        break;
      case 'TRANSACTION_DELETED':
        result = await new EventHandlerTransactionDeleted(context).handleEvent(event);
        break;
      case 'TRANSACTION_RESTORED':
        result = await new EventHandlerTransactionRestored(context).handleEvent(event);
        break;
      case 'ACCOUNT_CREATED':
        result = await new EventHandlerAccountCreatedOrUpdated(context).handleEvent(event);
        break;
      case 'ACCOUNT_UPDATED':
        result = await new EventHandlerAccountCreatedOrUpdated(context).handleEvent(event);
        break;
      case 'ACCOUNT_DELETED':
        result = await new EventHandlerAccountDeleted(context).handleEvent(event);
        break;
      case 'GROUP_CREATED':
        result = await new EventHandlerGroupCreatedOrUpdated(context).handleEvent(event);
        break;
      case 'GROUP_UPDATED':
        result = await new EventHandlerGroupCreatedOrUpdated(context).handleEvent(event);
        break;
      case 'GROUP_DELETED':
        result = await new EventHandlerGroupDeleted(context).handleEvent(event);
        break;
      case 'BOOK_UPDATED':
        result = await new EventHandlerBookUpdated(context).handleEvent(event);
        break;

    }

    res.send(response(result))

  } catch (err: any) {
    console.error(err);
    res.send(response({ error: err.stack ? err.stack.split("\n") : err }))
  }

}

function response(result: Result): string {
  const body = JSON.stringify(result, null, 4);
  return body;
}


