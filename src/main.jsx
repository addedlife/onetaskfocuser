import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './00-auth.jsx';
import { registerOfflineShell } from './offline-support.js';

registerOfflineShell();

ReactDOM.createRoot(document.getElementById('root')).render(<AuthGate />);
