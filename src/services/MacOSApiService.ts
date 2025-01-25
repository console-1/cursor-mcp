import { runAppleScript } from 'run-applescript';
import activeWin from 'active-win';

export interface IMacOSWindow {
    processId: number;
    title: string;
    position: [number, number];
    size: [number, number];
}

export const VirtualKeys = {
    A: 0, B: 11, C: 8, D: 2, E: 14, F: 3, G: 5, H: 4,
    I: 34, J: 38, K: 40, L: 37, M: 46, N: 45, O: 31, P: 35,
    Q: 12, R: 15, S: 1, T: 17, U: 32, V: 9, W: 13, X: 7,
    Y: 16, Z: 6, 
    // Special keys
    ENTER: 36, ESCAPE: 53, TAB: 48, SPACE: 49,
    // Modifiers
    COMMAND: 55, SHIFT: 56, OPTION: 58, CONTROL: 59
} as const;

export class MacOSApiService {
    private windowListeners = new Map<number, () => void>();

    private circuitBreaker = {
        failures: new Map<string, number>(),
        threshold: 3,
        resetAfter: 30000,

        async execute(key: string, fn: () => Promise<void>) {
            if ((this.failures.get(key) || 0) >= this.threshold) {
                throw new Error(`Service unavailable for ${key}`);
            }
            
            try {
                await fn();
                this.failures.delete(key);
            } catch (error) {
                const count = (this.failures.get(key) || 0) + 1;
                this.failures.set(key, count);
                setTimeout(() => this.failures.delete(key), this.resetAfter);
                throw error;
            }
        }
    };

    async checkSecurityPermissions(): Promise<{
        accessibility: boolean;
        fullDisk: boolean;
        automation: boolean;
    }> {
        return {
            accessibility: await this.checkAccessibilityPermissions(),
            fullDisk: await this.checkFullDiskAccess(),
            automation: await this.checkAutomationPermissions()
        };
    }

    private async checkAutomationPermissions(): Promise<boolean> {
        try {
            await runAppleScript('tell application "System Events" to get name of processes');
            return true;
        } catch {
            return false;
        }
    }

    async ensurePermissions(): Promise<void> {
        const perms = await this.checkSecurityPermissions();
        
        if (!perms.accessibility) {
            await this.requestAccessibilityPermissions();
            throw new Error('Accessibility permissions required - Please enable in System Settings');
        }
        
        if (!perms.fullDisk) {
            throw new Error('Full disk access required - Enable in System Settings > Privacy & Security');
        }
    }

    async getWindowByProcessId(processId: number): Promise<IMacOSWindow | null> {
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

    async openCommandPalette(window: IMacOSWindow): Promise<void> {
        const script = `
            tell application "System Events"
                tell process "${window.title}"
                    key code 35 using {command down, shift down}
                end tell
            end tell
        `;
        await runAppleScript(script);
    }

    async sendKeyToWindow(window: IMacOSWindow, keyCode: number, modifiers?: {
        cmd?: boolean;
        alt?: boolean;
        shift?: boolean;
        ctrl?: boolean;
    }): Promise<void> {
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
    }

    private async checkAccessibilityPermissions(): Promise<boolean> {
        try {
            await runAppleScript('tell application "System Events" to get name of first window');
            return true;
        } catch {
            return false;
        }
    }

    private async checkFullDiskAccess(): Promise<boolean> {
        try {
            await runAppleScript('tell application "System Events" to get folder "Documents" of home');
            return true;
        } catch {
            return false;
        }
    }

    private async requestAccessibilityPermissions(): Promise<void> {
        const script = `
            tell application "System Preferences"
                activate
                set current pane to pane id "com.apple.preference.security"
                reveal anchor "Privacy_Accessibility" of pane id "com.apple.preference.security"
            end tell
        `;
        await runAppleScript(script);
    }

    async executeAppleScript(window: IMacOSWindow, script: string): Promise<void> {
        await runAppleScript(script);
    }

    async executeAppleScriptSafe(window: IMacOSWindow, script: string) {
        return this.circuitBreaker.execute(
            `applescript:${window.processId}`, 
            () => this.executeAppleScript(window, script)
        );
    }

    releaseWindow(window: IMacOSWindow): void {
        // Implementation if needed
    }

    trackWindow(processId: number, callback: (window: IMacOSWindow | null) => void) {
        const checkWindow = async () => {
            const win = await this.getWindowByProcessId(processId);
            callback(win);
        };
        
        const interval = setInterval(checkWindow, 1000);
        this.windowListeners.set(processId, () => clearInterval(interval));
        checkWindow();
    }

    stopTracking(processId: number) {
        const cleaner = this.windowListeners.get(processId);
        cleaner?.();
        this.windowListeners.delete(processId);
    }

    async isProcessActive(pid: number): Promise<boolean> {
        try {
            const script = `
                tell application "System Events"
                    return exists process id ${pid}
                end tell
            `;
            const result = await runAppleScript(script);
            return result === 'true';
        } catch (error) {
            return false;
        }
    }
} 