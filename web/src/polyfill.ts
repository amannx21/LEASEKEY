import { Buffer } from "buffer";

// near-api-js expects the Node Buffer global in the browser.
(globalThis as any).Buffer ??= Buffer;
