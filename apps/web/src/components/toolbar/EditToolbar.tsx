import { useState } from 'react';
import { ArrowLeftRight, Scissors, Sparkles, CircleDot, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSelectionStore } from '@/store/selection-slice';
import { reverseTrack, simplifyTrack, closeLoop, splitTrackAtMiddle } from '@/lib/file-actions';
import { useT } from '@/store/i18n-slice';

export function EditToolbar() {
    const { t } = useT();
    const selectedFileId = useSelectionStore((s) => s.selectedFileId);
    const [actionStatus, setActionStatus] = useState<string | null>(null);

    if (!selectedFileId) return null;

    const runAction = async (name: string, fn: () => Promise<void>) => {
        try {
            await fn();
            setActionStatus(name);
            setTimeout(() => setActionStatus(null), 1500);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="flex items-center gap-1 border-l pl-2">
            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('reversed', () => reverseTrack(selectedFileId))}
                title={t.reverseTitle}
            >
                {actionStatus === 'reversed' ? <Check className="size-3.5 text-green-600" /> : <ArrowLeftRight className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">{t.reverse}</span>
            </Button>

            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('simplified', () => simplifyTrack(selectedFileId))}
                title={t.simplifyTitle}
            >
                {actionStatus === 'simplified' ? <Check className="size-3.5 text-green-600" /> : <Sparkles className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">{t.simplify}</span>
            </Button>

            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('split', () => splitTrackAtMiddle(selectedFileId))}
                title={t.splitTitle}
            >
                {actionStatus === 'split' ? <Check className="size-3.5 text-green-600" /> : <Scissors className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">{t.split}</span>
            </Button>

            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('loop', () => closeLoop(selectedFileId))}
                title={t.loopTitle}
            >
                {actionStatus === 'loop' ? <Check className="size-3.5 text-green-600" /> : <CircleDot className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">{t.loop}</span>
            </Button>
        </div>
    );
}
