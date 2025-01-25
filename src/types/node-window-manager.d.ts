declare module 'node-window-manager' {
    export interface Window {
        processId: number;
        handle: number;
        title: string;
        bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        getTitle(): string;
        getBounds(): { x: number; y: number; width: number; height: number; };
        setBounds(bounds: { x: number; y: number; width: number; height: number; }): void;
        bringToTop(): void;
        show(): void;
        restore(): void;
    }

    export interface WindowManager {
        getWindows(): Window[];
        getActiveWindow(): Window | null;
    }

    export const windowManager: WindowManager;
}