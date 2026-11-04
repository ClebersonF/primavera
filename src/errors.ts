/** Erro de validação dos módulos de controle de projetos (EAP, custos, mudanças, impostos). */
export class PmoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PmoError";
  }
}
