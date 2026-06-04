import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Firestore's default WebChannel streaming transport gets silently killed on Android
// and behind restrictive proxies/VPNs, leaving real-time listeners hanging forever so
// lists render blank with no error. The main OneTask app already forces plain HTTP
// long-polling for exactly this reason (apps/web/src/01-core.js); mirror it here so
// Shaila loads reliably on mobile too. Slightly higher latency is an acceptable trade.
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });
export const auth = getAuth(app);
