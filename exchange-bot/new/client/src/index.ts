import './styles.css';
import './web-awesome.js';
import './exchange-bot-app.js';
import { createAuth } from './auth.js';

void createAuth()
    .init()
    .catch(error => console.error('Authentication initialization failed', error));
