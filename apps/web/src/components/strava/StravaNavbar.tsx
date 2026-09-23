import { FolderOpen, Languages, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { triggerFileInput } from '@/lib/file-actions';
import { useT } from '@/store/i18n-slice';
import { useRoutingStore } from '@/store/routing-slice';
import { cn } from '@/lib/utils';

export function StravaNavbar() {
    const { t, lang, toggleLanguage } = useT();

    const isPanelActive = useRoutingStore((s) => s.active && !s.sidebarCollapsed);
    const setActive = useRoutingStore((s) => s.setActive);
    const setSidebarCollapsed = useRoutingStore((s) => s.setSidebarCollapsed);

    const handleToggleRoutePanel = () => {
        if (isPanelActive) {
            setActive(false);
            setSidebarCollapsed(true);
        } else {
            setActive(true);
            setSidebarCollapsed(false);
        }
    };

    return (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-2.5 sm:px-4 select-none">
            {/* Left brand & navigation */}
            <div className="flex items-center gap-3 sm:gap-8">
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
                </div>

                {/* Nav Links directly jumping to Strava sections */}
                <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
                    <a
                        href="https://www.strava.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition hover:text-foreground cursor-pointer"
                    >
                        {t.dashboard}
                    </a>
                    <a
                        href="https://www.strava.com/athlete/training"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition hover:text-foreground cursor-pointer"
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
                        className="text-muted-foreground transition hover:text-foreground cursor-pointer"
                    >
                        {t.challenges}
                    </a>
                </nav>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1.5 sm:gap-2.5">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 sm:px-3 gap-1.5 border-dashed text-xs font-semibold text-foreground hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer"
                    onClick={triggerFileInput}
                    title={t.importBtn}
                >
                    <FolderOpen className="size-3.5 text-[#863BFF]" />
                    <span className="hidden sm:inline">{t.importBtn}</span>
                </Button>

                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-1.5 sm:px-2 text-xs font-medium hover:text-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] cursor-pointer"
                    onClick={toggleLanguage}
                    title={t.switchLanguage}
                >
                    <Languages className="mr-0.5 sm:mr-1 size-3.5" />
                    {lang === 'en' ? '中文' : 'EN'}
                </Button>

                {/* GitHub repository link (lucide v1 dropped brand icons, so inline the official mark) */}
                <a
                    href="https://github.com/HduSy/x-route"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:text-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] cursor-pointer"
                    title="GitHub"
                    aria-label="GitHub repository"
                >
                    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                    </svg>
                </a>

                {/* Strava style Outlined Plus Create Route button (Outlined circle, no solid fill) */}
                <button
                    className={cn(
                        'flex size-8 items-center justify-center rounded-full transition-all cursor-pointer select-none active:scale-95',
                        isPanelActive
                            ? 'border-2 border-[#863BFF] text-[#863BFF] bg-[#863BFF]/15 ring-2 ring-[#863BFF]/30 shadow-xs'
                            : 'border-[1.5px] border-[#863BFF]/75 text-[#863BFF] hover:border-[#863BFF] hover:bg-[#863BFF]/10 hover:shadow-xs'
                    )}
                    title={isPanelActive ? t.exitPlan : t.startDrawing}
                    onClick={handleToggleRoutePanel}
                >
                    <Plus className={cn('size-4 transition-transform', isPanelActive ? 'stroke-[2.2]' : 'stroke-[1.8]')} />
                </button>
            </div>
        </header>
    );
}
