import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'zh';

export const translations = {
    en: {
        appName: 'x-route',
        tagline: 'Route creation & planning',
        importBtn: 'Import GPX / ZIP',
        plan: 'Plan',
        exitPlan: 'Exit Plan',
        togglePlan: 'Toggle route planning',
        save: 'Save',
        saved: 'Saved!',
        clear: 'Clear route',
        undo: 'Undo (Ctrl+Z)',
        redo: 'Redo (Ctrl+Y)',
        reverse: 'Reverse',
        reverseTitle: 'Reverse track direction',
        simplify: 'Simplify',
        simplifyTitle: 'Simplify track (RDP reduction)',
        split: 'Split',
        splitTitle: 'Split track at midpoint',
        loop: 'Loop',
        loopTitle: 'Close loop (connect end to start)',
        elevationProfile: 'Elevation Profile',
        files: 'Files',
        noFiles: 'No files yet — import a .gpx or .zip to get started.',
        loading: 'Loading…',
        untitled: 'Untitled',
        exportGpx: 'Export GPX',
        delete: 'Delete',
        basemap: 'Basemap',
        distance: 'Distance',
        ascent: 'Ascent',
        descent: 'Descent',
        pts: 'pts',
        expand: 'Expand',
        collapse: 'Collapse',
        profiles: {
            bike: 'Bike',
            racing_bike: 'Road bike',
            gravel_bike: 'Gravel bike',
            mountain_bike: 'MTB',
            foot: 'Foot',
            water: 'Water',
            railway: 'Railway',
        },
        basemaps: {
            liberty: 'Liberty',
            positron: 'Positron',
            dark: 'Dark',
            bright: 'Bright',
        },
    },
    zh: {
        appName: 'x-route',
        tagline: '智能路线规划与轨迹编辑',
        importBtn: '导入 GPX / ZIP',
        plan: '规划路线',
        exitPlan: '退出规划',
        togglePlan: '开启/关闭路线规划',
        save: '保存',
        saved: '已保存!',
        clear: '清空路线',
        undo: '撤销 (Ctrl+Z)',
        redo: '重做 (Ctrl+Y)',
        reverse: '反向轨迹',
        reverseTitle: '反转轨迹前进方向',
        simplify: '抽稀降噪',
        simplifyTitle: '抽稀轨迹点 (RDP 降噪)',
        split: '中点切分',
        splitTitle: '从中点将轨迹切分为两段',
        loop: '闭合环线',
        loopTitle: '闭合环线 (连接起点与终点)',
        elevationProfile: '海拔高度剖面',
        files: '轨迹列表',
        noFiles: '暂无轨迹文件。点击右上角导入 GPX 或点击“规划路线”开始创作。',
        loading: '加载中…',
        untitled: '未命名',
        exportGpx: '导出 GPX',
        delete: '删除',
        basemap: '底图',
        distance: '距离',
        ascent: '累计爬升',
        descent: '累计下降',
        pts: '点',
        expand: '展开',
        collapse: '收起',
        profiles: {
            bike: '标准骑行',
            racing_bike: '公路车 (铺装路)',
            gravel_bike: '砾石公路 (Gravel)',
            mountain_bike: '山地越野 (MTB)',
            foot: '徒步走线',
            water: '水路航线',
            railway: '铁路轨迹',
        },
        basemaps: {
            liberty: '彩色底图',
            positron: '浅色浅灰',
            dark: '深色暗夜',
            bright: '明亮高对比',
        },
    },
} as const;

export type Translations = typeof translations.en;

interface I18nState {
    language: Language;
    setLanguage: (lang: Language) => void;
    toggleLanguage: () => void;
}

export const useI18nStore = create<I18nState>()(
    persist(
        (set, get) => ({
            language: (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) ? 'zh' : 'en',
            setLanguage: (language) => set({ language }),
            toggleLanguage: () => set({ language: get().language === 'en' ? 'zh' : 'en' }),
        }),
        { name: 'x-route-language' }
    )
);

export function useT() {
    const language = useI18nStore((s) => s.language);
    const setLanguage = useI18nStore((s) => s.setLanguage);
    const toggleLanguage = useI18nStore((s) => s.toggleLanguage);
    return {
        t: translations[language],
        lang: language,
        setLanguage,
        toggleLanguage,
    };
}
