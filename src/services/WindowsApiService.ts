import { runAppleScript } from 'run-applescript';
import activeWin from 'active-win';
import { z } from 'zod';
import clipboard from 'clipboardy';

const MAX_RETRIES = 3;
const RETRY_DELAY = 500; // ms
const OPERATION_TIMEOUT = 10000; // ms

class MacOSOperationError extends Error {
 constructor(
   message: string,
   public readonly code: 'TIMEOUT' | 'PERMISSION' | 'WINDOW_NOT_FOUND' | 'SCRIPT_ERROR'
 ) {
   super(message);
 }
}

export enum VirtualKeys {
 COMMAND = 55,
 CONTROL = 59, 
 ALT = 58,
 SHIFT = 56,
 ENTER = 36,
 ESCAPE = 53,
 TAB = 48,
 LEFT = 123,
 UP = 126,
 RIGHT = 124,
 DOWN = 125,
 SPACE = 49
}

export interface IMacOSWindow {
 processId: number;
 title: string;
 position: [number, number];
 size: [number, number];
}

export class WindowsApiService {
 private managedWindows = new Set<number>();
 private processes = new Map<number, {
   startTime: number;
   lastActive: number;
 }>();

 constructor() {
   this.requestAccessibilityPermissions();
 }

 private async withTimeout<T>(operation: () => Promise<T>, timeoutMs: number = OPERATION_TIMEOUT): Promise<T> {
   const timeout = new Promise<never>((_, reject) => {
     setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
   });
   return Promise.race([operation(), timeout]);
 }

 private async withRetry<T>(
   operation: () => Promise<T>,
   window: IMacOSWindow,
   options: { requireFocus?: boolean } = {}
 ): Promise<T> {
   const { requireFocus = false } = options;
   let lastError: Error | undefined;

   for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
     try {
       if (requireFocus) {
         await this.focusWindow(window);
       }
       return await operation();
     } catch (error) {
       lastError = error as Error;
       if (attempt < MAX_RETRIES) {
         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
       }
     }
   }
   throw lastError || new Error('Operation failed after retries');
 }

 private async withError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err: unknown) {
    const error = err as Error;
    if (error.message?.includes('execution denied')) {
      throw new MacOSOperationError('Accessibility permissions required', 'PERMISSION');
    }
    if (error.message?.includes('process not found')) {
      throw new MacOSOperationError('Window or process not found', 'WINDOW_NOT_FOUND'); 
    }
    if (error.message?.includes('timed out')) {
      throw new MacOSOperationError('Operation timed out', 'TIMEOUT');
    }
    throw new MacOSOperationError(error.message || 'Unknown error', 'SCRIPT_ERROR');
  }
}

 async checkAccessibilityPermissions(): Promise<boolean> {
   const script = `
     tell application "System Events"
       set UI_enabled to UI elements enabled
     end tell
   `;
   try {
     await runAppleScript(script);
     return true;
   } catch {
     return false;
   }
 }

 async requestAccessibilityPermissions(): Promise<void> {
   if (!await this.checkAccessibilityPermissions()) {
     throw new MacOSOperationError(
       'Cursor MCP requires Accessibility permissions. Please enable in System Preferences > Security & Privacy > Privacy > Accessibility',
       'PERMISSION'
     );
   }
 }

 registerManagedWindow(processId: number): void {
   this.managedWindows.add(processId);
   this.processes.set(processId, {
     startTime: Date.now(),
     lastActive: Date.now()
   });
 }

 async findWindowByProcessId(processId: number): Promise<IMacOSWindow | null> {
   const activeWindow = await activeWin();
   if (activeWindow?.id === processId) {
     return {
       processId,
       title: activeWindow.title,
       position: [activeWindow.bounds.x, activeWindow.bounds.y],
       size: [activeWindow.bounds.width, activeWindow.bounds.height]
     };
   }
   return null;
 }

 async focusWindow(window: IMacOSWindow): Promise<void> {
   const script = `
     tell application "System Events"
       tell process "${window.title}"
         set frontmost to true
       end tell
     end tell
   `;
   await this.withError(() => runAppleScript(script));
 }

 async sendKeyToWindow(window: IMacOSWindow, keyCode: number, modifiers?: {
   cmd?: boolean;
   alt?: boolean; 
   shift?: boolean;
   ctrl?: boolean;
 }): Promise<void> {
   await this.withRetry(async () => {
     const script = `
       tell application "System Events"
         tell process "${window.title}"
           ${modifiers?.cmd ? 'key down command\n' : ''}
           ${modifiers?.shift ? 'key down shift\n' : ''}
           ${modifiers?.alt ? 'key down option\n' : ''}
           ${modifiers?.ctrl ? 'key down control\n' : ''}
           key code ${keyCode}
           delay 0.1
           ${modifiers?.cmd ? 'key up command\n' : ''}
           ${modifiers?.shift ? 'key up shift\n' : ''}
           ${modifiers?.alt ? 'key up option\n' : ''}
           ${modifiers?.ctrl ? 'key up control\n' : ''}
         end tell
       end tell
     `;
     await runAppleScript(script);
   }, window);
 }

 async openCommandPalette(window: IMacOSWindow): Promise<void> {
   await this.withRetry(async () => {
     const script = `
       tell application "System Events"
         tell process "${window.title}"
           key code 35 using {command down, shift down}
         end tell
       end tell
     `;
     await runAppleScript(script);
   }, window);
 }

 async openClineTab(window: IMacOSWindow): Promise<void> {
   await this.withRetry(async () => {
     await this.openCommandPalette(window);
     await new Promise(resolve => setTimeout(resolve, 500));

     const text = "Cline: Open in New Tab";
     const script = `
       tell application "System Events"
         tell process "${window.title}"
           ${text.split('').map(char => `
             keystroke "${char}"
             delay 0.05
           `).join('\n')}
           keystroke return
         end tell
       end tell
     `;
     await runAppleScript(script);
   }, window);
 }

 async isProcessResponding(pid: number): Promise<boolean> {
   const script = `
     tell application "System Events"
       return exists process id ${pid}
     end tell
   `;
   return await this.withError(async () => {
     const result = await runAppleScript(script);
     return result === 'true';
   });
 }

 async terminateProcess(pid: number): Promise<void> {
   const script = `
     tell application "System Events"
       set theProcess to first process whose unix id is ${pid}
       quit theProcess
     end tell
   `;
   await this.withError(() => runAppleScript(script));
   this.managedWindows.delete(pid);
   this.processes.delete(pid);
 }

 async getTitle(window: IMacOSWindow): Promise<string> {
   return window.title;
 }

 async simulateKeyboardEvent(window: IMacOSWindow, options: {
   keyCode: number,
   modifiers?: { shift?: boolean, ctrl?: boolean, alt?: boolean }
 }) {
   await this.sendKeyToWindow(window, options.keyCode, {
     shift: options.modifiers?.shift,
     ctrl: options.modifiers?.ctrl,
     alt: options.modifiers?.alt
   });
 }
}

export default new WindowsApiService();