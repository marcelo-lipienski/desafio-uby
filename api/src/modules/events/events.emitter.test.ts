import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventsEmitter } from './events.emitter.js';
import type { Server } from 'socket.io';
import type { DriverService } from '../driver/driver.service.js';

describe('EventsEmitter - Suporte a emitToRoom e salas restritas', () => {
  test('emitToRoom direciona eventos estritamente para a sala alvo', () => {
    let roomTargeted: string | null = null;
    let eventEmitted: string | null = null;
    let payloadEmitted: any = null;

    const mockServer = {
      to: (room: string) => {
        roomTargeted = room;
        return {
          emit: (event: string, data: any) => {
            eventEmitted = event;
            payloadEmitted = data;
          },
        };
      },
      emit: () => {
        assert.fail('Não deveria chamar emit global');
      },
    } as unknown as Server;

    const mockDriverService = {} as DriverService;
    const emitter = new EventsEmitter(mockDriverService);
    emitter.setServer(mockServer);

    const antes = emitter.getCount();
    emitter.emitToRoom('painel:central', 'city.summary', { test: true });

    assert.strictEqual(roomTargeted, 'painel:central');
    assert.strictEqual(eventEmitted, 'city.summary');
    assert.deepStrictEqual(payloadEmitted, { test: true });
    assert.strictEqual(emitter.getCount(), antes + 1);
  });

  test('emitEvent dispara para o servidor inteiro via broadcast', () => {
    let globalEvent: string | null = null;
    let globalPayload: any = null;

    const mockServer = {
      emit: (event: string, data: any) => {
        globalEvent = event;
        globalPayload = data;
      },
    } as unknown as Server;

    const mockDriverService = {} as DriverService;
    const emitter = new EventsEmitter(mockDriverService);
    emitter.setServer(mockServer);

    const antes = emitter.getCount();
    emitter.emitEvent('global.notice', { msg: 'hello' });

    assert.strictEqual(globalEvent, 'global.notice');
    assert.deepStrictEqual(globalPayload, { msg: 'hello' });
    assert.strictEqual(emitter.getCount(), antes + 1);
  });

  test('emitDriverLocations direciona posições estritamente para a sala da cidade', async () => {
    let roomTargeted: string | null = null;
    let eventEmitted: string | null = null;
    let payloadEmitted: any = null;

    const mockServer = {
      to: (room: string) => {
        roomTargeted = room;
        return {
          emit: (event: string, data: any) => {
            eventEmitted = event;
            payloadEmitted = data;
          },
        };
      },
      emit: () => {
        assert.fail('Não deveria chamar emit global');
      },
    } as unknown as Server;

    const mockDriverService = {
      listarOnlinePublico: async (cityId: number) => {
        return [{ driverId: 10, latitude: -21.37, longitude: -46.52, heading: 90 }];
      },
    } as unknown as DriverService;

    const emitter = new EventsEmitter(mockDriverService);
    emitter.setServer(mockServer);

    await emitter.emitDriverLocations(1);

    assert.strictEqual(roomTargeted, 'city:1', 'Deve enviar posições para a sala city:1');
    assert.strictEqual(eventEmitted, 'driver.positions');
    assert.strictEqual(payloadEmitted.length, 1);
    assert.strictEqual(payloadEmitted[0].driverId, 10);
  });
});
