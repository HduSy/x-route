import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { subscribeToasts, type ToastItem } from '@/lib/toast';
import { cn } from '@/lib/utils';

const TOAST_DURATION_MS = 3500;

export function Toaster() {
    const [items, setItems] = useState<ToastItem[]>([]);

    useEffect(
        () =>
            subscribeToasts((item) => {
                setItems((prev) => [...prev, item]);
                setTimeout(() => {
                    setItems((prev) => prev.filter((i) => i.id !== item.id));
                }, TOAST_DURATION_MS);
            }),
        []
    );

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-32 sm:bottom-36 z-[200] flex flex-col items-center gap-2 px-4">
            {items.map((item) => (
                <div
                    key={item.id}
                    className={cn(
                        'flex max-w-md items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200',
                        item.kind === 'error'
                            ? 'border-red-400/60 bg-red-600 text-white'
                            : 'border-border bg-card text-foreground'
                    )}
                    role="status"
                >
                    {item.kind === 'error' ? (
                        <AlertCircle className="size-4 shrink-0" />
                    ) : (
                        <CheckCircle2 className="size-4 shrink-0 text-[#863BFF]" />
                    )}
                    <span className="truncate">{item.message}</span>
                </div>
            ))}
        </div>
    );
}
