#!/usr/bin/env node
// tsc does not remove stale output; a clean dist keeps the package predictable.
import fs from 'node:fs';
fs.rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
