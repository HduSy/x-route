import { FolderOpen, Languages, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { triggerFileInput } from '@/lib/file-actions';
import { useT } from '@/store/i18n-slice';

export function StravaNavbar() {
    const { t, lang, toggleLanguage } = useT();

    return (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4 select-none">
            {/* Left brand & navigation */}
            <div className="flex items-center gap-8">
                {/* Strava style Logo */}
                <div
                    className="flex cursor-pointer items-center gap-1.5"
                    onClick={() => window.location.reload()}
                >
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

                {/* Nav Links directly jumping to Strava sections */}
                <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
                    <a
                        href="https://www.strava.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition hover:text-foreground"
                    >
                        {t.dashboard}
                    </a>
                    <a
                        href="https://www.strava.com/athlete/training"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition hover:text-foreground"
                    >
                        {t.training}
                    </a>
                    <span className="relative flex items-center font-semibold text-foreground cursor-default">
                        {t.maps}
                        <span className="absolute -bottom-4.5 left-0 h-0.5 w-full bg-[#FC5200]" />
                    </span>
                    <a
                        href="https://www.strava.com/challenges"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition hover:text-foreground"
                    >
                        {t.challenges}
                    </a>
                </nav>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2.5">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 border-dashed text-xs font-semibold"
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

                {/* Plus create button */}
                <button
                    className="flex size-7 items-center justify-center rounded-full bg-[#FC5200] text-white shadow-xs transition hover:bg-[#E04800]"
                    title="Import GPX / ZIP"
                    onClick={triggerFileInput}
                >
                    <Plus className="size-4 stroke-[3]" />
                </button>
            </div>
        </header>
    );
}
