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
                {/* Site Logo using favicon.svg */}
                <div
                    className="flex cursor-pointer items-center gap-2"
                    onClick={() => window.location.reload()}
                >
                    <img
                        src="/favicon.svg"
                        alt="x-route"
                        className="size-7 object-contain drop-shadow-xs"
                    />
                    <span className="text-xl font-black italic tracking-tighter text-[#863BFF]">
                        X-ROUTE
                    </span>
                    <span className="ml-0.5 rounded bg-[#863BFF]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#863BFF]">
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
                        <span className="absolute -bottom-4.5 left-0 h-0.5 w-full bg-[#863BFF]" />
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
                    className="h-8 gap-1.5 border-dashed text-xs font-semibold text-foreground hover:border-[#863BFF] hover:text-[#863BFF]"
                    onClick={triggerFileInput}
                    title="Import GPX / ZIP"
                >
                    <FolderOpen className="size-3.5 text-[#863BFF]" />
                    <span>{t.importBtn}</span>
                </Button>

                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs font-medium hover:text-[#863BFF]"
                    onClick={toggleLanguage}
                    title="Switch Language / 切换语言"
                >
                    <Languages className="mr-1 size-3.5" />
                    {lang === 'en' ? '中文' : 'EN'}
                </Button>

                {/* Plus create button */}
                <button
                    className="flex size-7 items-center justify-center rounded-full bg-[#863BFF] text-white shadow-xs transition hover:bg-[#7424F8]"
                    title="Import GPX / ZIP"
                    onClick={triggerFileInput}
                >
                    <Plus className="size-4 stroke-[3]" />
                </button>
            </div>
        </header>
    );
}
