/**
 * Motor CPM (Método do Caminho Crítico) — tipos públicos.
 *
 * Convenção de tempo: dias úteis inteiros contados a partir do início do
 * projeto (offset 0). Uma atividade ocupa o intervalo semiaberto [início, fim):
 * fim = início + duração. Marco (milestone) tem duração 0.
 */

/** FS = término→início, SS = início→início, FF = término→término, SF = início→término. */
export type LinkType = "FS" | "SS" | "FF" | "SF";
export const LINK_TYPES: readonly LinkType[] = ["FS", "SS", "FF", "SF"];

export interface Predecessor {
  /** Id da atividade predecessora. */
  id: string;
  /** Padrão: "FS". */
  type?: LinkType;
  /** Defasagem em dias úteis. Negativa = antecipação. Padrão: 0. */
  lag?: number;
}

export interface CpmActivity {
  id: string;
  /** Duração em dias úteis (inteiro >= 0). */
  duration: number;
  predecessors?: Predecessor[];
  /** "Não iniciar antes de" (offset em dias úteis, >= 0). */
  startNoEarlierThan?: number;
  /**
   * Início obrigatório (offset em dias úteis, >= 0): prevalece sobre os vínculos com as predecessoras
   * (que podem ficar violados) e fixa a atividade (folga zero), como a restrição mandatória do Primavera.
   */
  mandatoryStart?: number;
}

export interface ScheduledActivity {
  id: string;
  duration: number;
  /** Início/fim mais cedo (fim exclusivo). */
  earlyStart: number;
  earlyFinish: number;
  /** Início/fim mais tarde (fim exclusivo). */
  lateStart: number;
  lateFinish: number;
  /** Folga total = lateStart - earlyStart. */
  totalFloat: number;
  /** Folga livre: atraso possível sem empurrar nenhuma sucessora. */
  freeFloat: number;
  /** Folga total <= 0. */
  critical: boolean;
}

export interface CpmResult {
  /** Duração total do projeto em dias úteis. */
  projectDuration: number;
  activities: ScheduledActivity[];
  /** Ids das atividades críticas, ordenadas por início mais cedo. */
  criticalPath: string[];
}

export class CpmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CpmError";
  }
}

export class CpmCycleError extends CpmError {
  /** Atividades que participam de (ou dependem de) um ciclo. */
  readonly involved: string[];
  constructor(involved: string[]) {
    super(`Dependência circular entre atividades: ${involved.join(", ")}`);
    this.name = "CpmCycleError";
    this.involved = involved;
  }
}
