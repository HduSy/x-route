import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface SettingsState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

// AD-2 settings slice: user preferences persisted to localStorage.
export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            theme: 'system',
            setTheme: (theme) => set({ theme }),
        }),
        { name: 'x-route-settings' }
    )
);
