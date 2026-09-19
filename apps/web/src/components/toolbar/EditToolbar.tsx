import { useState } from 'react';
import { ArrowLeftRight, Scissors, Sparkles, CircleDot, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSelectionStore } from '@/store/selection-slice';
import { reverseTrack, simplifyTrack, closeLoop, splitTrackAtMiddle } from '@/lib/file-actions';

export function EditToolbar() {
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
                title="Reverse track direction"
            >
                {actionStatus === 'reversed' ? <Check className="size-3.5 text-green-600" /> : <ArrowLeftRight className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">Reverse</span>
            </Button>

            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('simplified', () => simplifyTrack(selectedFileId))}
                title="Simplify track (RDP reduction)"
            >
                {actionStatus === 'simplified' ? <Check className="size-3.5 text-green-600" /> : <Sparkles className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">Simplify</span>
            </Button>

            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('split', () => splitTrackAtMiddle(selectedFileId))}
                title="Split track at midpoint"
            >
                {actionStatus === 'split' ? <Check className="size-3.5 text-green-600" /> : <Scissors className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">Split</span>
            </Button>

            <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => void runAction('loop', () => closeLoop(selectedFileId))}
                title="Close loop (connect end to start)"
            >
                {actionStatus === 'loop' ? <Check className="size-3.5 text-green-600" /> : <CircleDot className="size-3.5" />}
                <span className="ml-1 hidden sm:inline">Loop</span>
            </Button>
        </div>
    );
}
