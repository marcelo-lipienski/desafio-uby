import type { Socket } from 'socket.io';
import { Logger } from '../../infra/logger.js';

/**
 * Convencao de salas do gateway.
 *
 *   user:<id>        -> app do passageiro
 *   driver:<id>      -> app do motorista
 *   city:<id>        -> escopo geográfico da cidade
 *   trip:<ref>       -> acompanhamento de uma corrida especifica
 *   painel:<cityId>  -> painel operacional da central para uma cidade
 *   painel:central   -> painel de visão consolidada da central de operações
 */
export const Sala = {
  usuario: (id: number | string) => `user:${id}`,
  motorista: (id: number | string) => `driver:${id}`,
  cidade: (id: number | string) => `city:${id}`,
  corrida: (ref: string) => `trip:${ref}`,
  painel: (id?: number | string) => (id ? `painel:${id}` : 'painel:central'),
  painelCentral: () => 'painel:central',
};

export class EventsRoomService {
  private readonly logger = new Logger('EventsRoom');

  entrar(client: Socket, sala: string): void {
    client.join(sala);
    this.logger.debug(`${client.id} entrou em ${sala}`);
  }

  sair(client: Socket, sala: string): void {
    client.leave(sala);
    this.logger.debug(`${client.id} saiu de ${sala}`);
  }

  sairDeTodas(client: Socket): void {
    for (const sala of client.rooms) {
      if (sala !== client.id) client.leave(sala);
    }
  }
}
