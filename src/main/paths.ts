import { app } from 'electron';
import * as path from 'path';

/**
 * Folder of the PowerShell scripts. In an installed copy they are unpacked beside the app's archive
 * (app.asar.unpacked), because PowerShell cannot read files inside the archive.
 */
export function scriptsDir(): string {
  return path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'definitions', 'scripts');
}
