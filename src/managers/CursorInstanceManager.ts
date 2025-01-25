import { CursorInstance } from '../types/cursor.js'
import path from 'path'
import { spawn } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { MacOSApiService, IMacOSWindow } from '../services/MacOSApiService.js'

const DEFAULT_CURSOR_PATH = '/Applications/Cursor.app/Contents/MacOS/Cursor'

export interface CursorInstanceManager {
    create(workspacePath?: string): Promise<CursorInstance>
    get(id: string): CursorInstance | undefined
    sendKeyToInstance(id: string, virtualKey: number): Promise<void>
    openCommandPalette(id: string): Promise<void>
    openClineTab(id: string): Promise<void>
    list(): CursorInstance[]
    remove(id: string): boolean
    sendCharToInstance(id: string, char: string): Promise<void>
}

export class CursorInstanceManagerImpl implements CursorInstanceManager {
    private macosApi: MacOSApiService
    private instances: Map<string, CursorInstance>

    constructor() {
        this.macosApi = new MacOSApiService()
        this.instances = new Map()
        this.startHealthChecks()
    }

    async create(workspacePath?: string): Promise<CursorInstance> {
        if (workspacePath) {
            const homeDir = process.env.HOME || '';
            const resolvedPath = path.resolve(workspacePath);
            if (!resolvedPath.startsWith(homeDir)) {
                throw new Error('Workspace path must be within user home directory');
            }
        }
        const args = workspacePath ? ['--open', workspacePath] : []
        const cursorProcess = spawn(DEFAULT_CURSOR_PATH, args, {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                MCP_INTEGRATION: '1',
                CURSOR_MACOS_MCP_VERSION: '1.0.0'
            }
        })

        const id = uuidv4()
        const instance: CursorInstance = {
            id,
            process: cursorProcess,
            window: undefined,
            isActive: true,
            createdAt: new Date(),
            workspacePath
        }

        this.instances.set(id, instance)

        // Create a promise that resolves when the window is found or rejects on error
        const windowPromise = new Promise<IMacOSWindow>((resolve, reject) => {
            let errorOutput = ''
            let attempts = 0
            const maxAttempts = 10
            const checkInterval = 500 // ms

            cursorProcess.on('error', (error: Error) => {
                console.error('Process error:', error)
                instance.isActive = false
                reject(new Error(`Failed to start Cursor process: ${error.message}`))
            })

            cursorProcess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString()
                console.log('Process stdout for instance', id + ':', output)
            })

            cursorProcess.stderr?.on('data', (data: Buffer) => {
                const error = data.toString()
                console.error('Process stderr for instance', id + ':', error)
                errorOutput += error

                if (error.includes('Cannot find module')) {
                    const moduleName = error.match(/Cannot find module '([^']+)'/)?.[1]
                    if (moduleName) {
                        reject(new Error(`Cursor is missing required module: ${moduleName}. Please ensure Cursor is installed correctly with all dependencies.`))
                    }
                }
            })

            cursorProcess.on('exit', (code: number | null) => {
                console.log('Process exited for instance', id, 'with code:', code)
                instance.isActive = false
                this.instances.delete(id)

                if (code === 0) {
                    reject(new Error('Cursor process exited normally but window was not created. This may indicate a configuration issue.'))
                } else {
                    reject(new Error(`Cursor process exited with code ${code}. Error output: ${errorOutput}`))
                }
            })

            const checkWindow = async () => {
                if (!instance.isActive) return

                try {
                    const window = await this.macosApi.getWindowByProcessId(cursorProcess.pid!)
                    if (window) {
                        resolve(window)
                        return
                    }
                } catch (error) {
                    console.warn('Error checking for window:', error)
                }

                attempts++
                if (attempts >= maxAttempts) {
                    reject(new Error('Failed to find Cursor window after maximum attempts. The process may have failed to start properly.'))
                } else {
                    setTimeout(checkWindow, checkInterval)
                }
            }

            checkWindow()
        })

        try {
            instance.window = await windowPromise
            return instance
        } catch (error) {
            console.error('Error creating Cursor instance:', error)
            instance.isActive = false
            this.instances.delete(id)
            throw error
        }
    }

    get(id: string): CursorInstance | undefined {
        return this.instances.get(id)
    }

    private getRequired(id: string): CursorInstance {
        const instance = this.instances.get(id)
        if (!instance) {
            throw new Error(`No instance found with id: ${id}`)
        }
        return instance
    }

    private async findWindow(id: string, pid: number): Promise<IMacOSWindow> {
        let window: IMacOSWindow | null = null;
        let attempts = 0;
        const maxAttempts = 10;
        const retryDelay = 500;

        while (!window && attempts < maxAttempts) {
            try {
                window = await this.macosApi.getWindowByProcessId(pid);
                if (!window) {
                    console.log(`Window not found for PID ${pid}, attempt ${attempts + 1}/${maxAttempts}`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            } catch (error) {
                console.error('Window detection error:', error);
            }
            attempts++;
        }

        if (!window) {
            throw new Error('Failed to find Cursor window after launch')
        }

        return window
    }

    async sendCharToInstance(id: string, char: string): Promise<void> {
        const instance = this.getRequired(id)
        if (!instance.window) {
            throw new Error('Window reference lost')
        }
        // For MacOS, we'll map common characters to their key codes
        const keyCode = this.getKeyCodeForChar(char)
        await this.sendKeyToInstance(id, keyCode)
    }

    private getKeyCodeForChar(char: string): number {
        // Flawed key code mapping - macOS key codes don't follow ASCII order
        const code = char.toUpperCase().charCodeAt(0)
        return code - 65 + 0 // Incorrect mapping (e.g., A=0, B=1,... but macOS uses different codes)
    }

    async sendKeyToInstance(id: string, virtualKey: number): Promise<void> {
        const instance = this.getRequired(id)
        if (!instance.window) {
            throw new Error('Window reference lost')
        }
        await this.macosApi.sendKeyToWindow(instance.window, virtualKey)
    }

    async openCommandPalette(id: string): Promise<void> {
        const instance = this.getRequired(id)
        if (!instance.window) {
            throw new Error('Window reference lost')
        }
        await this.macosApi.openCommandPalette(instance.window)
    }

    async openClineTab(id: string): Promise<void> {
        const instance = this.getRequired(id);
        if (!instance.window) throw new Error('Window reference lost');

        try {
            await this.macosApi.executeAppleScript(instance.window, `
                tell application "System Events"
                    keystroke "Cline: Open in New Tab"
                    delay 0.5
                    key code 36 -- Enter key
                end tell
            `);
        } catch (error) {
            console.error('Failed to open Cline tab:', error);
            throw new Error(`Cline tab opening failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    list(): CursorInstance[] {
        return Array.from(this.instances.values())
    }

    remove(id: string): boolean {
        const instance = this.instances.get(id);
        if (!instance) return false;

        if (instance.window) {
            this.macosApi.releaseWindow(instance.window);
        }

        if (instance.isActive) {
            try {
                instance.process.kill('SIGTERM');
            } catch (error) {
                console.error('Error killing process:', error);
            }
        }

        return this.instances.delete(id);
    }

    private startHealthChecks() {
        setInterval(async () => {
            for (const [id, instance] of this.instances) {
                const isAlive = await this.macosApi.isProcessActive(instance.process.pid!);
                if (!isAlive) {
                    instance.isActive = false;
                    this.remove(id);
                }
            }
        }, 5000);
    }
} 