import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  FileUp, Loader2, ChevronLeft, CheckCircle2, XCircle,
  User, Briefcase, Banknote, FileText, Calendar, Hash, Trash2, Download
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

declare global { interface Window { pdfjsLib: any } }

type NaturezaVinculo = "EMPREGADO" | "CONTRIBUINTE_INDIVIDUAL" | "BENEFICIO_INCAPACIDADE" | "NAO_INFORMADO" | string;

interface PeriodoContribuicao {
  dataInicial: string;
  dataFinal: string;
  descricao: string;
  naturezaVinculo: NaturezaVinculo;
  contarCarencia: boolean;
}

interface Salario { competencia: string; valor: number }

interface CnisData {
  dadosSegurado: { nit: string; cpf: string; nome: string; nascimento: string; mae: string };
  periodosContribuicao: PeriodoContribuicao[];
  salarios: Salario[];
}

interface CartaData {
  numeroBeneficio: string;
  especie: string;
  codigoEspecie: string;
  dib: string;
  dip: string;
  rmi: number;
  salarioBeneficio: number;
  coeficiente: string;
  segurado: { nome: string; cpf: string; nit: string };
  tempoContribuicao: string;
  dataDespacho: string;
}

type DocStatus = "idle" | "loading" | "done" | "error";

function naturezaLabel(n: NaturezaVinculo) {
  const m: Record<string, string> = {
    EMPREGADO: "Empregado",
    CONTRIBUINTE_INDIVIDUAL: "Contrib. Individual",
    BENEFICIO_INCAPACIDADE: "Benefício Incapacidade",
    NAO_INFORMADO: "Não informado",
  };
  return m[n] || n;
}

function naturezaBadge(n: NaturezaVinculo) {
  if (n === "EMPREGADO") return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
  if (n === "CONTRIBUINTE_INDIVIDUAL") return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  if (n === "BENEFICIO_INCAPACIDADE") return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

async function extrairTextoPdf(file: File): Promise<string> {
  if (!(window as any).pdfjsLib) throw new Error("PDF.js não carregado");
  const buffer = await file.arrayBuffer();
  const pdf = await (window as any).pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  return text;
}

function UploadZone({
  label, sublabel, icon: Icon, status, fileName, onFile, onClear
}: {
  label: string; sublabel: string; icon: any;
  status: DocStatus; fileName?: string;
  onFile: (f: File) => void; onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      {status === "done" && (
        <button
          onClick={onClear}
          className="absolute top-2 right-2 z-10 p-1 rounded-full bg-white dark:bg-gray-800 shadow hover:bg-red-50 dark:hover:bg-red-900 transition-colors"
          title="Remover"
        >
          <Trash2 size={14} className="text-red-500" />
        </button>
      )}
      <div
        onClick={() => status === "idle" && ref.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all
          ${status === "idle" ? "cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 border-gray-300 dark:border-gray-600" : ""}
          ${status === "loading" ? "border-amber-300 bg-amber-50/30 dark:bg-amber-950/20" : ""}
          ${status === "done" ? "border-green-400 bg-green-50/30 dark:bg-green-950/20 cursor-default" : ""}
          ${status === "error" ? "border-red-400 bg-red-50/30 dark:bg-red-950/20 cursor-pointer" : ""}
        `}
      >
        <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        {status === "loading" ? (
          <Loader2 size={32} className="animate-spin text-amber-500" />
        ) : status === "done" ? (
          <CheckCircle2 size={32} className="text-green-500" />
        ) : status === "error" ? (
          <XCircle size={32} className="text-red-500" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <Icon size={26} className="text-blue-600 dark:text-blue-300" />
          </div>
        )}
        <div>
          <p className="font-semibold text-sm text-gray-800 dark:text-gray-200">
            {status === "loading" ? "Processando..." : status === "done" ? fileName : status === "error" ? "Erro — tente novamente" : label}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sublabel}</p>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
        <Icon size={16} className="text-blue-600 dark:text-blue-400" />
        <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide w-36 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{value}</span>
    </div>
  );
}

export default function PrevidenciarioPage() {
  const { toast } = useToast();
  const [cnisStatus, setCnisStatus] = useState<DocStatus>("idle");
  const [cartaStatus, setCartaStatus] = useState<DocStatus>("idle");
  const [cnisFileName, setCnisFileName] = useState<string>();
  const [cartaFileName, setCartaFileName] = useState<string>();
  const [cnisData, setCnisData] = useState<CnisData | null>(null);
  const [cartaData, setCartaData] = useState<CartaData | null>(null);
  const [pdfjsReady, setPdfjsReady] = useState(false);

  const loadPdfJs = useCallback(() => {
    if (window.pdfjsLib) { setPdfjsReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
      setPdfjsReady(true);
    };
    document.head.appendChild(s);
  }, []);

  useEffect(() => { loadPdfJs(); }, [loadPdfJs]);

  const processarPdf = async (file: File, tipo: "cnis" | "carta") => {
    if (!pdfjsReady && !window.pdfjsLib) {
      toast({ title: "PDF.js ainda carregando", description: "Aguarde 2 segundos e tente novamente.", variant: "destructive" });
      return;
    }
    if (tipo === "cnis") { setCnisStatus("loading"); setCnisFileName(file.name); }
    else { setCartaStatus("loading"); setCartaFileName(file.name); }

    try {
      const texto = await extrairTextoPdf(file);
      const res = await apiRequest("POST", "/api/previdenciario/extrair", { texto, tipo });
      const json = await res.json();
      if (tipo === "cnis") { setCnisData(json.data); setCnisStatus("done"); }
      else { setCartaData(json.data); setCartaStatus("done"); }
      toast({ title: `${tipo === "cnis" ? "CNIS" : "Carta"} importado com sucesso`, description: `Dados extraídos pelo Gemini AI.` });
    } catch (e: any) {
      if (tipo === "cnis") setCnisStatus("error");
      else setCartaStatus("error");
      toast({ title: "Erro na extração", description: e.message, variant: "destructive" });
    }
  };

  const exportarJson = () => {
    const data = { cnis: cnisData, carta: cartaData, exportadoEm: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `previdenciario_${cnisData?.dadosSegurado?.nome?.split(" ")[0] || "dados"}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const temDados = cnisData || cartaData;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <button className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <ChevronLeft size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
          </Link>
          <div>
            <h1 className="font-bold text-gray-900 dark:text-white text-base">Importador Previdenciário</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">CNIS + Carta de Concessão via Gemini AI</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {temDados && (
            <Button variant="outline" size="sm" onClick={exportarJson} className="gap-2 text-xs">
              <Download size={14} /> Exportar JSON
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UploadZone
            label="Importar CNIS"
            sublabel="PDF do Extrato Previdenciário (Meu INSS)"
            icon={FileText}
            status={cnisStatus}
            fileName={cnisFileName}
            onFile={f => processarPdf(f, "cnis")}
            onClear={() => { setCnisStatus("idle"); setCnisData(null); setCnisFileName(undefined); }}
          />
          <UploadZone
            label="Importar Carta de Concessão"
            sublabel="PDF da Carta de Benefício do INSS"
            icon={FileUp}
            status={cartaStatus}
            fileName={cartaFileName}
            onFile={f => processarPdf(f, "carta")}
            onClear={() => { setCartaStatus("idle"); setCartaData(null); setCartaFileName(undefined); }}
          />
        </div>

        {!temDados && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-600">
            <FileText size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-sm">Faça o upload dos documentos acima para extrair os dados</p>
            <p className="text-xs mt-1">O Gemini AI reconhece automaticamente o padrão de cada documento</p>
          </div>
        )}

        {cnisData && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-blue-600 text-white text-xs px-3 py-1">CNIS</Badge>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {cnisData.periodosContribuicao?.length || 0} períodos · {cnisData.salarios?.length || 0} competências
              </span>
            </div>

            <SectionCard title="Dados do Segurado" icon={User}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <InfoRow label="Nome" value={cnisData.dadosSegurado?.nome} />
                <InfoRow label="CPF" value={cnisData.dadosSegurado?.cpf} />
                <InfoRow label="NIT / PIS" value={cnisData.dadosSegurado?.nit} />
                <InfoRow label="Nascimento" value={cnisData.dadosSegurado?.nascimento} />
                <InfoRow label="Nome da Mãe" value={cnisData.dadosSegurado?.mae} />
              </div>
            </SectionCard>

            <SectionCard title="Períodos de Contribuição" icon={Briefcase}>
              {cnisData.periodosContribuicao?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-2 pr-4 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">#</th>
                        <th className="text-left py-2 pr-4 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Início</th>
                        <th className="text-left py-2 pr-4 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fim</th>
                        <th className="text-left py-2 pr-4 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Empresa / Descrição</th>
                        <th className="text-left py-2 pr-4 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Natureza</th>
                        <th className="text-left py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Carência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cnisData.periodosContribuicao.map((p, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                          <td className="py-2 pr-4 text-gray-400 font-mono">{i + 1}</td>
                          <td className="py-2 pr-4 font-mono text-gray-800 dark:text-gray-200">{p.dataInicial}</td>
                          <td className="py-2 pr-4 font-mono text-gray-800 dark:text-gray-200">{p.dataFinal}</td>
                          <td className="py-2 pr-4 text-gray-700 dark:text-gray-300 max-w-xs truncate">{p.descricao}</td>
                          <td className="py-2 pr-4">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${naturezaBadge(p.naturezaVinculo)}`}>
                              {naturezaLabel(p.naturezaVinculo)}
                            </span>
                          </td>
                          <td className="py-2">
                            {p.contarCarencia ? (
                              <CheckCircle2 size={14} className="text-green-500" />
                            ) : (
                              <XCircle size={14} className="text-red-400" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Nenhum período encontrado.</p>
              )}
            </SectionCard>

            {cnisData.salarios?.length > 0 && (
              <SectionCard title={`Salários de Contribuição (${cnisData.salarios.length} competências)`} icon={Banknote}>
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-gray-900">
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-2 pr-8 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Competência</th>
                        <th className="text-right py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Valor (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cnisData.salarios.map((s, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1.5 pr-8 font-mono text-gray-700 dark:text-gray-300">{s.competencia}</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-gray-800 dark:text-gray-200">
                            {typeof s.valor === "number" ? s.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : s.valor}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}
          </div>
        )}

        {cartaData && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-green-600 text-white text-xs px-3 py-1">CARTA DE CONCESSÃO</Badge>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {cartaData.especie}
              </span>
            </div>

            <SectionCard title="Dados do Benefício" icon={Hash}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <InfoRow label="Número do Benefício" value={cartaData.numeroBeneficio} />
                <InfoRow label="Espécie" value={cartaData.especie} />
                <InfoRow label="Código" value={cartaData.codigoEspecie} />
                <InfoRow label="DIB (Início Benefício)" value={cartaData.dib} />
                <InfoRow label="DIP (Início Pagamento)" value={cartaData.dip} />
                <InfoRow label="Data do Despacho" value={cartaData.dataDespacho} />
              </div>
            </SectionCard>

            <SectionCard title="Valores" icon={Banknote}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <InfoRow
                  label="RMI"
                  value={cartaData.rmi ? `R$ ${Number(cartaData.rmi).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : undefined}
                />
                <InfoRow
                  label="Salário de Benefício"
                  value={cartaData.salarioBeneficio ? `R$ ${Number(cartaData.salarioBeneficio).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : undefined}
                />
                <InfoRow label="Coeficiente" value={cartaData.coeficiente} />
                <InfoRow label="Tempo de Contribuição" value={cartaData.tempoContribuicao} />
              </div>
            </SectionCard>

            <SectionCard title="Dados do Segurado" icon={User}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <InfoRow label="Nome" value={cartaData.segurado?.nome} />
                <InfoRow label="CPF" value={cartaData.segurado?.cpf} />
                <InfoRow label="NIT / PIS" value={cartaData.segurado?.nit} />
              </div>
            </SectionCard>

            {cnisData && cartaData && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar size={16} className="text-amber-600" />
                  <h3 className="font-semibold text-sm text-amber-800 dark:text-amber-300">Comparativo CNIS × Carta</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Segurado (CNIS)</p>
                    <p className="font-bold text-gray-800 dark:text-gray-200 text-xs">{cnisData.dadosSegurado?.nome || "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">TC (Carta)</p>
                    <p className="font-bold text-gray-800 dark:text-gray-200 text-xs">{cartaData.tempoContribuicao || "—"}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Períodos no CNIS</p>
                    <p className="font-bold text-gray-800 dark:text-gray-200 text-xs">{cnisData.periodosContribuicao?.length || 0} vínculos</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

