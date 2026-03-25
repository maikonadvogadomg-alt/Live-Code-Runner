import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Play, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type RobotStatus = {
  status: "idle" | "running" | "error";
  lastRun: string | null;
  tasksCompleted: number;
  details?: string;
};

export default function RoboJuridico() {
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState(false);

  const { data: status, isLoading } = useQuery<RobotStatus>({
    queryKey: ["/api/robo-juridico/status"],
    refetchInterval: 2000 // Polling a cada 2s para ver progresso
  });

  const { data: logs } = useQuery<string[]>({
    queryKey: ["/api/robo-juridico/logs"],
    refetchInterval: 2000
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/robo-juridico/execute", { 
        action: "full_cycle",
        dryRun
      });
    },
    onSuccess: () => {
      toast({ title: "Comando enviado", description: "O robô iniciou a execução." });
      queryClient.invalidateQueries({ queryKey: ["/api/robo-juridico/status"] });
    },
    onError: (error) => {
      toast({ 
        title: "Erro", 
        description: "Falha ao iniciar robô. Verifique se já não está rodando.", 
        variant: "destructive" 
      });
    }
  });

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          🤖 Robô Jurídico <Badge variant="outline">TypeScript</Badge>
        </h1>
        <p className="text-muted-foreground">
          Automação de tarefas jurídicas: leitura de diários, verificação de prazos e envio de notificações.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status do Sistema</CardTitle>
            <CardDescription>Monitoramento em tempo real do worker</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Estado Atual</span>
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : status?.status === "running" ? (
                <Badge className="bg-green-600 hover:bg-green-700 animate-pulse">Executando</Badge>
              ) : (
                <Badge variant="secondary">Aguardando</Badge>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Última Execução</span>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <Clock className="h-3 w-3" />
                  {status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Nunca"}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Tarefas Concluídas</span>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-3 w-3" />
                  {status?.tasksCompleted || 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controle Manual</CardTitle>
            <CardDescription>Iniciar ciclos de verificação sob demanda</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center space-x-2">
              <Switch id="dry-run" checked={dryRun} onCheckedChange={setDryRun} />
              <Label htmlFor="dry-run">Modo Simulação (Dry Run)</Label>
            </div>
            
            <Button 
              className="w-full" 
              size="lg" 
              onClick={() => executeMutation.mutate()}
              disabled={status?.status === "running" || executeMutation.isPending}
            >
              {executeMutation.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Play className="mr-2 h-5 w-5" />
              )}
              {status?.status === "running" ? "Execução em andamento..." : "Iniciar Ciclo Completo"}
            </Button>
            
            <p className="text-xs text-muted-foreground text-center">
              O robô verificará novos processos, publicações e enviará e-mails pendentes.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="h-[400px] flex flex-col">
        <CardHeader>
          <CardTitle>Logs de Execução</CardTitle>
          <CardDescription>Histórico de atividades recentes</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <ScrollArea className="h-full rounded-md border p-4 bg-black/90 text-green-400 font-mono text-xs">
            {logs?.length ? (
              logs.slice().reverse().map((log, i) => (
                <div key={i} className="mb-1 border-b border-white/10 pb-1 last:border-0">
                  {log}
                </div>
              ))
            ) : (
              <div className="text-muted-foreground italic">Nenhum log registrado ainda...</div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
