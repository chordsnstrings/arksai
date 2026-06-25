import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Sample starter screen — minimal, polished, responsive. Replace with the real app.
// Components come from src/components/ui (shadcn-style); theme via src/index.css tokens.
export default function App() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-3xl py-16 animate-fade-up">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Built with ArksAI · React + Tailwind
        </div>
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">__APP_TITLE__</h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          A minimal, responsive React + Tailwind starter with shadcn-style components. Replace this
          with your real screens — keep it minimal, polished and on-brand.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Composed from the bundled UI components.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="form">
              <TabsList>
                <TabsTrigger value="form">Form</TabsTrigger>
                <TabsTrigger value="about">About</TabsTrigger>
              </TabsList>
              <TabsContent value="form">
                <div className="grid gap-4 sm:max-w-sm">
                  <div className="grid gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@company.com" />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button className="gap-2">
                      Continue <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline">Open dialog</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>A real modal</DialogTitle>
                          <DialogDescription>
                            Accessible Radix dialog, themed to your tokens. Replace with your content.
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="about">
                <p className="text-sm text-muted-foreground">
                  Edit <code className="rounded bg-muted px-1 py-0.5">src/App.tsx</code> and add
                  components to <code className="rounded bg-muted px-1 py-0.5">src/components/ui</code>.
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
