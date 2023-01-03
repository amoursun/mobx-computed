declare global {
    interface Window {
        __DEV__: boolean;
    }
}

export const __DEV__ = window.__DEV__;
