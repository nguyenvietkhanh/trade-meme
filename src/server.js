// Explicit live mode uses the owner vault; every restart starts locked.
import {installRuntimeLifecycle} from './runtime-lifecycle.js';
installRuntimeLifecycle();
await import('./paper-server.js');
