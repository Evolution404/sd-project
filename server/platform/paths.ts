import { resolve } from "node:path";

// Executed from dist/server/platform in development and the offline package.
export const projectRoot = resolve(import.meta.dirname, "../../..");
export const webDirectory = resolve(projectRoot, "dist/web");
