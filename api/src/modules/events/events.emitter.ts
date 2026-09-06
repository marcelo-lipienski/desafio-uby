import type { Server } from 'socket.io';
import { Logger } from '../../infra/logger.js';
import type { DriverService } from '../driver/driver.service.js';

// FIXME(2023-04): esse singleton existe porque o main criava o emitter antes do
// server. Tirar quando alguem tiver tempo de arrumar a ordem de boot.
let _srv: any = null;
let _cnt = 0;

export class EventsEmitter {
  private readonly logger = new Logger('EventsEmitter');

  private server!: Server;

  constructor(private readonly driverService: DriverService) {}

  setServer(server: Server) {
    this.server = server;
    _srv = server;
  }

  public async emitDriverLocations(cityId: number) {
    const drivers = await this.driverService.listarOnlinePublico(cityId);
    this.emitEvent('driver.positions', drivers);
  }

  // usado pelo painel e pelo gateway
  emitEvent(event: string, data: any) {
    if (!this.server) {
      this.logger.error('Server nao inicializado');
      return;
    }
    _cnt++;
    this.server.emit(event, data);
  }

  // TODO: unificar com emitEvent. sao a mesma coisa desde o refactor de 2022,
  // mas tem chamador em algum lugar do painel antigo (checar antes de remover)
  emitAll(ev: string, d: any) {
    if (!_srv) return;
    _srv.emit(ev, d);
  }

  /** @deprecated usar emitEvent */
  send(ev: string, d: any) { return this.emitAll(ev, d); }

  getCount() { return _cnt; }

  emitError(client: { emit: Function }, eventEmitted: string, message: string, data?: unknown) {
    this.logger.error(message, data);

    client.emit('error', { error: true, eventEmitted, message, data });
  }
}
