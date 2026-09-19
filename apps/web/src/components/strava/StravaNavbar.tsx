import { Bell, ChevronDown, FolderOpen, Gift, Languages, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { triggerFileInput } from '@/lib/file-actions';
import { useT } from '@/store/i18n-slice';

export function StravaNavbar() {
    const { t, lang, toggleLanguage } = useT();

    return (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
            {/* Left brand & navigation */}
            <div className="flex items-center gap-6">
                {/* Strava style Logo */}
                <div className="flex cursor-pointer items-center gap-1.5 select-none" onClick={() => window.location.reload()}>
                    <svg className="size-6 text-[#FC5200]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7.38 14.544h4.172" />
                    </svg>
                    <span className="text-xl font-black italic tracking-tighter text-[#FC5200]">
                        X-ROUTE
                    </span>
                    <span className="ml-1 rounded bg-[#FC5200]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#FC5200]">
                        BUILDER
                    </span>
                </div>

                <div className="flex items-center text-muted-foreground hover:text-foreground cursor-pointer">
                    <Search className="size-4" />
                </div>

                {/* Nav Links */}
                <nav className="hidden items-center gap-5 text-sm font-medium md:flex">
                    <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                        {t.dashboard} <ChevronDown className="size-3.5" />
                    </button>
                    <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                        {t.training} <ChevronDown className="size-3.5" />
                    </button>
                    <button className="relative flex items-center gap-1 font-semibold text-foreground">
                        {t.maps}
                        <span className="absolute -bottom-4.5 left-0 h-0.5 w-full bg-[#FC5200]" />
                    </button>
                    <button className="text-muted-foreground hover:text-foreground">
                        {t.challenges}
                    </button>
                </nav>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 border-dashed text-xs font-medium"
                    onClick={triggerFileInput}
                    title="Import GPX / ZIP"
                >
                    <FolderOpen className="size-3.5 text-[#FC5200]" />
                    <span>{t.importBtn}</span>
                </Button>

                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs font-medium"
                    onClick={toggleLanguage}
                    title="Switch Language / 切换语言"
                >
                    <Languages className="mr-1 size-3.5" />
                    {lang === 'en' ? '中文' : 'EN'}
                </Button>

                <button
                    className="hidden items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:border-[#FC5200] hover:text-foreground lg:flex"
                    title="Gift"
                >
                    <Gift className="size-3.5 text-[#FC5200]" />
                    <span>Give a Gift</span>
                </button>

                <button className="text-muted-foreground hover:text-foreground" title="Notifications">
                    <Bell className="size-4.5" />
                </button>

                {/* User Avatar */}
                <div
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 to-[#FC5200] text-xs font-bold text-white shadow-sm ring-2 ring-background"
                    title="Runner Athlete"
                >
                    XR
                </div>

                {/* Plus create button */}
                <button
                    className="flex size-7 items-center justify-center rounded-full bg-[#FC5200] text-white shadow transition hover:bg-[#E04800]"
                    title="Create Route"
                    onClick={() => triggerFileInput()}
                >
                    <Plus className="size-4 stroke-[3]" />
                </button>
            </div>
        </header>
    );
}
