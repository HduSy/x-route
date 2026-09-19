import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function App() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-2xl">x-route</CardTitle>
                    <CardDescription>
                        Route creation &amp; planning — migrated from gpx.studio
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Phase 0: workspace scaffold, routing relay and deploy pipeline.
                    </p>
                    <Button disabled>Map coming in Phase 2</Button>
                </CardContent>
            </Card>
        </div>
    )
}
