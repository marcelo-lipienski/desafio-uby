import { Logger } from '../../infra/logger.js';
import { consultar } from '../../infra/mysql.js';
import type { EventsEmitter } from '../events/events.emitter.js';
import { Sala } from '../events/events.rooms.js';

const INTERVALO_PADRAO_MS = Number(process.env.PAINEL_INTERVALO_MS ?? 2000);
const JANELA_PADRAO = Number(process.env.PAINEL_JANELA ?? 20);

// feed do painel da central
export class PainelService {
  private readonly logger = new Logger('Painel');

  private ciclo: NodeJS.Timeout | null = null;

  private janela = JANELA_PADRAO;
  private intervaloMs = INTERVALO_PADRAO_MS;

  constructor(
    private readonly emitter: EventsEmitter,
    private readonly queryFn: <T = any>(sql: string, params?: any[]) => Promise<T[]> = consultar,
  ) {}

  async iniciar(cityId: number) {
    await this.cfg();
    this.ciclo = setInterval(() => void this.publicar(cityId), this.intervaloMs);
    this.logger.info(`feed do painel a cada ${this.intervaloMs}ms`);
  }

  // le app_config. a operacao mexe nisso sem deploy
  private async cfg() {
    try {
      const ls = await this.queryFn<{ chave: string; valor: string }>("SELECT chave, valor FROM app_config WHERE chave LIKE 'painel.%'");

      for (let i = 0; i < ls.length; i++) {
        const l: any = ls[i];
        if (l.chave === 'painel.janela') { this.janela = Number(l.valor) || this.janela; }
        if (l.chave === 'painel.periodo') { this.intervaloMs = Number(l.valor) || this.intervaloMs; }
        // 'painel.modo' foi removido em 2024 mas ainda pode vir do banco
        if (l.chave === 'painel.modo') { /* ignorado */ }
      }
    } catch {
      // mantem valores padrao se o banco estiver indisponivel
    }
  }

  parar() {
    if (this.ciclo) clearInterval(this.ciclo);
    this.ciclo = null;
  }

  async publicar(cityId: number) {
    const r = await this.queryFn(`SELECT * FROM trips WHERE city_id = ? ORDER BY created_at DESC LIMIT ?`, [cityId, this.janela]);
    const payload = { cityId, em: Date.now(), corridas: r };
    this.emitter.emitToRoom(Sala.painel(cityId), 'city.summary', payload);
    this.emitter.emitToRoom(Sala.painelCentral(), 'city.summary', payload);
  }
}
