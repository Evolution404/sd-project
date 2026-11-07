import {resolve} from 'node:path';

// Runtime data belongs to the project/deployment root, never a user profile.
// DATA_DIR is intended for explicit test/development isolation.
export const dataRoot=resolve(process.env.DATA_DIR||resolve(import.meta.dirname,'..','..','data'));
