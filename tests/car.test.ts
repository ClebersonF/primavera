import { describe, expect, it } from "vitest";
import { avaliarAmbiental, avaliarCadastro, avaliarEmbargos, avaliarSobreposicao, calcularSobreposicao, formatarDataFonte, montarBlocos, valorMetrica, vereditoGeral, type CarNormalizado } from "../src";

const base: CarNormalizado = {
  numero_car: "SP-3533007-61A29ACACA19431A94CF2E5F581A7B1B", situacao: "Ativo", condicao: null, municipio: "X", uf: "SP", area_ha: 100,
  modulos_fiscais: null, data_registro: "11/06/2015", reserva_legal_ha: null, reserva_legal_percentual: null, reserva_legal_deficit_ha: null,
  app_ha: null, vegetacao_nativa_ha: null, embargos: [], restricoes: [],
};

describe("CAR — conformidade documental", () => {
  it("situação cancelada é impeditiva, com ou sem acento e caixa", () => {
    expect(avaliarCadastro({ ...base, situacao: "CANCELADO" }).selo).toBe("impeditivo");
    expect(avaliarCadastro({ ...base, situacao: "Aguardando análise" }).selo).toBe("atencao");
    expect(avaliarCadastro({ ...base, situacao: "Aguardando atendimento" }).selo).toBe("nao_conforme");
    expect(avaliarCadastro({ ...base, situacao: null }).selo).toBe("sem_dado");
  });
  it("null nunca vira zero; zero explícito é informado como tal", () => {
    expect(valorMetrica(null)).toMatch(/não encontrada/);
    expect(valorMetrica({ ha: null, status: "NOT_LOADED", percentual: null, deficit_ha: null })).toMatch(/não encontrada/);
    expect(valorMetrica({ ha: 0, status: "EXPLICIT_ZERO", percentual: null, deficit_ha: null })).toMatch(/zero pela fonte/);
    expect(avaliarAmbiental(base).selo).toBe("sem_dado");
    expect(avaliarAmbiental({ ...base, reserva_legal_deficit_ha: 3 }).selo).toBe("nao_conforme");
    expect(avaliarAmbiental({ ...base, reserva_legal_deficit_ha: 0 }).selo).toBe("conforme");
  });
  it("embargo ou terra indígena torna o veredito impeditivo; embargos ausentes = sem dado", () => {
    expect(avaliarEmbargos({ ...base, restricoes: [{ tipo: "Terra Indígena", descricao: "sobreposição" }] }).selo).toBe("impeditivo");
    expect(avaliarEmbargos({ ...base, embargos: [{ tipo: "Outro" }] }).selo).toBe("nao_conforme");
    expect(avaliarEmbargos({ ...base, embargos: undefined as never }).selo).toBe("sem_dado");
    expect(avaliarEmbargos(base).selo).toBe("conforme");
  });
  it("só restrição e terceiros pesam; classes internas do imóvel não", () => {
    const f = { tem_sobreposicao: true, total_ha: 40, total_pct: 40, restricao_ha: 0, restricao_pct: 0, car_ha: 0, car_pct: 0, outros_ha: 0, outros_pct: 0, verificado_em: null, shapes: null };
    expect(avaliarSobreposicao(calcularSobreposicao(100, null), f).selo).toBe("conforme");
    expect(avaliarSobreposicao(calcularSobreposicao(100, null), { ...f, car_pct: 2 }).selo).toBe("atencao");
    expect(avaliarSobreposicao(calcularSobreposicao(100, null), { ...f, car_pct: 8 }).selo).toBe("nao_conforme");
    expect(avaliarSobreposicao(calcularSobreposicao(100, null), { ...f, restricao_pct: 0.1 }).selo).toBe("nao_conforme");
  });
  it("sem sobreposição da fonte, compara a área informada com a do CAR", () => {
    expect(avaliarSobreposicao(calcularSobreposicao(100, 103)).selo).toBe("conforme");
    expect(avaliarSobreposicao(calcularSobreposicao(100, 110)).selo).toBe("atencao");
    expect(avaliarSobreposicao(calcularSobreposicao(100, 130)).selo).toBe("nao_conforme");
    expect(calcularSobreposicao(0, 5).divergenciaPct).toBeNull();
  });
  it("o veredito geral é o pior selo e ignora o bloco informativo", () => {
    const blocos = montarBlocos({ ...base, reserva_legal_deficit_ha: 0, avisos_qualidade: ["APP_DATA_NOT_AVAILABLE"] }, calcularSobreposicao(100, null));
    expect(blocos.find((b) => b.id === "qualidade")?.selo).toBe("atencao");
    expect(vereditoGeral(blocos)).toBe("sem_dado");
  });
  it("datas da fonte respeitam dd/mm/aaaa e rejeitam data inexistente", () => {
    expect(formatarDataFonte("11/06/2015")).toBe("11/06/2015");
    expect(formatarDataFonte("2015-06-11")).toBe("11/06/2015");
    expect(formatarDataFonte("31/02/2015")).toBe("31/02/2015");
    expect(formatarDataFonte(null)).toBe("N/A");
  });
});
